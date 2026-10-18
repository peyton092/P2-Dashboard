import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { getAuth } from 'firebase-admin/auth'
import { db } from '../lib/admin.js'
import { clientLinks, followsJob, jobIdOf, movesTenant, needsRestamp, scopeChanged, scopePatchFor } from '../lib/scope-sync.js'
import { scopeForJob } from '../lib/scope.js'
import * as handlers from '../scope-sync.js'
import { assertNoDashes, code, stubFirestore } from './helpers/firestore-stub.js'

const { backfillScopes, onExtraWritten, onJobWritten, onSubmitWritten } = handlers

// ── The pure rules ────────────────────────────────────────────────────────────
// Nothing in this part touches Firestore or Auth. The triggers and the backfill
// are tested further down, against stubs.

describe('scopePatchFor', () => {
  it('is the tenantId and clientUids of the job, and nothing else of it', () => {
    const job = { id: 'QBS-001', address: '123 Main St', tenantId: 'vision', clientUids: ['c1', 'c2'], status: 'active' }
    assert.deepEqual(scopePatchFor(job), { tenantId: 'vision', clientUids: ['c1', 'c2'] })
    assert.deepEqual(Object.keys(scopePatchFor(job)).sort(), ['clientUids', 'tenantId'])
  })

  it('defaults the tenant to qbs when the job has none, as the legacy jobs all belong to it', () => {
    for (const bad of [undefined, null, '', 0, 5, ['vision'], {}]) {
      assert.equal(scopePatchFor({ tenantId: bad }).tenantId, 'qbs', `tenantId ${JSON.stringify(bad)}`)
    }
    assert.deepEqual(scopePatchFor({}), { tenantId: 'qbs', clientUids: [] })
  })

  it('leaves non string uids out, and gives no uids when clientUids is not a list', () => {
    assert.deepEqual(scopePatchFor({ clientUids: ['c1', 2, null, undefined, 'c2', {}] }).clientUids, ['c1', 'c2'])
    for (const bad of [undefined, null, 'c1', 7, { 0: 'c1' }]) {
      assert.deepEqual(scopePatchFor({ clientUids: bad }).clientUids, [], `clientUids ${JSON.stringify(bad)}`)
    }
  })

  it('treats a missing job as a legacy job with no clients', () => {
    assert.deepEqual(scopePatchFor(null), { tenantId: 'qbs', clientUids: [] })
    assert.deepEqual(scopePatchFor(undefined), { tenantId: 'qbs', clientUids: [] })
  })

  it('never changes the job it is given, and shares nothing with it', () => {
    const job = { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }
    const copy = structuredClone(job)
    scopePatchFor(job).clientUids.push('c2')
    assert.deepEqual(job, copy)
  })

  it('gives exactly the values scopeForJob gives, so a stamp and an access check never disagree', () => {
    const jobs = [
      {},
      { tenantId: 'qbs' },
      { tenantId: 'vision', clientUids: ['a'] },
      { tenantId: '', clientUids: ['a', 3] },
      { clientUids: 'a' },
      null,
    ]
    for (const job of jobs) assert.deepEqual(scopePatchFor(job), scopeForJob(job), JSON.stringify(job))
  })
})

describe('needsRestamp', () => {
  const job = { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1', 'c2'] }
  const stamped = (over = {}) => ({ id: 'CO-001', job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1', 'c2'], ...over })

  it('is false for a document that carries the scope of its job', () => {
    assert.equal(needsRestamp(stamped(), job), false)
  })

  it('is false when either side is missing, so there is nothing to stamp or nothing to stamp from', () => {
    for (const nothing of [null, undefined, 'x', 7, ['c1']]) {
      assert.equal(needsRestamp(nothing, job), false, `doc ${JSON.stringify(nothing)}`)
      assert.equal(needsRestamp(stamped(), nothing), false, `job ${JSON.stringify(nothing)}`)
    }
    assert.equal(needsRestamp(null, null), false)
  })

  it('is true when the document has no tenantId', () => {
    for (const bad of [undefined, null, '', 0, ['qbs']]) {
      assert.equal(needsRestamp(stamped({ tenantId: bad }), job), true, `tenantId ${JSON.stringify(bad)}`)
    }
    const { tenantId: _tenantId, ...without } = stamped()
    assert.equal(needsRestamp(without, job), true)
  })

  it('is true when the document has no clientUids list, even when the job has no clients either', () => {
    const noClients = { id: 'QBS-001', tenantId: 'qbs', clientUids: [] }
    for (const bad of [undefined, null, 'c1', 7, { 0: 'c1' }]) {
      assert.equal(needsRestamp(stamped({ clientUids: bad }), noClients), true, `clientUids ${JSON.stringify(bad)}`)
    }
    const { clientUids: _clientUids, ...without } = stamped()
    assert.equal(needsRestamp(without, noClients), true)
    assert.equal(needsRestamp(stamped({ clientUids: [] }), noClients), false)
  })

  it('is true when the tenant differs from the job', () => {
    assert.equal(needsRestamp(stamped({ tenantId: 'vision' }), job), true)
    assert.equal(needsRestamp(stamped({ tenantId: 'p2-core' }), job), true)
  })

  it('is true when the uids differ: one more, one fewer, or another', () => {
    assert.equal(needsRestamp(stamped({ clientUids: ['c1', 'c2', 'c3'] }), job), true)
    assert.equal(needsRestamp(stamped({ clientUids: ['c1'] }), job), true)
    assert.equal(needsRestamp(stamped({ clientUids: ['c1', 'c9'] }), job), true)
    assert.equal(needsRestamp(stamped({ clientUids: [] }), job), true)
  })

  it('compares the uids as sets, so a different order is not a difference', () => {
    assert.equal(needsRestamp(stamped({ clientUids: ['c2', 'c1'] }), job), false)
    assert.equal(needsRestamp(stamped({ clientUids: ['c2', 'c1', 'c1'] }), job), false)
    assert.equal(needsRestamp(stamped(), { ...job, clientUids: ['c2', 'c1'] }), false)
  })

  it('is true when the stored uids hold something that is not a uid, as that is not what would be written', () => {
    assert.equal(needsRestamp(stamped({ clientUids: ['c1', 'c2', 5] }), job), true)
    assert.equal(needsRestamp(stamped({ clientUids: ['c1', 'c2', null] }), job), true)
  })

  it('wants the legacy default for a job with no tenant, so a document stamped qbs is already right', () => {
    const legacy = { id: 'QBS-009' }
    assert.equal(needsRestamp(stamped({ tenantId: 'qbs', clientUids: [] }), legacy), false)
    assert.equal(needsRestamp(stamped({ tenantId: 'vision', clientUids: [] }), legacy), true)
  })

  it('ignores every other field of the document', () => {
    assert.equal(needsRestamp({ tenantId: 'qbs', clientUids: ['c1', 'c2'] }, job), false)
    assert.equal(needsRestamp(stamped({ status: 'Approved', amount: 4100, extra: [1, 2] }), job), false)
  })

  it('is false for a document after it is stamped from its job, whatever it was before', () => {
    const docs = [{}, { tenantId: 'vision' }, { clientUids: ['x'] }, { tenantId: '', clientUids: 'x' }, stamped({ clientUids: [] })]
    const jobs = [job, { id: 'QBS-002' }, { id: 'QBS-003', tenantId: 'vision', clientUids: ['a', 3, 'b'] }]
    for (const aJob of jobs) {
      for (const doc of docs) {
        assert.equal(needsRestamp({ ...doc, ...scopePatchFor(aJob) }, aJob), false, `${JSON.stringify(doc)} / ${JSON.stringify(aJob)}`)
      }
    }
  })

  it('changes neither of its inputs', () => {
    const doc = stamped({ tenantId: 'vision' })
    const docCopy = structuredClone(doc)
    const jobCopy = structuredClone(job)
    needsRestamp(doc, job)
    assert.deepEqual(doc, docCopy)
    assert.deepEqual(job, jobCopy)
  })
})

describe('movesTenant', () => {
  const JOB = { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }

  it('is true for a document that carries a tenant other than its job', () => {
    assert.equal(movesTenant({ jobId: 'QBS-001', tenantId: 'vision', clientUids: [] }, JOB), true)
  })

  it('is false for a document that carries the tenant of its job, whatever its clients', () => {
    assert.equal(movesTenant({ tenantId: 'qbs', clientUids: [] }, JOB), false)
    assert.equal(movesTenant({ tenantId: 'qbs' }, JOB), false)
  })

  it('is false for a document with no tenant, an empty one, or one that is not text', () => {
    for (const tenantId of [undefined, null, '', 7]) {
      assert.equal(movesTenant({ tenantId, clientUids: [] }, JOB), false, String(tenantId))
    }
  })

  it('compares with the legacy default for a job with no tenant', () => {
    assert.equal(movesTenant({ tenantId: 'qbs' }, { id: 'QBS-002' }), false)
    assert.equal(movesTenant({ tenantId: 'vision' }, { id: 'QBS-002' }), true)
  })

  it('is false when either side is missing', () => {
    assert.equal(movesTenant(null, JOB), false)
    assert.equal(movesTenant({ tenantId: 'vision' }, null), false)
  })
})

describe('followsJob', () => {
  it('is true for a submission with no tenant, an empty one, or one that is not text', () => {
    for (const tenantId of [undefined, null, '', 7]) {
      assert.equal(followsJob({ tenantId }, ['qbs']), true, String(tenantId))
      assert.equal(followsJob({ tenantId }, []), true, String(tenantId))
    }
  })

  it('is true for a submission that carries one of the tenants the job was in before', () => {
    assert.equal(followsJob({ tenantId: 'qbs' }, ['qbs']), true)
    assert.equal(followsJob({ tenantId: 'vision' }, ['qbs', 'vision']), true)
  })

  it('is false for a submission that carries any other tenant', () => {
    assert.equal(followsJob({ tenantId: 'vision' }, ['qbs']), false)
    assert.equal(followsJob({ tenantId: 'p2-core' }, ['qbs', 'vision']), false)
  })

  it('is false for every submission that carries a tenant when the job had none before, as a new job has not', () => {
    assert.equal(followsJob({ tenantId: 'qbs' }, []), false)
  })

  it('is false for a document that is missing', () => {
    assert.equal(followsJob(null, ['qbs']), false)
  })
})

describe('scopeChanged', () => {
  const before = { id: 'QBS-001', address: '1 Main St', tenantId: 'qbs', clientUids: ['c1', 'c2'] }

  it('is false when the job is gone, whatever it was, so a deleted job leaves its documents as they are', () => {
    for (const gone of [null, undefined]) {
      assert.equal(scopeChanged(before, gone), false)
      assert.equal(scopeChanged(gone, gone), false)
    }
  })

  it('is true for a new job, which has never stamped anything', () => {
    assert.equal(scopeChanged(null, before), true)
    assert.equal(scopeChanged(undefined, before), true)
    assert.equal(scopeChanged(null, { id: 'QBS-002' }), true)
  })

  it('is false when only something else about the job changed', () => {
    assert.equal(scopeChanged(before, { ...before, address: '2 Main St', status: 'complete', phase: 'final' }), false)
    assert.equal(scopeChanged(before, { ...before }), false)
  })

  it('is true when the tenant changed, including to or from none', () => {
    assert.equal(scopeChanged(before, { ...before, tenantId: 'vision' }), true)
    assert.equal(scopeChanged({ id: 'QBS-001' }, { id: 'QBS-001', tenantId: 'qbs' }), true)
    assert.equal(scopeChanged(before, { id: 'QBS-001', clientUids: ['c1', 'c2'] }), true)
  })

  it('is false while the job has no tenant before or after, however that is spelled', () => {
    const none = [{}, { tenantId: null }, { tenantId: '' }, { tenantId: 0 }]
    for (const a of none) for (const b of none) assert.equal(scopeChanged(a, b), false, `${JSON.stringify(a)} to ${JSON.stringify(b)}`)
  })

  it('is true when a uid is added or removed', () => {
    assert.equal(scopeChanged(before, { ...before, clientUids: ['c1', 'c2', 'c3'] }), true)
    assert.equal(scopeChanged(before, { ...before, clientUids: ['c1'] }), true)
    assert.equal(scopeChanged(before, { ...before, clientUids: ['c1', 'c9'] }), true)
    assert.equal(scopeChanged(before, { ...before, clientUids: [] }), true)
  })

  it('compares the uids as sets, so a reorder is not a change', () => {
    assert.equal(scopeChanged(before, { ...before, clientUids: ['c2', 'c1'] }), false)
    assert.equal(scopeChanged(before, { ...before, clientUids: ['c2', 'c1', 'c1'] }), false)
  })

  it('is false between no clientUids and an empty list, as neither has a client', () => {
    assert.equal(scopeChanged({ id: 'QBS-001', tenantId: 'qbs' }, { id: 'QBS-001', tenantId: 'qbs', clientUids: [] }), false)
    assert.equal(scopeChanged({ id: 'QBS-001', tenantId: 'qbs', clientUids: null }, { id: 'QBS-001', tenantId: 'qbs' }), false)
  })

  it('looks at uids only, so an entry that is not a uid changes nothing', () => {
    assert.equal(scopeChanged(before, { ...before, clientUids: ['c1', 'c2', 5, null] }), false)
  })

  it('changes neither of its inputs', () => {
    const after = { ...before, clientUids: ['c2', 'c1', 'c3'] }
    const beforeCopy = structuredClone(before)
    const afterCopy = structuredClone(after)
    scopeChanged(before, after)
    assert.deepEqual(before, beforeCopy)
    assert.deepEqual(after, afterCopy)
  })
})

describe('clientLinks', () => {
  const user = (uid, data) => ({ uid, data })
  const client = (...ids) => ({ role: 'client', tenantId: 'p2-core', clientJobIds: ids })

  it('maps each job id to the clients that list it', () => {
    const links = clientLinks([user('u1', client('QBS-001', 'QBS-002')), user('u2', client('QBS-002'))])
    assert.deepEqual([...links.entries()], [['QBS-001', ['u1']], ['QBS-002', ['u1', 'u2']]])
  })

  it('sorts the uids of a job, whatever order the users came in', () => {
    const links = clientLinks([user('zed', client('QBS-001')), user('amy', client('QBS-001')), user('bo', client('QBS-001'))])
    assert.deepEqual(links.get('QBS-001'), ['amy', 'bo', 'zed'])
  })

  it('counts only clients: staff and builders list no jobs that grant anything', () => {
    const links = clientLinks([
      user('o1', { role: 'owner', clientJobIds: ['QBS-001'] }),
      user('i1', { role: 'internal', clientJobIds: ['QBS-001'] }),
      user('b1', { role: 'builder', tenantId: 'qbs', clientJobIds: ['QBS-001'] }),
      user('c1', client('QBS-001')),
    ])
    assert.deepEqual([...links.entries()], [['QBS-001', ['c1']]])
  })

  it('ignores a user whose role is missing or not one of the four', () => {
    const links = clientLinks([
      user('u1', { clientJobIds: ['QBS-001'] }),
      user('u2', { role: 'superuser', clientJobIds: ['QBS-001'] }),
      user('u3', { role: 'Client', clientJobIds: ['QBS-001'] }),
      user('u4', { role: null, clientJobIds: ['QBS-001'] }),
    ])
    assert.equal(links.size, 0)
  })

  it('lists a uid once under a job, and drops empty and non string ids', () => {
    const links = clientLinks([user('u1', { role: 'client', clientJobIds: ['QBS-001', 'QBS-001', '', 7, null, 'QBS-002'] })])
    assert.deepEqual([...links.entries()], [['QBS-001', ['u1']], ['QBS-002', ['u1']]])
  })

  it('gives nothing for a client with no list, a list that is not a list, or no users at all', () => {
    assert.equal(clientLinks([]).size, 0)
    assert.equal(clientLinks([user('u1', { role: 'client' })]).size, 0)
    assert.equal(clientLinks([user('u1', { role: 'client', clientJobIds: 'QBS-001' })]).size, 0)
    assert.equal(clientLinks([user('u1', null), user('u2', undefined)]).size, 0)
  })

  it('does not change the users it is given', () => {
    const users = [user('u1', client('QBS-002', 'QBS-001'))]
    const copy = structuredClone(users)
    clientLinks(users)
    assert.deepEqual(users, copy)
  })
})

describe('jobIdOf', () => {
  it('is the id the document names in the field it is asked for', () => {
    assert.equal(jobIdOf({ id: 'CO-001', job: 'QBS-001' }, 'job'), 'QBS-001')
    assert.equal(jobIdOf({ subject: 'RFI', jobId: 'QBS-002' }, 'jobId'), 'QBS-002')
  })

  it('reads only that field: a change order names its job in job, the others in jobId', () => {
    assert.equal(jobIdOf({ jobId: 'QBS-001' }, 'job'), null)
    assert.equal(jobIdOf({ job: 'QBS-001' }, 'jobId'), null)
  })

  it('is null when the field is missing, empty or not a string', () => {
    for (const bad of [undefined, null, '', 0, 7, true, ['QBS-001'], { id: 'QBS-001' }]) {
      assert.equal(jobIdOf({ jobId: bad }, 'jobId'), null, JSON.stringify(bad))
    }
    assert.equal(jobIdOf({}, 'jobId'), null)
  })

  it('is null for a document that is missing', () => {
    for (const nothing of [null, undefined]) assert.equal(jobIdOf(nothing, 'jobId'), null)
  })
})

// ── The triggers and the backfill ─────────────────────────────────────────────
// Nothing here reaches a network. Firestore is the shared stub (helpers/firestore-stub.js,
// with outsideTransactions on, as these read collections and write in batches), and
// the Auth instance is the real singleton with the methods the handlers call replaced,
// so a call that is not stubbed fails loudly instead of quietly succeeding.

let stub // what the Firestore stub recorded: calls, reads, writes, batches
let claimed, fetched, revoked // Auth calls, in order
let logged // console output: ['warn' | 'error' | 'log', ...arguments]

const authError = (errorCode) => Object.assign(new Error(`Firebase auth error: ${errorCode}`), { code: errorCode })

// existing: { uid: { role } }, the custom claims each account has now.
// getUserError, claimsError: { uid: error }, what reading or setting one account fails with.
// meanwhile: called with the uid whenever an account is read, for a test that has something
// else change while the handler works through its users (a users document edited, say).
function stubAuth({ existing = {}, getUserError = {}, claimsError = {}, meanwhile } = {}) {
  const auth = getAuth()
  mock.method(auth, 'getUser', async (uid) => {
    fetched.push(uid)
    meanwhile?.(uid)
    if (getUserError[uid]) throw getUserError[uid]
    return { uid, customClaims: existing[uid] }
  })
  mock.method(auth, 'setCustomUserClaims', async (uid, claims) => {
    claimed.push({ uid, claims })
    if (claimsError[uid]) throw claimsError[uid]
  })
  mock.method(auth, 'revokeRefreshTokens', async (uid) => {
    revoked.push(uid)
  })
}

function captureConsole() {
  logged = []
  mock.method(console, 'warn', (...args) => logged.push(['warn', ...args]))
  mock.method(console, 'error', (...args) => logged.push(['error', ...args]))
  mock.method(console, 'log', (...args) => logged.push(['log', ...args]))
}

beforeEach(() => {
  stub = undefined
  claimed = []
  fetched = []
  revoked = []
  captureConsole()
})

afterEach(() => {
  mock.restoreAll()
})

const install = (documents) => {
  stub = stubFirestore(documents, { outsideTransactions: true })
}

// For a test that has to start over part way: takes every stub and spy off and puts the
// console spies back, with nothing logged or called yet. restart also installs the
// documents again, which is what a second handler run after the first one's writes needs.
function reset() {
  mock.restoreAll()
  claimed = []
  fetched = []
  revoked = []
  captureConsole()
}
function restart(documents) {
  reset()
  install(documents)
}

// Makes the commits with these numbers fail (1 is the first batch committed, 2 the second),
// and lets the others through to the stub, so a test can lose one batch and see the rest go on.
function failCommits(...numbers) {
  const real = db.batch
  let commits = 0
  mock.method(db, 'batch', () => {
    const batch = real()
    const commit = batch.commit
    batch.commit = async () => {
      commits += 1
      if (numbers.includes(commits)) throw new Error(`commit ${commits} failed`)
      return commit()
    }
    return batch
  })
}

// Wraps the transactions the stub runs so that one call inside them fails while the rest runs
// as the stub does it: `query` is what the read of a query (the job lookup) fails with, `update`
// what the write fails with.
function breakTransactions({ query, update }) {
  const real = db.runTransaction
  mock.method(db, 'runTransaction', (work) =>
    real((tx) =>
      work({
        ...tx,
        get: (target) => (query && target.query ? Promise.reject(query) : tx.get(target)),
        update: (...args) => {
          if (update) throw update
          return tx.update(...args)
        },
      }),
    ),
  )
}

const warnings = () => logged.filter(([level]) => level === 'warn').map(([, message]) => String(message))

const snap = (data, ref) => ({ exists: data != null, data: () => data, ref })

// A write to jobs/{docId}. before and after are the job as the event reports it (null for
// none). The handler reads the job again, and `now` is what it finds then: the same as
// after unless a test says otherwise. It can also be a function of how many times the job
// has been read so far (1 the first time), for a test where the job moves while the handler
// works. ref.rereads counts the reads. The job is only ever written inside a transaction, so
// a plain ref.update fails the test.
function jobEvent(docId, before, after, { now = after } = {}) {
  const path = `jobs/${docId}`
  const ref = {
    id: docId,
    path,
    rereads: 0,
    get: async () => {
      ref.rereads += 1
      return snap(typeof now === 'function' ? now(ref.rereads) : now, ref)
    },
    update: () => {
      throw new Error('the job must be written inside a transaction')
    },
  }
  return { params: { id: docId }, data: { before: snap(before, ref), after: snap(after, ref) } }
}

// A write to extras/{docId} or submits/{docId}. Their handlers read the document through
// a transaction, so the stub has to hold it too.
function documentEvent(collection, docId, after, before = null) {
  const ref = { id: docId, path: `${collection}/${docId}` }
  return { params: { id: docId }, data: { before: snap(before, ref), after: snap(after, ref) } }
}

// The documents as they are once a list of writes has been applied to them.
function applied(documents, writes) {
  const next = structuredClone(documents)
  for (const { path, data } of writes) {
    const [name, id] = path.split('/')
    next[name][id] = { ...next[name][id], ...data }
  }
  return next
}

const noEvent = { params: { id: 'x' }, data: undefined }

describe('scope-sync.js exports', () => {
  it('re-exports the pure helpers the brief names, so callers and tests can import them from here', () => {
    assert.equal(handlers.needsRestamp, needsRestamp)
    assert.equal(handlers.scopePatchFor, scopePatchFor)
  })
})

describe('onJobWritten', () => {
  const run = (event) => onJobWritten.run(event)

  const JOB = { id: 'QBS-001', address: '1 Main St', tenantId: 'qbs', clientUids: ['c1'] }
  const dependents = (over = {}) => ({
    extras: {
      x1: { id: 'CO-001', job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], status: 'pending' },
      x2: { id: 'CO-002', job: 'QBS-002', tenantId: 'qbs', clientUids: [] },
      x3: { id: 'CO-003', job: 'QBS-001', status: 'Draft' },
      x4: { id: 'CO-004', jobId: 'QBS-001' },
    },
    submits: {
      s1: { subject: 'RFI', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] },
      s2: { subject: 'Staff note', jobId: null },
      s3: { subject: 'Other', jobId: 'QBS-002', tenantId: 'qbs', clientUids: [] },
      s4: { subject: 'No job at all' },
      s5: { subject: 'Wrong field', job: 'QBS-001' },
    },
    notifications: {
      n1: { msg: 'a', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] },
      n2: { msg: 'b', jobId: 'QBS-002', tenantId: 'qbs', clientUids: [] },
      n3: { msg: 'c', jobId: 'QBS-001', tenantId: 'vision', clientUids: ['c1'] },
      n4: { msg: 'wrong field', job: 'QBS-001' },
    },
    ...over,
  })
  // n notifications that name QBS-001 and carry a scope that is not the job's, as {n0: ..., n1: ...}.
  const many = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, { msg: `m${i}`, jobId: 'QBS-001', tenantId: 'qbs', clientUids: [] }]))

  describe('when nothing about the scope changed', () => {
    it('writes nothing and reads nothing when only something else about the job changed', async () => {
      const after = { ...JOB, address: '2 Main St', status: 'complete' }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', JOB, after)
      await run(event)
      assert.deepEqual([stub.calls, stub.writes, stub.batches], [[], [], []])
      assert.equal(event.data.after.ref.rereads, 0, 'the job is not even read again')
    })

    it('does not treat the same clients in another order as a change', async () => {
      const before = { ...JOB, clientUids: ['c1', 'c2'] }
      const after = { ...JOB, clientUids: ['c2', 'c1'] }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', before, after)
      await run(event)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(event.data.after.ref.rereads, 0)
    })

    it('does not write to the tenantId of a job that already existed without one', async () => {
      const legacy = { id: 'QBS-001', address: '1 Main St' }
      install({ jobs: { j1: legacy }, ...dependents() })
      await run(jobEvent('j1', legacy, { ...legacy, address: '2 Main St' }))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })

    it('writes nothing for a deleted job, and does not read it again', async () => {
      install({ jobs: {}, ...dependents() })
      let reads = 0
      const event = jobEvent('j1', JOB, null)
      event.data.before.ref.get = async () => {
        reads += 1
        return snap(null)
      }
      await run(event)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(reads, 0)
    })

    it('does nothing, and warns, when the event carries no data', async () => {
      install({ jobs: {}, ...dependents() })
      await run(noEvent)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(warnings().length, 1)
    })
  })

  describe('when the tenant or the clients changed', () => {
    it('reads the job again, and stamps the change orders by job, and the submissions and notifications by jobId', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', JOB, after)
      await run(event)
      assert.equal(event.data.after.ref.rereads, 2, 'once to stamp from, and once more afterwards to see whether it moved')
      const scope = { tenantId: 'vision', clientUids: ['c1'] }
      const written = stub.writes.map((write) => [write.op, write.path, write.data]).sort((a, b) => a[1].localeCompare(b[1]))
      assert.deepEqual(written, [
        ['update', 'extras/x1', scope],
        ['update', 'extras/x3', scope],
        ['update', 'notifications/n1', scope],
        ['update', 'submits/s1', scope],
      ])
    })

    it('leaves alone the other jobs, the staff submissions, the documents that name the job in the wrong field, and the ones already right', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', JOB, after))
      const touched = stub.writes.map((write) => write.path)
      for (const untouched of ['extras/x2', 'extras/x4', 'submits/s2', 'submits/s3', 'submits/s4', 'submits/s5', 'notifications/n2', 'notifications/n3', 'notifications/n4']) {
        assert.ok(!touched.includes(untouched), `${untouched} must not be written`)
      }
    })

    it('writes exactly tenantId and clientUids to each, and nothing else of the document', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', JOB, after))
      for (const write of stub.writes) {
        assert.equal(write.op, 'update')
        assert.deepEqual(Object.keys(write.data).sort(), ['clientUids', 'tenantId'])
      }
    })

    it('stamps the new clients when one is linked or unlinked', async () => {
      const after = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(stub.writes.map((write) => write.path).sort(), ['extras/x1', 'extras/x3', 'notifications/n1', 'notifications/n3', 'submits/s1'])
      assert.ok(stub.writes.every((write) => write.data.clientUids.join() === 'c1,c2'))

      const gone = { ...JOB, clientUids: [] }
      restart({ jobs: { j1: gone }, ...dependents() })
      await run(jobEvent('j1', JOB, gone))
      assert.ok(stub.writes.length > 0)
      assert.ok(stub.writes.every((write) => write.data.clientUids.length === 0))
    })

    it('writes nothing when every document that names the job already carries the new scope', async () => {
      const after = { ...JOB, tenantId: 'vision', clientUids: ['c1', 'c2'] }
      const stamped = { tenantId: 'vision', clientUids: ['c2', 'c1'] }
      install({
        jobs: { j1: after },
        extras: { x1: { job: 'QBS-001', ...stamped } },
        submits: { s1: { jobId: 'QBS-001', ...stamped } },
        notifications: { n1: { jobId: 'QBS-001', ...stamped } },
      })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual([stub.writes, stub.batches], [[], []])
      assert.equal(stub.calls.filter((entry) => entry.startsWith('collection:')).length, 3, 'it did look')
    })

    it('gives the documents the legacy default tenant when the job has none', async () => {
      const before = { id: 'QBS-001', clientUids: [] }
      const after = { id: 'QBS-001', clientUids: ['c1'] }
      install({
        jobs: { j1: after },
        extras: { x1: { job: 'QBS-001', tenantId: 'vision', clientUids: [] }, x3: { job: 'QBS-001' } },
        submits: {},
        notifications: {},
      })
      await run(jobEvent('j1', before, after))
      assert.deepEqual(stub.writes.map((write) => [write.path, write.data]), [
        ['extras/x1', { tenantId: 'qbs', clientUids: ['c1'] }],
        ['extras/x3', { tenantId: 'qbs', clientUids: ['c1'] }],
      ])
    })

    it('stamps a job that names nothing yet without error, when no document names it', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, extras: {}, submits: {}, notifications: {} })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual([stub.writes, stub.batches], [[], []])
    })

    it('works from the job as it is now, not as the event says', async () => {
      // The event is for the write that linked c1. A later write has linked c2 as well.
      const eventAfter = { ...JOB, clientUids: ['c1'] }
      const now = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: now }, ...dependents() })
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, eventAfter, { now }))
      assert.ok(stub.writes.length > 0)
      assert.ok(stub.writes.every((write) => write.data.clientUids.join() === 'c1,c2'))
    })

    it('lets a late event for an older write leave the latest scope in place', async () => {
      // Writes: [] to [c1] (event 1), then [c1] to [c1, c2] (event 2). Event 2 is handled
      // first, and event 1 arrives after it, finding the documents already right.
      const latest = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: latest }, ...dependents() })
      await run(jobEvent('j1', JOB, latest))
      const documents = applied({ jobs: { j1: latest }, ...dependents() }, stub.writes)
      stub.clear()
      restart(documents)
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, { ...JOB, clientUids: ['c1'] }, { now: latest }))
      assert.deepEqual(stub.writes, [], 'the older event does not put the older scope back')
    })

    it('writes nothing when the job is gone by the time it is read again', async () => {
      install({ jobs: {}, ...dependents() })
      await run(jobEvent('j1', JOB, { ...JOB, tenantId: 'vision' }, { now: null }))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })

    it('warns, and stamps nothing, for a job that has no id to find its documents by', async () => {
      const after = { tenantId: 'vision', clientUids: [] }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', { tenantId: 'qbs', clientUids: [] }, after))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /jobs\/j1/)
    })
  })

  // A submission follows its job only from the tenant the job was in before. One that
  // carries another tenant is left where it is, or a builder could name a job of
  // another tenant and wait for that job's clients to change. Change orders and
  // notifications always follow their job.
  describe('a submission that carries another tenant', () => {
    const odd = (tenantId) => ({ s6: { subject: 'Odd', jobId: 'QBS-001', tenantId, clientUids: [] } })
    const keptLines = () => warnings().filter((line) => line.includes('submits/s6'))

    it('is left alone, and logged once, when the clients of its job change', async () => {
      const after = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: after }, ...dependents({ submits: { ...dependents().submits, ...odd('vision') } }) })
      await run(jobEvent('j1', JOB, after))
      const touched = stub.writes.map((write) => write.path)
      assert.ok(!touched.includes('submits/s6'), 'submits/s6 is not written')
      assert.ok(touched.includes('submits/s1'), 'a submission of the job tenant still gets the new clients')
      assert.equal(keptLines().length, 1)
      assert.match(keptLines()[0], /tenant vision/)
      assert.match(keptLines()[0], /\(qbs\)/, 'the tenant the job was in before')
      assert.match(keptLines()[0], /now in tenant qbs/)
      assertNoDashes(keptLines()[0].replace('QBS-001', 'ID'))
    })

    it('is left alone, and logged once, when its job moves from another tenant', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents({ submits: { ...dependents().submits, ...odd('p2-core') } }) })
      await run(jobEvent('j1', JOB, after))
      assert.ok(!stub.writes.some((write) => write.path === 'submits/s6'))
      assert.ok(stub.writes.some((write) => write.path === 'submits/s1'), 'a submission of the previous tenant follows the job')
      assert.equal(keptLines().length, 1)
      assert.match(keptLines()[0], /tenant p2-core/)
      assert.match(keptLines()[0], /\(qbs\)/)
      assert.match(keptLines()[0], /now in tenant vision/)
    })

    it('is logged once in each pass, when the job moves while its documents are stamped', async () => {
      const first = { ...JOB, clientUids: ['c1', 'c2'] }
      const newer = { ...JOB, clientUids: ['c1', 'c2', 'c3'] }
      install({ jobs: { j1: newer }, extras: {}, submits: odd('vision'), notifications: {} })
      await run(jobEvent('j1', JOB, first, { now: (n) => (n === 1 ? first : newer) }))
      assert.deepEqual(stub.writes, [])
      assert.equal(keptLines().length, 2)
    })

    it('is stamped when it carries no tenant, or an empty one, on a move and on a change of clients', async () => {
      const blank = { s7: { subject: 'Blank', jobId: 'QBS-001' }, s8: { subject: 'Empty', jobId: 'QBS-001', tenantId: '' } }
      for (const after of [{ ...JOB, tenantId: 'vision' }, { ...JOB, clientUids: ['c1', 'c2'] }]) {
        restart({ jobs: { j1: after }, ...dependents({ submits: blank }) })
        await run(jobEvent('j1', JOB, after))
        const scope = scopePatchFor(after)
        assert.deepEqual(stub.written('submits/').map((write) => [write.path, write.data]), [
          ['submits/s7', scope],
          ['submits/s8', scope],
        ])
        assert.deepEqual(warnings(), [])
      }
    })

    it('leaves the change orders and notifications to follow their job, whatever tenant they carry', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({
        jobs: { j1: after },
        extras: { x9: { job: 'QBS-001', tenantId: 'p2-core', clientUids: [] } },
        submits: {},
        notifications: { n9: { jobId: 'QBS-001', tenantId: 'p2-core', clientUids: [] } },
      })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(stub.writes.map((write) => write.path).sort(), ['extras/x9', 'notifications/n9'])
      assert.deepEqual(warnings(), [])
    })

    it('for a new job, only a submission with no tenant is stamped', async () => {
      const created = { id: 'QBS-007', tenantId: 'qbs', clientUids: ['c1'] }
      install({
        jobs: { j7: created },
        extras: {},
        submits: {
          s7: { subject: 'Blank', jobId: 'QBS-007' },
          s9: { subject: 'Early', jobId: 'QBS-007', tenantId: 'qbs', clientUids: [] },
        },
        notifications: {},
      })
      await run(jobEvent('j7', null, created))
      assert.deepEqual(stub.written('submits/').map((write) => write.path), ['submits/s7'])
      const kept = warnings().filter((line) => line.includes('submits/s9'))
      assert.equal(kept.length, 1)
      assert.match(kept[0], /none, as the job is new/)
    })

    it('in the second pass, follows from the tenant the first pass stamped as well', async () => {
      // The job moves qbs to vision (the event), then vision to p2-core while the first
      // pass runs. s1 already carries vision (stamped when the job was read), s2 still
      // carries qbs; both follow the job to p2-core, and a third tenant does not.
      const first = { ...JOB, tenantId: 'vision' }
      const newer = { ...JOB, tenantId: 'p2-core' }
      install({
        jobs: { j1: newer },
        extras: {},
        submits: {
          s1: { jobId: 'QBS-001', tenantId: 'vision', clientUids: ['c1'] },
          s2: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] },
          s3: { jobId: 'QBS-001', tenantId: 'other', clientUids: ['c1'] },
        },
        notifications: {},
      })
      await run(jobEvent('j1', JOB, first, { now: (n) => (n === 1 ? first : newer) }))
      const moved = stub.writes.filter((write) => write.data.tenantId === 'p2-core').map((write) => write.path).sort()
      assert.deepEqual(moved, ['submits/s1', 'submits/s2'])
      assert.ok(!stub.writes.some((write) => write.path === 'submits/s3'))
    })
  })

  describe('a new job', () => {
    it('is stamped qbs on itself when it was written without a tenant, and so are the documents that name it', async () => {
      const after = { id: 'QBS-007', address: '7 Main St', clientUids: [] }
      install({ jobs: { j7: after }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, after))
      assert.deepEqual(stub.written('jobs/'), [{ op: 'update', path: 'jobs/j7', data: { tenantId: 'qbs' } }])
      assert.deepEqual(stub.written('extras/'), [{ op: 'update', path: 'extras/x7', data: { tenantId: 'qbs', clientUids: [] } }])
    })

    it('treats an empty or non string tenant as no tenant', async () => {
      for (const tenantId of ['', null, 5]) {
        const after = { id: 'QBS-007', tenantId, clientUids: [] }
        restart({ jobs: { j7: after }, extras: {}, submits: {}, notifications: {} })
        await run(jobEvent('j7', null, after))
        assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs' }], JSON.stringify(tenantId))
      }
    })

    it('does not write to itself when it already has a tenant', async () => {
      const after = { id: 'QBS-008', tenantId: 'vision', clientUids: [] }
      install({ jobs: { j8: after }, extras: { x8: { job: 'QBS-008' } }, submits: {}, notifications: {} })
      await run(jobEvent('j8', null, after))
      assert.deepEqual(stub.written('jobs/'), [])
      assert.deepEqual(stub.written('extras/').map((write) => write.data), [{ tenantId: 'vision', clientUids: [] }])
    })

    it('gives itself the tenant inside a transaction, which reads the job first', async () => {
      const after = { id: 'QBS-007', clientUids: [] }
      install({ jobs: { j7: after }, extras: {}, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, after))
      assert.ok(stub.calls.includes('runTransaction'))
      assert.deepEqual(stub.reads, ['jobs/j7'])
      assert.deepEqual(stub.written('jobs/'), [{ op: 'update', path: 'jobs/j7', data: { tenantId: 'qbs' } }])
    })

    it('writes nothing to itself when the job is gone by the time the transaction reads it', async () => {
      const after = { id: 'QBS-007', clientUids: [] }
      install({ jobs: {}, extras: {}, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, after))
      assert.deepEqual(stub.reads, ['jobs/j7'])
      assert.deepEqual(stub.written('jobs/'), [])
    })

    it('does not overwrite a tenant that was set after the job was read, and the documents get that tenant', async () => {
      const read = { id: 'QBS-007', clientUids: [] } // as the event and the first read saw it
      const set = { ...read, tenantId: 'vision' } // as it is by the time the transaction looks
      install({ jobs: { j7: set }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, read, { now: (n) => (n === 1 ? read : set) }))
      assert.deepEqual(stub.written('jobs/'), [], 'the tenant that was set is not overwritten')
      assert.deepEqual(
        stub.written('extras/').map((write) => write.data.tenantId),
        ['qbs', 'vision'],
        'the second pass puts the tenant that was set on the documents',
      )
    })

    it('finds nothing to write when it runs again for its own write', async () => {
      const created = { id: 'QBS-007', clientUids: [] }
      const documents = { jobs: { j7: created }, extras: { x7: { job: 'QBS-007' } }, submits: { s7: { jobId: 'QBS-007' } }, notifications: {} }
      install(documents)
      await run(jobEvent('j7', null, created))
      const next = applied(documents, stub.writes)
      assert.equal(next.jobs.j7.tenantId, 'qbs')

      restart(next)
      await run(jobEvent('j7', created, next.jobs.j7))
      assert.deepEqual(stub.writes, [], 'the second run, for the write the first one made, writes nothing')
    })
  })

  describe('failures', () => {
    const created = { id: 'QBS-007', clientUids: [] }
    const installCreated = () => install({ jobs: { j7: created }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
    const errorLines = () => logged.filter(([level]) => level === 'error')

    it('still stamps the documents when the job cannot be given its tenant, and then fails the event', async () => {
      installCreated()
      breakTransactions({ update: new Error('update failed') })
      await assert.rejects(run(jobEvent('j7', null, created)), /update failed/)
      assert.equal(stub.written('extras/').length, 1)
      assert.deepEqual(stub.written('jobs/'), [])
    })

    it('still gives the job its tenant when the documents cannot be written, and then fails the event', async () => {
      installCreated()
      failCommits(1)
      await assert.rejects(run(jobEvent('j7', null, created)), /commit 1 failed/)
      assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs' }])
    })

    it('logs both halves when both fail, each with the job it was for, and fails the event with the first', async () => {
      installCreated()
      breakTransactions({ update: new Error('tenant write failed') })
      failCommits(1)
      await assert.rejects(run(jobEvent('j7', null, created)), /tenant write failed/)
      const tenant = errorLines().find(([, message, cause]) => /its tenant/.test(message) && cause?.message === 'tenant write failed')
      const documents = errorLines().find(([, message, cause]) => /its documents/.test(message) && cause?.message === 'commit 1 failed')
      assert.ok(tenant, 'the failed tenant write is logged')
      assert.ok(documents, 'the failed stamping of the documents is logged')
      for (const [, message] of [tenant, documents]) {
        assert.match(String(message), /jobs\/j7/)
        assertNoDashes(String(message))
      }
    })

    it('fails the event when a collection cannot be read, and writes nothing', async () => {
      install({ jobs: {}, ...dependents() })
      mock.method(db, 'collection', () => ({ where: () => ({ get: async () => { throw new Error('read failed') } }) }))
      await assert.rejects(run(jobEvent('j1', JOB, { ...JOB, tenantId: 'vision' })), /read failed/)
      assert.deepEqual(stub.writes, [])
    })

    it('fails the event when the job cannot be read again, and changes nothing', async () => {
      install({ jobs: {}, ...dependents() })
      const event = jobEvent('j1', JOB, { ...JOB, tenantId: 'vision' })
      event.data.after.ref.get = async () => { throw new Error('read failed') }
      await assert.rejects(run(event), /read failed/)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })
  })

  // A batch that fails (a document deleted between the read and the commit makes Firestore
  // refuse the whole batch) is lost, and the ones after it still go.
  describe('a batch that fails', () => {
    const before = { ...JOB, clientUids: [] }
    const after = { ...JOB, clientUids: ['c1'] }
    const installMany = (count) => install({ jobs: { j1: after }, extras: {}, submits: {}, notifications: many(count) })
    const batchLines = () => logged.filter(([level, message]) => level === 'error' && /could not be stamped/.test(message))

    it('does not stop the batches after it, and the event fails with its error once they are done', async () => {
      installMany(1003)
      failCommits(1)
      await assert.rejects(run(jobEvent('j1', before, after)), /commit 1 failed/)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 203], 'the second and third batches were committed')
      assert.equal(stub.writes.length, 603)
    })

    it('does not stop the batches before it either', async () => {
      installMany(1003)
      failCommits(3)
      await assert.rejects(run(jobEvent('j1', before, after)), /commit 3 failed/)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 400])
    })

    it('logs the job and the error of every batch that fails, and how many documents it held', async () => {
      installMany(1003)
      failCommits(1, 3)
      await assert.rejects(run(jobEvent('j1', before, after)), /commit 1 failed/)
      assert.equal(batchLines().length, 2)
      const [first, second] = batchLines()
      assert.match(first[1], /jobs\/j1/)
      assert.match(first[1], /400/)
      assert.equal(first[2].message, 'commit 1 failed')
      assert.match(second[1], /203/)
      assert.equal(second[2].message, 'commit 3 failed')
      for (const [, message] of batchLines()) assertNoDashes(String(message))
    })

    it('logs nothing about batches when they all commit', async () => {
      installMany(450)
      await run(jobEvent('j1', before, after))
      assert.equal(batchLines().length, 0)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 50])
    })

    it('still does the second look at the job, so a newer scope is stamped even after a batch was lost', async () => {
      installMany(5)
      const newer = { ...JOB, clientUids: ['c1', 'c2'] }
      failCommits(1)
      const event = jobEvent('j1', before, after, { now: (n) => (n === 1 ? after : newer) })
      await assert.rejects(run(event), /commit 1 failed/)
      assert.equal(event.data.after.ref.rereads, 2)
      assert.ok(stub.writes.length > 0, 'the second pass went ahead')
      assert.ok(stub.writes.every((write) => write.data.clientUids.join() === 'c1,c2'))
    })
  })

  // The job can move again (a client linked, say) while its documents are being stamped,
  // and the event for that move may already have run and found them half done.
  describe('when the job moves while its documents are stamped', () => {
    const before = { ...JOB, clientUids: [] }
    const first = { ...JOB, clientUids: ['c1'] } // the scope the event is about
    const newer = { ...JOB, clientUids: ['c1', 'c2'] } // the scope it has moved to meanwhile
    const documents = () => ({
      jobs: { j1: newer },
      extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
      submits: {},
      notifications: {},
    })
    const passes = () => stub.calls.filter((entry) => entry === 'collection:extras').length

    it('stamps the newer scope in a second pass', async () => {
      install(documents())
      const event = jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : newer) })
      await run(event)
      assert.deepEqual(stub.writes.map((write) => write.data.clientUids), [['c1'], ['c1', 'c2']], 'c1 first, then c1 and c2')
      assert.equal(passes(), 2)
      assert.equal(event.data.after.ref.rereads, 2)
    })

    it('stamps the second pass onto every document the newer scope does not match, one the first pass left alone included', async () => {
      install({
        jobs: { j1: newer },
        extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }, x2: { job: 'QBS-001' } },
        submits: {},
        notifications: {},
      })
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : newer) }))
      assert.deepEqual(stub.writes.map((write) => [write.path, write.data.clientUids]), [
        ['extras/x2', ['c1']], // the first pass: x1 already carries c1, x2 carries nothing
        ['extras/x1', ['c1', 'c2']], // the second pass: neither carries c2
        ['extras/x2', ['c1', 'c2']],
      ])
    })

    it('does not stamp a second time when the job did not move', async () => {
      install(documents())
      const event = jobEvent('j1', before, first, { now: first })
      await run(event)
      assert.equal(passes(), 1)
      assert.equal(stub.writes.length, 1)
      assert.equal(event.data.after.ref.rereads, 2, 'it did look again')
    })

    it('does not count something else about the job changing as moving', async () => {
      install(documents())
      const edited = { ...first, address: '2 Main St', status: 'complete' }
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : edited) }))
      assert.equal(passes(), 1)
    })

    it('does not count the same clients in another order as moving', async () => {
      install(documents())
      const wide = { ...JOB, clientUids: ['c1', 'c2'] }
      await run(jobEvent('j1', before, wide, { now: (n) => (n === 1 ? wide : { ...JOB, clientUids: ['c2', 'c1'] }) }))
      assert.equal(passes(), 1)
    })

    it('does not count its own tenant being written as moving', async () => {
      const created = { id: 'QBS-007', clientUids: [] }
      install({ jobs: { j7: created }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, created, { now: (n) => (n === 1 ? created : { ...created, tenantId: 'qbs' }) }))
      assert.equal(passes(), 1)
      assert.equal(stub.written('extras/').length, 1)
    })

    it('stamps once more at most, however often the job moves', async () => {
      install(documents())
      const moving = (n) => ({ ...JOB, clientUids: Array.from({ length: n }, (_, i) => `c${i}`) })
      const event = jobEvent('j1', before, first, { now: moving })
      await run(event)
      assert.equal(passes(), 2)
      assert.equal(event.data.after.ref.rereads, 2, 'it does not look a third time')
      assert.deepEqual(stub.writes.at(-1).data.clientUids, ['c0', 'c1'])
    })

    it('does not stamp again when the job is gone by then', async () => {
      install(documents())
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : null) }))
      assert.equal(passes(), 1)
    })

    it('does not stamp again when the job has lost its id, which would leave nothing to find its documents by', async () => {
      install(documents())
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : { tenantId: 'vision', clientUids: [] }) }))
      assert.equal(passes(), 1)
      assert.deepEqual(warnings(), [])
    })

    it('fails the event, after the first pass, when the job cannot be read the second time', async () => {
      install(documents())
      const event = jobEvent('j1', before, first)
      const read = event.data.after.ref.get
      let reads = 0
      event.data.after.ref.get = async () => {
        reads += 1
        if (reads === 2) throw new Error('second read failed')
        return read()
      }
      await assert.rejects(run(event), /second read failed/)
      assert.equal(stub.writes.length, 1, 'the first pass was done')
    })
  })

  describe('many documents', () => {
    it('splits them into batches of at most 400, so none gets near the 500 writes Firestore allows', async () => {
      const after = { ...JOB, clientUids: ['c1'] }
      install({ jobs: { j1: after }, extras: {}, submits: {}, notifications: many(1003) })
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, after))
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 400, 203])
      assert.equal(stub.writes.length, 1003)
    })

    it('stamps the documents of all three collections together in the same batches', async () => {
      const after = { ...JOB, clientUids: ['c1'] }
      install({ jobs: { j1: after }, extras: { x1: { job: 'QBS-001' } }, submits: { s1: { jobId: 'QBS-001' } }, notifications: many(5) })
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, after))
      assert.deepEqual(stub.batches.map((group) => group.length), [7])
    })
  })

  describe('no trigger fires itself', () => {
    it('leaves every document it stamped with nothing for onExtraWritten and onSubmitWritten to do', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      const documents = { jobs: { j1: after }, ...dependents() }
      install(documents)
      await run(jobEvent('j1', JOB, after))
      assert.ok(stub.writes.length > 0)
      const next = applied(documents, stub.writes)

      for (const [collection, trigger] of [['extras', onExtraWritten], ['submits', onSubmitWritten]]) {
        for (const write of stub.written(`${collection}/`)) {
          restart(next)
          const id = write.path.split('/')[1]
          await trigger.run(documentEvent(collection, id, next[collection][id], documents[collection][id]))
          assert.deepEqual(stub.writes, [], `${write.path} is stamped, so its own trigger writes nothing`)
        }
      }
    })

    it('runs to the end when it runs again after its own writes', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      const documents = { jobs: { j1: after }, ...dependents() }
      install(documents)
      await run(jobEvent('j1', JOB, after))
      const next = applied(documents, stub.writes)
      restart(next)
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(stub.writes, [], 'a second pass over documents that were just stamped writes nothing')
    })
  })
})

// onExtraWritten and onSubmitWritten stamp one document from its job. They differ
// only in the collection and in the field the document names its job in.
for (const [name, trigger, collection, field] of [
  ['onExtraWritten', onExtraWritten, 'extras', 'job'],
  ['onSubmitWritten', onSubmitWritten, 'submits', 'jobId'],
]) {
  describe(name, () => {
    const JOB3 = { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1', 'c2'] }
    const OTHER = { id: 'QBS-004', tenantId: 'vision', clientUids: ['c9'] }
    const SCOPE = { tenantId: 'qbs', clientUids: ['c1', 'c2'] }
    const unstamped = (over = {}) => ({ subject: 'Panel', [field]: 'QBS-003', ...over })
    const stamped = (over = {}) => unstamped({ ...SCOPE, ...over })
    const run = (doc, { before = null, others = {} } = {}) => {
      install({ jobs: { j3: JOB3, j4: OTHER }, [collection]: { d1: doc, ...others } })
      return trigger.run(documentEvent(collection, 'd1', doc, before))
    }

    it('stamps the tenantId and clientUids of its job onto a document that has neither', async () => {
      await run(unstamped())
      assert.deepEqual(stub.writes, [{ op: 'update', path: `${collection}/d1`, data: SCOPE }])
    })

    it('stamps exactly those two fields and nothing else of the document', async () => {
      await run(unstamped({ status: 'Open', amount: 4100 }))
      assert.deepEqual(Object.keys(stub.writes[0].data).sort(), ['clientUids', 'tenantId'])
    })

    it('stamps the job with that id, and not another', async () => {
      await run(unstamped({ [field]: 'QBS-004' }))
      assert.deepEqual(stub.writes[0].data, { tenantId: 'vision', clientUids: ['c9'] })
    })

    it('stamps a document that has only one of the two fields', async () => {
      await run(unstamped({ tenantId: 'qbs' }))
      assert.equal(stub.writes.length, 1)
      reset()
      await run(unstamped({ clientUids: ['c1', 'c2'] }))
      assert.equal(stub.writes.length, 1)
    })

    it('stamps again a document that carries other clients than its job', async () => {
      await run(stamped({ clientUids: ['c1'] }))
      assert.deepEqual(stub.writes[0].data, SCOPE)
      reset()
      await run(stamped({ clientUids: [] }))
      assert.deepEqual(stub.writes[0].data, SCOPE)
    })

    it('stamps a document whose tenant is empty or not text, as one with no tenant', async () => {
      for (const tenantId of ['', 7]) {
        reset()
        await run(unstamped({ tenantId }))
        assert.deepEqual(stub.writes, [{ op: 'update', path: `${collection}/d1`, data: SCOPE }], String(tenantId))
      }
    })

    it('writes nothing for a document that already carries the scope of its job', async () => {
      await run(stamped())
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`, 'query:jobs:id==QBS-003'], 'it did look, document first')
    })

    it('does not treat the same clients in another order as a difference', async () => {
      await run(stamped({ clientUids: ['c2', 'c1'] }))
      assert.deepEqual(stub.writes, [])
    })

    it('stamps the legacy default tenant when its job has none', async () => {
      install({ jobs: { j3: { id: 'QBS-003' } }, [collection]: { d1: unstamped() } })
      await trigger.run(documentEvent(collection, 'd1', unstamped()))
      assert.deepEqual(stub.writes[0].data, { tenantId: 'qbs', clientUids: [] })
    })

    it('logs, and leaves the document alone, when its job cannot be found', async () => {
      await run(unstamped({ [field]: 'QBS-404' }))
      assert.deepEqual(stub.writes, [])
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], new RegExp(`${collection}/d1`))
      assert.match(warnings()[0], /QBS-404/)
      assertNoDashes(warnings()[0].replace('QBS-404', 'ID'))
    })

    it('writes nothing for a deleted document, and does not even open a transaction', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: {} })
      await trigger.run(documentEvent(collection, 'd1', null, unstamped()))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })

    for (const none of [undefined, null, '', 7]) {
      it(`leaves a document alone that names no job (${JSON.stringify(none)}), reading nothing`, async () => {
        const doc = { subject: 'Staff note', [field]: none }
        install({ jobs: { j3: JOB3 }, [collection]: { d1: doc } })
        await trigger.run(documentEvent(collection, 'd1', doc))
        assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
      })
    }

    it('writes nothing when the document is gone by the time the transaction reads it', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: {} })
      await trigger.run(documentEvent(collection, 'd1', unstamped()))
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`])
    })

    it('uses the document as it is now: one stamped since the event writes nothing', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: stamped() } })
      await trigger.run(documentEvent(collection, 'd1', unstamped()))
      assert.deepEqual(stub.writes, [])
    })

    it('does nothing, and warns, when the event carries no data', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: {} })
      await trigger.run(noEvent)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(warnings().length, 1)
    })

    it('reads before it writes, as Firestore requires, in one transaction', async () => {
      await run(unstamped())
      assert.deepEqual(stub.calls.filter((entry) => entry === 'runTransaction'), ['runTransaction'])
      assert.equal(stub.reads.length, 2)
    })

    it('does not fire itself: the document it stamped needs nothing more', async () => {
      const doc = unstamped()
      await run(doc)
      const next = applied({ jobs: { j3: JOB3, j4: OTHER }, [collection]: { d1: doc } }, stub.writes)
      restart(next)
      await trigger.run(documentEvent(collection, 'd1', next[collection].d1, doc))
      assert.deepEqual(stub.writes, [])
    })

    it('fails the event, and writes nothing, when the job lookup inside the transaction fails', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: unstamped() } })
      breakTransactions({ query: new Error('read failed') })
      await assert.rejects(trigger.run(documentEvent(collection, 'd1', unstamped())), /read failed/)
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`], 'the document was read first, and the lookup of its job is what failed')
    })

    it('fails the event, having read both, when the write inside the transaction fails', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: unstamped() } })
      breakTransactions({ update: new Error('write failed') })
      await assert.rejects(trigger.run(documentEvent(collection, 'd1', unstamped())), /write failed/)
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`, 'query:jobs:id==QBS-003'])
    })
  })
}

// A change order is written by staff, who may point it at any job, so it takes its
// job's tenant whatever it carried. A submission that carries a tenant is never moved
// to another one: a builder stamps their own tenant on the submissions they create,
// and naming a job of another tenant must not put one in that tenant's portals.
describe('a document that carries another tenant than its job', () => {
  const JOB3 = { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1', 'c2'] }
  const SCOPE = { tenantId: 'qbs', clientUids: ['c1', 'c2'] }

  it('onExtraWritten moves a change order to the tenant of its job', async () => {
    const doc = { desc: 'Panel', job: 'QBS-003', tenantId: 'vision', clientUids: ['c9'] }
    install({ jobs: { j3: JOB3 }, extras: { d1: doc } })
    await onExtraWritten.run(documentEvent('extras', 'd1', doc))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'extras/d1', data: SCOPE }])
    assert.deepEqual(warnings(), [])
  })

  it('onSubmitWritten leaves a submission in its tenant, writing nothing, not even its clients', async () => {
    const doc = { subject: 'Panel', jobId: 'QBS-003', tenantId: 'vision', clientUids: [] }
    install({ jobs: { j3: JOB3 }, submits: { d1: doc } })
    await onSubmitWritten.run(documentEvent('submits', 'd1', doc))
    assert.deepEqual(stub.writes, [])
    assert.deepEqual(stub.reads, ['submits/d1', 'query:jobs:id==QBS-003'], 'it read the submission and looked up its job')
  })

  it('onSubmitWritten warns once, naming the submission, the tenant it carries and its job tenant', async () => {
    const doc = { subject: 'Panel', jobId: 'QBS-003', tenantId: 'vision', clientUids: [] }
    install({ jobs: { j3: JOB3 }, submits: { d1: doc } })
    await onSubmitWritten.run(documentEvent('submits', 'd1', doc))
    assert.equal(warnings().length, 1)
    const [warning] = warnings()
    assert.match(warning, /submits\/d1/)
    assert.match(warning, /\bvision\b/)
    assert.match(warning, /\bqbs\b/)
    assertNoDashes(warning.replace('QBS-003', 'ID'))
  })

  it('onSubmitWritten still gives a submission of the same tenant the clients of its job', async () => {
    const doc = { subject: 'Panel', jobId: 'QBS-003', tenantId: 'qbs', clientUids: [] }
    install({ jobs: { j3: JOB3 }, submits: { d1: doc } })
    await onSubmitWritten.run(documentEvent('submits', 'd1', doc))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: SCOPE }])
    assert.deepEqual(warnings(), [])
  })

  it('onSubmitWritten compares with the legacy default for a job with no tenant', async () => {
    const doc = { subject: 'Panel', jobId: 'QBS-003', tenantId: 'vision', clientUids: [] }
    install({ jobs: { j3: { id: 'QBS-003' } }, submits: { d1: doc } })
    await onSubmitWritten.run(documentEvent('submits', 'd1', doc))
    assert.deepEqual(stub.writes, [])
    assert.equal(warnings().length, 1)
  })
})

describe('backfillScopes', () => {
  const OWNER = { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com' } }
  const callAs = (auth) => backfillScopes.run({ data: {}, auth, rawRequest: {} })
  const call = () => callAs(OWNER)

  // Two users, two jobs, one change order, and one submission that names no job.
  const small = () => ({
    users: {
      u1: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'], displayName: 'Dana Lee' },
      u2: { role: 'owner', tenantId: 'p2-core', displayName: 'Jesse Parker' },
    },
    jobs: {
      j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['stale'] },
      j2: { id: 'QBS-002' },
    },
    extras: { x1: { id: 'CO-001', job: 'QBS-001' } },
    submits: { s1: { subject: 'Staff note', jobId: null } },
    notifications: {},
  })
  const nothingElse = { jobs: {}, extras: {}, submits: {}, notifications: {} }

  describe('who may run it', () => {
    it('turns away a signed out caller, touching nothing', async () => {
      install(small())
      stubAuth()
      await assert.rejects(callAs(undefined), code('unauthenticated', 'You must be signed in.'))
      assert.deepEqual([stub.calls, stub.writes, fetched, claimed], [[], [], [], []])
    })

    it('turns away internal staff, a builder and a client before it reads or writes anything', async () => {
      install(small())
      stubAuth()
      for (const role of ['internal', 'builder', 'client']) {
        const caller = { uid: 'u9', token: { role, tenantId: 'qbs', email: 'x@y.co' } }
        await assert.rejects(callAs(caller), code('permission-denied', 'Owner access required.'), role)
      }
      assert.deepEqual([stub.calls, stub.writes, stub.batches, fetched, claimed, revoked], [[], [], [], [], [], []])
    })

    it('reads only the caller users document, for a token that carries no role, before it decides', async () => {
      install({ ...small(), users: { ...small().users, late: { role: 'internal' } } })
      stubAuth()
      await assert.rejects(callAs({ uid: 'late', token: { email: 'late@p2em.com' } }), code('permission-denied', 'Owner access required.'))
      assert.deepEqual(stub.calls, ['doc:users/late'])
      assert.deepEqual([stub.writes, fetched, claimed], [[], [], []])
    })

    it('lets in an owner whose role is only in the users document', async () => {
      install({ ...nothingElse, users: { late: { role: 'owner', tenantId: 'p2-core' } } })
      stubAuth()
      const result = await callAs({ uid: 'late', token: { email: 'late@p2em.com' } })
      assert.equal(result.ok, true)
    })
  })

  describe('what it returns', () => {
    it('counts the users, jobs, change orders, submissions and notifications, and what it left alone', async () => {
      install(small())
      stubAuth()
      assert.deepEqual(await call(), { ok: true, users: 2, jobs: 2, extras: 1, submits: 0, notifications: 0, skipped: 1 })
    })

    it('counts every collection it stamped', async () => {
      install({
        ...small(),
        extras: { x1: { job: 'QBS-001' }, x2: { job: 'QBS-002' } },
        submits: { s1: { jobId: 'QBS-001' }, s2: { jobId: null } },
        notifications: { n1: { jobId: 'QBS-001' }, n2: { jobId: 'QBS-001' }, n3: { jobId: 'QBS-002' } },
      })
      stubAuth()
      assert.deepEqual(await call(), { ok: true, users: 2, jobs: 2, extras: 2, submits: 1, notifications: 3, skipped: 1 })
    })

    it('returns zeros for an empty database', async () => {
      install({ users: {}, ...nothingElse })
      stubAuth()
      assert.deepEqual(await call(), { ok: true, users: 0, jobs: 0, extras: 0, submits: 0, notifications: 0, skipped: 0 })
      assert.deepEqual([stub.writes, stub.batches], [[], []])
    })

    it('returns the same counts, and leaves everything as the first run did, when it is run again over what that run wrote', async () => {
      const documents = small()
      install(documents)
      stubAuth()
      const first = await call()
      const firstClaims = structuredClone(claimed)
      const next = applied(documents, stub.writes)

      restart(next)
      stubAuth()
      assert.deepEqual(await call(), first)
      assert.deepEqual(claimed, firstClaims)
      assert.deepEqual(applied(next, stub.writes), next, 'the second run changes nothing the first one had not')
    })
  })

  describe('the users', () => {
    it('sets the claims of each user from their document, the way a first assignment does, and signs nobody out', async () => {
      install(small())
      stubAuth()
      await call()
      assert.deepEqual(claimed, [
        { uid: 'u1', claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } },
        { uid: 'u2', claims: { role: 'owner', tenantId: 'p2-core', clientJobIds: [] } },
      ])
      assert.deepEqual(revoked, [])
    })

    it('cleans the tenant per role, as onUserWritten does', async () => {
      install({
        users: {
          b1: { role: 'builder', tenantId: 'vision' },
          b2: { role: 'builder', tenantId: 'p2-core' },
          i1: { role: 'internal', tenantId: 'qbs' },
        },
        ...nothingElse,
      })
      stubAuth()
      await call()
      assert.deepEqual(claimed.map((entry) => [entry.uid, entry.claims.tenantId]), [['b1', 'vision'], ['b2', null], ['i1', 'p2-core']])
    })

    it('leaves out a user whose document has no valid role, with a line in the log, without counting them or reading their account', async () => {
      install({ users: { a: { displayName: 'No role' }, b: { role: 'superuser' }, c: { role: null }, d: { role: 'builder', tenantId: 'qbs' } }, ...nothingElse })
      stubAuth()
      const result = await call()
      assert.equal(result.users, 1)
      assert.deepEqual(fetched, ['d'])
      assert.deepEqual(claimed.map((entry) => entry.uid), ['d'])
      assert.equal(warnings().length, 3)
      for (const uid of ['a', 'b', 'c']) assert.equal(warnings().filter((line) => line.includes(`users/${uid} `)).length, 1, uid)
    })

    it('will not lower an owner or internal account, says so, and does not count it', async () => {
      install({
        users: {
          boss: { role: 'client', clientJobIds: ['QBS-001'] },
          pat: { role: 'builder', tenantId: 'qbs' },
          kim: { role: 'internal' },
          dana: { role: 'client', clientJobIds: [] },
        },
        ...nothingElse,
      })
      stubAuth({ existing: { boss: { role: 'owner' }, pat: { role: 'internal' }, kim: { role: 'internal' } } })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['kim', 'dana'], 'kim is internal and stays internal')
      assert.equal(result.users, 2)
      const [first, second, ...more] = warnings()
      assert.equal(more.length, 0)
      assert.match(first, /boss/)
      assert.match(first, /owner/)
      assert.match(first, /client/)
      assert.match(second, /pat/)
      assert.match(second, /internal/)
      assert.match(second, /builder/)
      for (const warning of [first, second]) assertNoDashes(warning)
    })

    it('lets a role go up or stay the same, and sets the claims of an account that has none yet', async () => {
      install({
        users: { a: { role: 'owner' }, b: { role: 'internal' }, c: { role: 'client', clientJobIds: [] }, d: { role: 'internal' } },
        ...nothingElse,
      })
      stubAuth({ existing: { a: { role: 'owner' }, b: { role: 'internal' }, c: { role: 'builder' } } })
      assert.equal((await call()).users, 4)
      assert.deepEqual(warnings(), [])
    })

    it('leaves an owner alone when the document has no role: no claims are set, and the log says why', async () => {
      install({ users: { boss: { displayName: 'No role yet' } }, ...nothingElse })
      stubAuth({ existing: { boss: { role: 'owner' } } })
      const result = await call()
      assert.deepEqual([claimed, result.users, fetched], [[], 0, []], 'nothing is set, and the account is not even read')
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /users\/boss has no valid role/)
    })

    it('skips a users document with no Auth account, logs it, and carries on with the others', async () => {
      install({ users: { ghost: { role: 'builder', tenantId: 'qbs' }, real: { role: 'builder', tenantId: 'vision' } }, ...nothingElse })
      stubAuth({
        getUserError: { ghost: authError('auth/user-not-found') },
        claimsError: { ghost: authError('auth/user-not-found') },
      })
      const result = await call()
      assert.equal(result.users, 1)
      assert.deepEqual(claimed.map((entry) => entry.uid), ['ghost', 'real'])
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /ghost/)
      assert.ok(!logged.some(([level]) => level === 'error'))
    })

    it('skips an account that goes missing only when its claims are set', async () => {
      install({ users: { ghost: { role: 'builder', tenantId: 'qbs' } }, ...nothingElse })
      stubAuth({ claimsError: { ghost: authError('auth/user-not-found') } })
      assert.equal((await call()).users, 0)
    })

    it('stops with a plain message, and logs the cause, on any other Auth failure, before touching a job', async () => {
      install(small())
      stubAuth({ getUserError: { u2: authError('auth/internal-error') } })
      await assert.rejects(call(), code('internal', 'The backfill stopped before it finished. It is safe to run again.'))
      assert.ok(logged.some(([level, , cause]) => level === 'error' && cause?.code === 'auth/internal-error'))
      assert.deepEqual([stub.writes, stub.batches], [[], []])
    })
  })

  // The users are visited one at a time, each with a call to Auth, so a long run can take a while,
  // and a users document can be edited meanwhile. What it sets must follow the documents as they
  // are when each is reached, not as the first scan found them. In these, u0 is visited first, and
  // while its account is read u1 (internal) is demoted to a client of QBS-001 and u2 (a client of
  // QBS-002) is made internal.
  describe('users that change while it runs', () => {
    const documents = () => ({
      users: {
        u0: { role: 'owner', tenantId: 'p2-core' },
        u1: { role: 'internal', tenantId: 'p2-core' },
        u2: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-002'] },
      },
      jobs: {
        j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: [] },
        j2: { id: 'QBS-002', tenantId: 'qbs', clientUids: ['u2'] },
      },
      extras: {},
      submits: {},
      notifications: {},
    })
    const afterU0 = (change) => (uid) => {
      if (uid === 'u0') change()
    }
    const demote = (users) =>
      afterU0(() => {
        users.u1 = { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] }
        users.u2 = { role: 'internal', tenantId: 'p2-core' }
      })
    const links = () => stub.written('jobs/').map((write) => [write.path, write.data.clientUids])

    it('sets the claims from each document as it is when its turn comes, and never puts back the role it had', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: demote(docs.users) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => [entry.uid, entry.claims.role]), [['u0', 'owner'], ['u1', 'client'], ['u2', 'internal']])
      assert.deepEqual(claimed[1].claims.clientJobIds, ['QBS-001'])
      assert.equal(result.users, 3)
      assert.ok(!claimed.some((entry) => entry.uid === 'u1' && entry.claims.role === 'internal'), 'internal is not set on u1 again')
    })

    it('links the jobs from the documents as they are after the claims, not as the first scan found them', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: demote(docs.users) })
      await call()
      assert.deepEqual(links(), [['jobs/j1', ['u1']], ['jobs/j2', []]])
    })

    it('does not set internal again, or lower the account, when it still has its old claims', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ existing: { u1: { role: 'internal' } }, meanwhile: demote(docs.users) })
      const result = await call()
      assert.ok(!claimed.some((entry) => entry.uid === 'u1'), 'nothing is set for u1: onUserWritten applies the demotion and signs them out')
      assert.equal(result.users, 2)
      assert.equal(warnings().filter((line) => line.includes('u1')).length, 1)
      assert.deepEqual(links(), [['jobs/j1', ['u1']], ['jobs/j2', []]], 'but the job links follow the documents')
    })

    it('skips a user whose document is gone by their turn, with one line in the log, and does not link them', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: afterU0(() => { delete docs.users.u2 }) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['u0', 'u1'])
      assert.equal(result.users, 2)
      const lines = warnings().filter((line) => line.includes('users/u2'))
      assert.equal(lines.length, 1)
      assert.match(lines[0], /users\/u2 is gone/)
      assertNoDashes(lines[0])
      assert.deepEqual(links(), [['jobs/j1', []], ['jobs/j2', []]], 'the stale link to u2 goes')
    })

    it('skips a user whose role is no longer valid by their turn, with one line in the log, and does not read their account', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: afterU0(() => { docs.users.u1 = { displayName: 'Role removed' } }) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['u0', 'u2'])
      assert.equal(result.users, 2)
      assert.ok(!fetched.includes('u1'))
      const lines = warnings().filter((line) => line.includes('users/u1'))
      assert.equal(lines.length, 1)
      assert.match(lines[0], /users\/u1 has no valid role/)
      assertNoDashes(lines[0])
    })

    it('links a client added while it ran, and leaves their claims to the trigger for their document', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: afterU0(() => { docs.users.u3 = { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } }) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['u0', 'u1', 'u2'])
      assert.equal(result.users, 3)
      assert.deepEqual(links(), [['jobs/j1', ['u3']], ['jobs/j2', ['u2']]])
    })

    it('reads each user document again when their turn comes, once each', async () => {
      install(documents())
      stubAuth()
      await call()
      assert.deepEqual(stub.calls.filter((entry) => entry.startsWith('doc:')), ['doc:users/u0', 'doc:users/u1', 'doc:users/u2'])
    })

    it('scans the users for the job links after it has been through them all, and just before the jobs are written', async () => {
      install(documents())
      stubAuth()
      await call()
      const scans = stub.calls.flatMap((entry, i) => (entry === 'collection:users' ? [i] : []))
      assert.equal(scans.length, 2, 'once to know whom to visit, once for the links')
      assert.ok(scans[1] > stub.calls.lastIndexOf('doc:users/u2'), 'the second scan comes after the last user was visited')
      assert.ok(scans[1] > stub.calls.indexOf('collection:jobs'), 'and after the jobs were read, so it is as fresh as it can be when they are written')
      assert.ok(stub.calls.indexOf('batch') > scans[1])
    })
  })

  describe('the jobs', () => {
    it('sets each job tenant to its own, or qbs when it has none, and writes only the two fields', async () => {
      install({
        users: {},
        jobs: { a: { id: 'QBS-001', tenantId: 'vision', address: '1 Main' }, b: { id: 'QBS-002' }, c: { id: 'QBS-003', tenantId: '' } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => [write.op, write.path, write.data]), [
        ['update', 'jobs/a', { tenantId: 'vision', clientUids: [] }],
        ['update', 'jobs/b', { tenantId: 'qbs', clientUids: [] }],
        ['update', 'jobs/c', { tenantId: 'qbs', clientUids: [] }],
      ])
    })

    it('sets clientUids to exactly the clients whose document lists the job, so a stale link goes', async () => {
      install(small())
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => [write.path, write.data]), [
        ['jobs/j1', { tenantId: 'qbs', clientUids: ['u1'] }],
        ['jobs/j2', { tenantId: 'qbs', clientUids: [] }],
      ])
    })

    it('links every client who lists a job, sorted, and one client to every job they list', async () => {
      install({
        users: {
          zed: { role: 'client', clientJobIds: ['QBS-001', 'QBS-002'] },
          amy: { role: 'client', clientJobIds: ['QBS-001'] },
        },
        jobs: { a: { id: 'QBS-001', tenantId: 'qbs' }, b: { id: 'QBS-002', tenantId: 'qbs', clientUids: ['gone'] } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => write.data.clientUids), [['amy', 'zed'], ['zed']])
    })

    it('links nobody because of what staff or a builder list', async () => {
      install({
        users: {
          o: { role: 'owner', clientJobIds: ['QBS-001'] },
          i: { role: 'internal', clientJobIds: ['QBS-001'] },
          b: { role: 'builder', tenantId: 'qbs', clientJobIds: ['QBS-001'] },
          x: { role: 'superuser', clientJobIds: ['QBS-001'] },
        },
        jobs: { a: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['o', 'i', 'b'] } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/')[0].data.clientUids, [])
    })

    it('ignores an id a client lists that no job has', async () => {
      install({ users: { c: { role: 'client', clientJobIds: ['QBS-404', 'QBS-001'] } }, jobs: { a: { id: 'QBS-001', tenantId: 'qbs' } }, extras: {}, submits: {}, notifications: {} })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => write.data.clientUids), [['c']])
    })

    it('writes every job even when it already carries the right fields, so the count shows the run covered it', async () => {
      install({
        users: { c: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { a: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c'] }, b: { id: 'QBS-002', tenantId: 'vision', clientUids: [] } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      assert.equal((await call()).jobs, 2)
      assert.equal(stub.written('jobs/').length, 2)
    })

    it('gives a job with no id a tenant and no clients, and has no document name it', async () => {
      install({
        users: { c: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { a: { address: '1 Main' } },
        extras: { x: { job: undefined } },
        submits: { s: { jobId: '' } },
        notifications: {},
      })
      stubAuth()
      const result = await call()
      assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs', clientUids: [] }])
      assert.deepEqual([result.jobs, result.extras, result.submits, result.skipped], [1, 0, 0, 2])
    })
  })

  describe('the change orders, submissions and notifications', () => {
    it('stamps each with the scope its job ended up with, the change orders by job and the others by jobId', async () => {
      install({
        users: { u1: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { j1: { id: 'QBS-001', tenantId: 'vision', clientUids: ['stale'] }, j2: { id: 'QBS-002' } },
        extras: { x1: { job: 'QBS-001' }, x2: { job: 'QBS-002', tenantId: 'vision', clientUids: ['stale'] } },
        submits: { s1: { jobId: 'QBS-001' }, s2: { jobId: 'QBS-002' } },
        notifications: { n1: { jobId: 'QBS-001' }, n2: { jobId: 'QBS-002' } },
      })
      stubAuth()
      await call()
      const stamp = (prefix) => stub.written(prefix).map((write) => [write.op, write.path, write.data])
      assert.deepEqual(stamp('extras/'), [
        ['update', 'extras/x1', { tenantId: 'vision', clientUids: ['u1'] }],
        ['update', 'extras/x2', { tenantId: 'qbs', clientUids: [] }],
      ])
      assert.deepEqual(stamp('submits/'), [
        ['update', 'submits/s1', { tenantId: 'vision', clientUids: ['u1'] }],
        ['update', 'submits/s2', { tenantId: 'qbs', clientUids: [] }],
      ])
      assert.deepEqual(stamp('notifications/'), [
        ['update', 'notifications/n1', { tenantId: 'vision', clientUids: ['u1'] }],
        ['update', 'notifications/n2', { tenantId: 'qbs', clientUids: [] }],
      ])
    })

    it('does not look at the field the other collections use: a change order names its job in job, not jobId', async () => {
      install({
        users: {},
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs' } },
        extras: { x1: { jobId: 'QBS-001' } },
        submits: { s1: { job: 'QBS-001' } },
        notifications: { n1: { job: 'QBS-001' } },
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.submits, result.notifications, result.skipped], [0, 0, 0, 3])
      assert.deepEqual(stub.written('extras/').concat(stub.written('submits/'), stub.written('notifications/')), [])
    })

    it('leaves alone, and counts as skipped, every document with no job it can take a scope from', async () => {
      install({
        users: {},
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs' } },
        extras: { a: { job: 'QBS-404' }, b: { job: '' }, c: {}, d: { job: 7 }, e: { job: 'QBS-001' } },
        submits: { f: { jobId: null }, g: { jobId: 'QBS-404' }, h: { jobId: 'QBS-001' } },
        notifications: { i: { jobId: 'QBS-404' }, j: { jobId: 'QBS-001' } },
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.submits, result.notifications, result.skipped], [1, 1, 1, 7])
      const touched = stub.writes.map((write) => write.path)
      for (const left of ['extras/a', 'extras/b', 'extras/c', 'extras/d', 'submits/f', 'submits/g', 'notifications/i']) {
        assert.ok(!touched.includes(left), `${left} is left alone`)
      }
    })

    it('leaves a submission that carries another tenant where it is, logs it, and counts it as skipped', async () => {
      install({
        users: { u1: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { j1: { id: 'QBS-001', tenantId: 'vision' } },
        extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
        submits: {
          s1: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [] },
          s2: { jobId: 'QBS-001', tenantId: 'vision', clientUids: [] },
          s3: { jobId: 'QBS-001' },
        },
        notifications: {},
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.submits, result.skipped], [1, 2, 1])
      const scope = { tenantId: 'vision', clientUids: ['u1'] }
      assert.deepEqual(stub.written('submits/').map((write) => [write.path, write.data]), [
        ['submits/s2', scope],
        ['submits/s3', scope],
      ])
      assert.deepEqual(stub.written('extras/').map((write) => [write.path, write.data]), [['extras/x1', scope]])
      const moved = warnings().filter((line) => line.includes('submits/s1'))
      assert.equal(moved.length, 1)
      assert.match(moved[0], /\bqbs\b/)
      assert.match(moved[0], /\bvision\b/)
      assertNoDashes(moved[0].replace('QBS-001', 'ID'))
    })

    it('compares a submission with the effective tenant of a job that has none stored, which is qbs', async () => {
      install({
        users: {},
        jobs: { j2: { id: 'QBS-002' } },
        extras: {},
        submits: {
          s1: { jobId: 'QBS-002', tenantId: 'qbs', clientUids: [] },
          s2: { jobId: 'QBS-002', tenantId: 'vision', clientUids: [] },
        },
        notifications: {},
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.submits, result.skipped], [1, 1])
      assert.deepEqual(stub.written('submits/').map((write) => write.path), ['submits/s1'])
      assert.equal(warnings().filter((line) => line.includes('submits/s2')).length, 1)
    })

    it('stamps a document even when it already carries the right scope, so the counts show the run covered it', async () => {
      install({
        users: {},
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
        extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
        submits: {},
        notifications: {},
      })
      stubAuth()
      assert.equal((await call()).extras, 1)
      assert.equal(stub.written('extras/').length, 1)
    })

    it('gives documents of one job their own copy of the clients', async () => {
      install({
        users: { u1: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs' } },
        extras: { x1: { job: 'QBS-001' } },
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      const [jobWrite] = stub.written('jobs/')
      const [extraWrite] = stub.written('extras/')
      assert.notEqual(jobWrite.data.clientUids, extraWrite.data.clientUids)
    })
  })

  describe('batches', () => {
    it('writes the jobs in batches of at most 400', async () => {
      const jobs = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`j${i}`, { id: `QBS-${String(i + 1).padStart(3, '0')}` }]))
      install({ users: {}, jobs, extras: {}, submits: {}, notifications: {} })
      stubAuth()
      assert.equal((await call()).jobs, 450)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 50])
    })

    it('writes the documents of each collection in batches of at most 400, none over the 500 Firestore allows', async () => {
      const notifications = Object.fromEntries(Array.from({ length: 1003 }, (_, i) => [`n${i}`, { jobId: 'QBS-001' }]))
      const extras = Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`x${i}`, { job: 'QBS-001' }]))
      install({ users: {}, jobs: { j1: { id: 'QBS-001' } }, extras, submits: {}, notifications })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.notifications], [401, 1003])
      assert.ok(stub.batches.every((group) => group.length <= 400))
      assert.deepEqual(stub.batches.map((group) => group.length), [1, 400, 1, 400, 400, 203])
    })
  })

  describe('when it fails', () => {
    it('stops with a plain message, with no dash in it, and logs the cause, when a batch cannot be committed', async () => {
      install(small())
      stubAuth()
      const cause = new Error('commit failed')
      mock.method(db, 'batch', () => ({ update: () => {}, commit: async () => { throw cause } }))
      await assert.rejects(call(), (err) => {
        code('internal', 'The backfill stopped before it finished. It is safe to run again.')(err)
        assertNoDashes(err.message)
        return true
      })
      assert.ok(logged.some(([level, , logCause]) => level === 'error' && logCause === cause))
    })

    it('stops with the same plain message when a collection cannot be read', async () => {
      install(small())
      stubAuth()
      mock.method(db, 'collection', () => ({ get: async () => { throw new Error('read failed') } }))
      await assert.rejects(call(), code('internal', 'The backfill stopped before it finished. It is safe to run again.'))
    })

    it('does not report success, or log a run, when it stopped', async () => {
      install(small())
      stubAuth({ getUserError: { u1: authError('auth/internal-error') } })
      await assert.rejects(call())
      assert.ok(!logged.some(([level]) => level === 'log'))
    })
  })

  describe('afterwards', () => {
    it('logs who ran it and what it did, once', async () => {
      install(small())
      stubAuth()
      const result = await call()
      const lines = logged.filter(([level]) => level === 'log').map(([, line]) => String(line))
      assert.equal(lines.length, 1)
      assert.match(lines[0], /o1/)
      assert.match(lines[0], new RegExp(JSON.stringify(result).replace(/[{}[\]()*+?.\\^$|]/g, '\\$&')))
    })

    it('writes only to jobs, change orders, submissions and notifications, and never creates a document', async () => {
      install({ ...small(), notifications: { n1: { jobId: 'QBS-001' } } })
      stubAuth()
      await call()
      assert.ok(stub.writes.length > 0)
      for (const write of stub.writes) {
        assert.equal(write.op, 'update')
        assert.match(write.path, /^(jobs|extras|submits|notifications)\//)
      }
    })

    it('leaves nothing for onExtraWritten and onSubmitWritten to do', async () => {
      const documents = {
        ...small(),
        extras: { x1: { job: 'QBS-001' }, x2: { job: 'QBS-002', tenantId: 'vision', clientUids: ['stale'] } },
        submits: { s1: { jobId: 'QBS-001' }, s2: { jobId: null } },
      }
      install(documents)
      stubAuth()
      await call()
      const next = applied(documents, stub.writes)
      for (const [collection, trigger] of [['extras', onExtraWritten], ['submits', onSubmitWritten]]) {
        for (const write of stub.written(`${collection}/`)) {
          restart(next)
          const id = write.path.split('/')[1]
          await trigger.run(documentEvent(collection, id, next[collection][id], documents[collection][id]))
          assert.deepEqual(stub.writes, [], `${write.path} is stamped, so its own trigger writes nothing`)
        }
      }
    })

    it('leaves nothing for onJobWritten to do for the jobs it wrote', async () => {
      const documents = small()
      install(documents)
      stubAuth()
      await call()
      const next = applied(documents, stub.writes)
      for (const id of ['j1', 'j2']) {
        restart(next)
        await onJobWritten.run(jobEvent(id, documents.jobs[id], next.jobs[id]))
        assert.deepEqual(stub.written('extras/').concat(stub.written('submits/'), stub.written('notifications/')), [], id)
      }
    })
  })
})
