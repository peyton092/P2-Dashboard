import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { carriesScope, clientLinks, creatorDecides, creatorOf, jobIdOf, listsClients, needsRestamp, scopeChanged, scopePatchFor, staysInTenant } from '../lib/scope-sync.js'
import { scopeForJob } from '../lib/scope.js'
import * as handlers from '../scope-sync.js'

// ── The pure rules ────────────────────────────────────────────────────────────
// Nothing in this file touches Firestore or Auth. The triggers and the backfill are
// tested in scope-sync-job, scope-sync-doc and scope-sync-backfill, against stubs.

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

describe('creatorOf', () => {
  it('is the uid a document names in createdBy', () => {
    assert.equal(creatorOf({ createdBy: 'b1' }), 'b1')
  })

  it('is null when createdBy is missing, empty or not text, or there is no document', () => {
    for (const createdBy of [undefined, null, '', 7]) assert.equal(creatorOf({ createdBy }), null, String(createdBy))
    assert.equal(creatorOf(null), null)
  })
})

describe('creatorDecides', () => {
  const JOB = { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }

  it('is true for a submission that names its creator and carries another tenant than its job', () => {
    assert.equal(creatorDecides({ tenantId: 'vision', createdBy: 'u1' }, JOB), true)
  })

  it('is false when the submission carries the tenant of its job, or none, or names no creator', () => {
    assert.equal(creatorDecides({ tenantId: 'qbs', createdBy: 'u1' }, JOB), false)
    for (const tenantId of [undefined, null, '', 7]) {
      assert.equal(creatorDecides({ tenantId, createdBy: 'u1' }, JOB), false, String(tenantId))
    }
    assert.equal(creatorDecides({ tenantId: 'vision' }, JOB), false)
  })

  it('compares with the legacy default for a job with no tenant, and is false when either side is missing', () => {
    assert.equal(creatorDecides({ tenantId: 'qbs', createdBy: 'u1' }, { id: 'QBS-002' }), false)
    assert.equal(creatorDecides({ tenantId: 'vision', createdBy: 'u1' }, { id: 'QBS-002' }), true)
    assert.equal(creatorDecides(null, JOB), false)
    assert.equal(creatorDecides({ tenantId: 'vision', createdBy: 'u1' }, null), false)
  })
})

describe('staysInTenant', () => {
  const JOB = { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }
  const planted = { jobId: 'QBS-001', tenantId: 'vision', clientUids: [], createdBy: 'b1' }

  it('is true for a submission a builder created that carries another tenant than its job', () => {
    assert.equal(staysInTenant(planted, JOB, 'builder'), true)
  })

  it('is false when anyone but a builder created it, or nobody knows who did', () => {
    for (const role of ['client', 'internal', 'owner', null, undefined, 'admin']) {
      assert.equal(staysInTenant(planted, JOB, role), false, String(role))
    }
  })

  it('is false for a builder submission that carries the tenant of its job, or no tenant', () => {
    for (const tenantId of ['qbs', '', null, undefined, 7]) {
      assert.equal(staysInTenant({ ...planted, tenantId }, JOB, 'builder'), false, String(tenantId))
    }
  })

  it('is false for a submission that names no creator, whatever role is passed', () => {
    const { createdBy: _createdBy, ...anonymous } = planted
    assert.equal(staysInTenant(anonymous, JOB, 'builder'), false)
  })
})

describe('listsClients', () => {
  it('is true for a clientUids list with something in it', () => {
    assert.equal(listsClients({ clientUids: ['c1'] }), true)
  })

  it('is false for an empty list, no list, something that is not a list, or no document', () => {
    for (const doc of [{ clientUids: [] }, {}, { clientUids: 'c1' }, { clientUids: null }, null, undefined]) {
      assert.equal(listsClients(doc), false, JSON.stringify(doc))
    }
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

describe('carriesScope', () => {
  it('is true for a document that has a tenantId or a clientUids field, whatever it holds', () => {
    for (const doc of [
      { tenantId: 'qbs', clientUids: ['c1'] },
      { tenantId: 'qbs' },
      { clientUids: ['c1'] },
      { clientUids: [] },
      { tenantId: '' },
      { tenantId: null, clientUids: null },
      { job: 'QBS-001', status: 'Draft', clientUids: 'c1' },
    ]) {
      assert.equal(carriesScope(doc), true, JSON.stringify(doc))
    }
  })

  it('is false for a document with neither field, whatever else it holds', () => {
    for (const doc of [{}, { job: 'QBS-001', status: 'Draft' }, { id: 'CO-009', amount: 4100, tenant: 'qbs', clients: ['c1'] }]) {
      assert.equal(carriesScope(doc), false, JSON.stringify(doc))
    }
  })

  it('is false when there is no document, or it is not a plain object', () => {
    for (const nothing of [null, undefined, 'tenantId', 7, true, ['tenantId']]) {
      assert.equal(carriesScope(nothing), false, JSON.stringify(nothing))
    }
  })

  it('looks at the fields themselves, so a field from the prototype does not count', () => {
    assert.equal(carriesScope(Object.create({ tenantId: 'qbs' })), false)
  })

  it('does not change the document it is given', () => {
    const doc = { job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }
    const copy = structuredClone(doc)
    carriesScope(doc)
    assert.deepEqual(doc, copy)
  })
})

describe('scope-sync.js exports', () => {
  it('re-exports the pure helpers the brief names, so callers and tests can import them from here', () => {
    assert.equal(handlers.needsRestamp, needsRestamp)
    assert.equal(handlers.scopePatchFor, scopePatchFor)
  })
})

