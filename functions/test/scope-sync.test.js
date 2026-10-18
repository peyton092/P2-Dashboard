import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { getAuth } from 'firebase-admin/auth'
import { db } from '../lib/admin.js'
import { clientLinks, needsRestamp, scopeChanged, scopePatchFor } from '../lib/scope-sync.js'
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
function stubAuth({ existing = {}, getUserError = {}, claimsError = {} } = {}) {
  const auth = getAuth()
  mock.method(auth, 'getUser', async (uid) => {
    fetched.push(uid)
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
const warnings = () => logged.filter(([level]) => level === 'warn').map(([, message]) => String(message))

const snap = (data, ref) => ({ exists: data != null, data: () => data, ref })

// A write to jobs/{docId}. before and after are the job as the event reports it (null for
// none). The handler reads the job again, and `now` is what it finds then: the same as
// after unless a test says otherwise. ref.update is the job writing to itself.
function jobEvent(docId, before, after, { now = after, updateError } = {}) {
  const path = `jobs/${docId}`
  const ref = {
    id: docId,
    path,
    rereads: 0,
    get: async () => {
      ref.rereads += 1
      return snap(now, ref)
    },
    update: async (data) => {
      if (updateError) throw updateError
      stub.writes.push({ op: 'update', path, data })
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
    it('reads the job again once, and stamps the change orders by job, and the submissions and notifications by jobId', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', JOB, after)
      await run(event)
      assert.equal(event.data.after.ref.rereads, 1)
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
    it('still stamps the documents when the job cannot be written to, and then fails the event', async () => {
      const after = { id: 'QBS-007', clientUids: [] }
      install({ jobs: { j7: after }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await assert.rejects(run(jobEvent('j7', null, after, { updateError: new Error('update failed') })), /update failed/)
      assert.equal(stub.written('extras/').length, 1)
    })

    it('still gives the job its tenant when the documents cannot be written, and then fails the event', async () => {
      const after = { id: 'QBS-007', clientUids: [] }
      install({ jobs: { j7: after }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      mock.method(db, 'batch', () => ({ update: () => {}, commit: async () => { throw new Error('commit failed') } }))
      await assert.rejects(run(jobEvent('j7', null, after)), /commit failed/)
      assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs' }])
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

  describe('many documents', () => {
    const many = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, { msg: `m${i}`, jobId: 'QBS-001', tenantId: 'qbs', clientUids: [] }]))

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

    it('stamps again a document that carries another job scope', async () => {
      await run(stamped({ tenantId: 'vision' }))
      assert.deepEqual(stub.writes[0].data, SCOPE)
      reset()
      await run(stamped({ clientUids: ['c1'] }))
      assert.deepEqual(stub.writes[0].data, SCOPE)
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

    it('fails the event, and writes nothing, when the job cannot be read', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: unstamped() } })
      mock.method(db, 'runTransaction', async () => { throw new Error('read failed') })
      await assert.rejects(trigger.run(documentEvent(collection, 'd1', unstamped())), /read failed/)
      assert.deepEqual(stub.writes, [])
    })
  })
}

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

    it('returns the same counts, and writes the same things, when it is run again', async () => {
      install(small())
      stubAuth()
      const first = await call()
      const firstWrites = structuredClone(stub.writes)
      stub.clear()
      assert.deepEqual(await call(), first)
      assert.deepEqual(stub.writes, firstWrites)
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

    it('leaves out a user whose document has no valid role, without counting or reading them', async () => {
      install({ users: { a: { displayName: 'No role' }, b: { role: 'superuser' }, c: { role: null }, d: { role: 'builder', tenantId: 'qbs' } }, ...nothingElse })
      stubAuth()
      const result = await call()
      assert.equal(result.users, 1)
      assert.deepEqual(fetched, ['d'])
      assert.deepEqual(claimed.map((entry) => entry.uid), ['d'])
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

    it('still lowers nothing for a role the document does not have: a bare document leaves an owner alone', async () => {
      install({ users: { boss: { displayName: 'No role yet' } }, ...nothingElse })
      stubAuth({ existing: { boss: { role: 'owner' } } })
      const result = await call()
      assert.deepEqual([claimed, result.users, warnings()], [[], 0, []])
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
