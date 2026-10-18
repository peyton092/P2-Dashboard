import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as extras from '../extras.js'
import { extraState, extraTransition } from '../lib/extras.js'
import { assertNoDashes, code, isServerTime, stubFirestore as installStub } from './helpers/firestore-stub.js'

const { approveExtra, rejectExtra, sendExtraToBuilder } = extras

// The Firestore stub is shared with the other handler tests (helpers/firestore-stub.js).
// Each test installs it with the documents that exist, and `stub` then holds what the
// handler did: stub.calls, stub.reads, stub.writes and stub.written(prefix).
//
// extras: { x1: { ...document } }   change orders that exist, by document id
// jobs:   { job3: { id: 'QBS-003' } }  job documents that exist, by document id
// users:  { u1: { displayName } }   users documents the actor lookup may read
let stub
const stubFirestore = (collections) => {
  stub = installStub(collections)
}

beforeEach(() => {
  stub = undefined
})

afterEach(() => {
  mock.restoreAll()
})

// Callers, as the sign in token describes them.
const OWNER = { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com', name: 'Jesse Parker' } }
const INTERNAL = { uid: 'i1', token: { role: 'internal', email: 'pat@p2em.com', name: 'Pat Lee' } }
const QBS = { uid: 'b1', token: { role: 'builder', tenantId: 'qbs', email: 'dana@qbs.example', name: 'Dana Lee' } }
const VISION = { uid: 'b2', token: { role: 'builder', tenantId: 'vision', email: 'vic@vision.example', name: 'Vic Reed' } }
const CLIENT = { uid: 'c1', token: { role: 'client', email: 'casey@client.example', name: 'Casey Hart', clientJobIds: ['QBS-003'] } }
const OTHER_CLIENT = { uid: 'c2', token: { role: 'client', email: 'rae@client.example', name: 'Rae Cole', clientJobIds: ['QBS-009'] } }

// A change order sent to the builder, already stamped with its job's scope, and
// one written before stamping existed (no tenantId, no clientUids).
const stamped = (over = {}) => ({
  id: 'CO-004',
  job: 'QBS-003',
  amount: 4100,
  status: 'Sent to Builder',
  tenantId: 'qbs',
  clientUids: ['c1'],
  ...over,
})
const legacy = (over = {}) => ({ id: 'CO-004', job: 'QBS-003', amount: 4100, status: 'pending', ...over })
const JOB = { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1'] }

const call = (fn, data, auth) => fn.run({ data, auth, rawRequest: {} })

describe('the guards run before anything is read', () => {
  it('turns a signed out caller away from all three, touching nothing', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    for (const fn of [approveExtra, rejectExtra, sendExtraToBuilder]) {
      await assert.rejects(call(fn, { extraId: 'x1', note: 'n' }, undefined), code('unauthenticated', 'You must be signed in.'))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('turns a builder and a client away from sendExtraToBuilder, touching nothing', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) } })
    for (const auth of [QBS, CLIENT]) {
      await assert.rejects(call(sendExtraToBuilder, { extraId: 'x1' }, auth), code('permission-denied', 'Staff access required.'))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('reads users/{uid} for a token without a role, and then still refuses a role less caller', async () => {
    stubFirestore({ extras: { x1: stamped() }, users: {} })
    const noClaims = { uid: 'ghost', token: { email: 'ghost@x.example', name: 'Ghost' } }
    await assert.rejects(call(approveExtra, { extraId: 'x1' }, noClaims), code('permission-denied', 'You can only act on change orders for your own projects.'))
    // The guard reads the caller's users document for the role, and the actor lookup
    // reads it again for the name, which it takes from the document before the token.
    assert.deepEqual(stub.calls.filter((entry) => entry.startsWith('doc:')), ['doc:users/ghost', 'doc:users/ghost'])
    assert.deepEqual(stub.writes, [])
  })


  it('takes the role of a token without one from the users document', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) }, jobs: { job3: JOB }, users: { late: { role: 'internal' } } })
    const noClaims = { uid: 'late', token: { email: 'late@p2em.com', name: 'Late Staff' } }
    assert.deepEqual(await call(sendExtraToBuilder, { extraId: 'x1' }, noClaims), { ok: true })
    assert.equal(stub.written('extras/')[0].data.status, 'Sent to Builder')
  })
})

describe('approveExtra', () => {
  it('lets a builder of the change order tenant approve it, and answers { ok: true }', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    assert.deepEqual(await call(approveExtra, { extraId: 'x1' }, QBS), { ok: true })
    assert.equal(stub.written('extras/').length, 1)
  })

  it('writes the approval onto the change order', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(approveExtra, { extraId: 'x1' }, QBS)
    const [patch] = stub.written('extras/')
    assert.equal(patch.op, 'update')
    assert.equal(patch.path, 'extras/x1')
    assert.deepEqual(Object.keys(patch.data).sort(), ['approvedAt', 'approvedBy', 'status'])
    assert.equal(patch.data.status, 'Approved')
    assert.deepEqual(patch.data.approvedBy, { uid: 'b1', email: 'dana@qbs.example', displayName: 'Dana Lee' })
    assert.ok(isServerTime(patch.data.approvedAt), 'approvedAt is a server timestamp')
  })

  it('writes the notification, scoped like the change order and signed by the caller', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(approveExtra, { extraId: 'x1' }, QBS)
    const [note] = stub.written('notifications/')
    assert.equal(note.op, 'set')
    assert.deepEqual(Object.keys(note.data).sort(), [
      'clientUids', 'createdAt', 'createdBy', 'createdByEmail', 'jobId', 'msg', 'read', 'tenantId', 'type',
    ])
    assert.equal(note.data.type, 'success')
    assert.equal(note.data.msg, 'CO-004 approved by Dana Lee: $4,100 (QBS-003)')
    assert.equal(note.data.jobId, 'QBS-003')
    assert.equal(note.data.tenantId, 'qbs')
    assert.deepEqual(note.data.clientUids, ['c1'])
    assert.equal(note.data.createdBy, 'b1')
    assert.equal(note.data.createdByEmail, 'dana@qbs.example')
    assert.equal(note.data.read, false)
    assert.ok(isServerTime(note.data.createdAt))
  })

  it('writes the history line the Activity feed renders', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(approveExtra, { extraId: 'x1' }, QBS)
    const [line] = stub.written('history/')
    assert.equal(line.op, 'set')
    assert.deepEqual(Object.keys(line.data).sort(), [
      'action', 'actor', 'actorEmail', 'actorUid', 'createdAt', 'createdBy', 'createdByEmail', 'extraId', 'jobId', 'summary', 'type',
    ])
    assert.equal(line.data.type, 'change-order')
    assert.equal(line.data.action, 'approved')
    assert.equal(line.data.summary, 'CO-004 approved: $4,100')
    assert.equal(line.data.actor, 'Dana Lee')
    assert.equal(line.data.actorUid, 'b1')
    assert.equal(line.data.actorEmail, 'dana@qbs.example')
    assert.equal(line.data.jobId, 'QBS-003')
    assert.equal(line.data.extraId, 'x1')
    assert.equal(line.data.createdBy, 'b1')
    assert.equal(line.data.createdByEmail, 'dana@qbs.example')
  })

  it('writes the change, the notification and the history line in one transaction, after reading the change order in it', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(approveExtra, { extraId: 'x1' }, QBS)
    assert.ok(stub.calls.includes('runTransaction'))
    assert.deepEqual(stub.reads, ['extras/x1'])
    assert.equal(stub.writes.length, 3)
  })

  it('does not stamp a change order that is already stamped', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(approveExtra, { extraId: 'x1' }, QBS)
    const [patch] = stub.written('extras/')
    assert.equal('tenantId' in patch.data, false)
    assert.equal('clientUids' in patch.data, false)
    assert.ok(!stub.reads.some((r) => r.startsWith('query:')), 'no job lookup was needed')
  })

  it('lets a client linked to the change order approve it', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    assert.deepEqual(await call(approveExtra, { extraId: 'x1' }, CLIENT), { ok: true })
    assert.equal(stub.written('extras/')[0].data.approvedBy.uid, 'c1')
    assert.equal(stub.written('notifications/')[0].data.msg, 'CO-004 approved by Casey Hart: $4,100 (QBS-003)')
  })

  it('lets staff approve any change order', async () => {
    stubFirestore({ extras: { x1: stamped({ tenantId: 'vision', clientUids: [] }) } })
    for (const auth of [OWNER, INTERNAL]) {
      stub.clear()
      await call(approveExtra, { extraId: 'x1' }, auth)
      assert.equal(stub.written('extras/')[0].data.status, 'Approved')
    }
  })

  it('refuses a builder of another tenant, and writes nothing', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await assert.rejects(
      call(approveExtra, { extraId: 'x1' }, VISION),
      code('permission-denied', 'You can only act on change orders for your own projects.'),
    )
    assert.deepEqual(stub.writes, [])
  })

  it('refuses a client who is not linked to the change order, and writes nothing', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await assert.rejects(
      call(approveExtra, { extraId: 'x1' }, OTHER_CLIENT),
      code('permission-denied', 'You can only act on change orders for your own projects.'),
    )
    assert.deepEqual(stub.writes, [])
  })

  it('refuses a builder with no tenant, and a caller with a role that does not exist', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    const noTenant = { uid: 'b9', token: { role: 'builder', name: 'No Tenant' } }
    const odd = { uid: 'z9', token: { role: 'admin', tenantId: 'qbs', name: 'Odd' } }
    for (const auth of [noTenant, odd]) {
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, auth), code('permission-denied'))
    }
    assert.deepEqual(stub.writes, [])
  })

  it('does not say whether a change order is decided to a caller who may not act on it', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Approved' }) } })
    await assert.rejects(
      call(approveExtra, { extraId: 'x1' }, VISION),
      code('permission-denied', 'You can only act on change orders for your own projects.'),
    )
  })

  it('answers a change order that does not exist with not-found', async () => {
    stubFirestore({ extras: {} })
    await assert.rejects(call(approveExtra, { extraId: 'gone' }, QBS), code('not-found', 'That change order no longer exists.'))
    assert.deepEqual(stub.writes, [])
  })

  it('refuses a change order that has been decided, in either casing', async () => {
    for (const status of ['Approved', 'approved', 'Rejected', 'rejected']) {
      stubFirestore({ extras: { x1: stamped({ status }) } })
      await assert.rejects(
        call(approveExtra, { extraId: 'x1' }, QBS),
        code('failed-precondition', 'This change order has already been decided.'),
        status,
      )
      assert.deepEqual(stub.writes, [], status)
      mock.restoreAll()
    }
  })

  it('refuses a draft, which has not been sent for approval', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) } })
    await assert.rejects(
      call(approveExtra, { extraId: 'x1' }, QBS),
      code('failed-precondition', 'This change order has not been sent for approval.'),
    )
    assert.deepEqual(stub.writes, [])
  })

  it('approves one that still has the lower case pending status the demo data uses', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'pending' }) } })
    assert.deepEqual(await call(approveExtra, { extraId: 'x1' }, QBS), { ok: true })
    assert.equal(stub.written('extras/')[0].data.status, 'Approved')
  })

  it('takes the actor from the sign in token, never from the request', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(
      approveExtra,
      { extraId: 'x1', approvedBy: 'The Owner', actor: { uid: 'o1', displayName: 'The Owner' }, uid: 'o1', displayName: 'The Owner' },
      QBS,
    )
    assert.deepEqual(stub.written('extras/')[0].data.approvedBy, { uid: 'b1', email: 'dana@qbs.example', displayName: 'Dana Lee' })
    assert.equal(stub.written('history/')[0].data.actorUid, 'b1')
  })

  it('records a caller whose token has no email with null, never undefined', async () => {
    // The stub refuses undefined anywhere in written data, as Firestore does.
    stubFirestore({ extras: { x1: stamped() } })
    const noEmail = { uid: 'b5', token: { role: 'builder', tenantId: 'qbs', name: 'Dana Lee' } }
    await call(approveExtra, { extraId: 'x1' }, noEmail)
    assert.equal(stub.written('extras/')[0].data.approvedBy.email, null)
    assert.equal(stub.written('notifications/')[0].data.createdByEmail, null)
    assert.equal(stub.written('history/')[0].data.actorEmail, null)
    assert.equal(stub.written('history/')[0].data.createdByEmail, null)
  })

  it('takes the name from the users document when the token has none, then from the email', async () => {
    stubFirestore({ extras: { x1: stamped() }, users: { b1: { displayName: 'Dana From Doc' } } })
    const nameless = { uid: 'b1', token: { role: 'builder', tenantId: 'qbs', email: 'dana@qbs.example' } }
    await call(approveExtra, { extraId: 'x1' }, nameless)
    assert.equal(stub.written('extras/')[0].data.approvedBy.displayName, 'Dana From Doc')
    mock.restoreAll()

    stub.clear()
    stubFirestore({ extras: { x1: stamped() }, users: {} })
    await call(approveExtra, { extraId: 'x1' }, nameless)
    assert.equal(stub.written('extras/')[0].data.approvedBy.displayName, 'dana@qbs.example')
  })

  it('takes the name the users document gives the caller over the one on the token', async () => {
    stubFirestore({ extras: { x1: stamped() }, users: { b1: { displayName: 'Dana Lee Parker' } } })
    await call(approveExtra, { extraId: 'x1' }, QBS)
    assert.equal(stub.written('extras/')[0].data.approvedBy.displayName, 'Dana Lee Parker')
    assert.equal(stub.written('history/')[0].data.actor, 'Dana Lee Parker')
  })

  it('ignores a note, since an approval has nowhere to keep one', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(approveExtra, { extraId: 'x1', note: 'looks good' }, QBS)
    assert.deepEqual(Object.keys(stub.written('extras/')[0].data).sort(), ['approvedAt', 'approvedBy', 'status'])
  })

  it('refuses a missing or unusable change order id before reading anything', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    for (const data of [undefined, null, {}, { extraId: '' }, { extraId: 5 }, { extraId: 'x1/files/y' }, { extraId: '..' }]) {
      await assert.rejects(call(approveExtra, data, QBS), code('invalid-argument', 'Choose a change order.'))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  describe('a change order written before scopes were stamped', () => {
    it('takes its scope from its job, and stamps it in the same update', async () => {
      stubFirestore({ extras: { x1: legacy() }, jobs: { job3: JOB } })
      await call(approveExtra, { extraId: 'x1' }, QBS)
      assert.deepEqual(stub.reads, ['extras/x1', 'query:jobs:id==QBS-003'])
      const [patch] = stub.written('extras/')
      assert.deepEqual(Object.keys(patch.data).sort(), ['approvedAt', 'approvedBy', 'clientUids', 'status', 'tenantId'])
      assert.equal(patch.data.tenantId, 'qbs')
      assert.deepEqual(patch.data.clientUids, ['c1'])
    })

    it('puts the job scope on the notification too', async () => {
      stubFirestore({ extras: { x1: legacy() }, jobs: { job3: { ...JOB, tenantId: 'vision', clientUids: ['c1', 'c7'] } } })
      await call(approveExtra, { extraId: 'x1' }, VISION)
      const [note] = stub.written('notifications/')
      assert.equal(note.data.tenantId, 'vision')
      assert.deepEqual(note.data.clientUids, ['c1', 'c7'])
    })

    it('lets a client linked on the job approve, and refuses one who is not', async () => {
      stubFirestore({ extras: { x1: legacy() }, jobs: { job3: JOB } })
      assert.deepEqual(await call(approveExtra, { extraId: 'x1' }, CLIENT), { ok: true })
      stub.clear()
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, OTHER_CLIENT), code('permission-denied'))
      assert.deepEqual(stub.writes, [])
    })

    it('refuses a builder whose tenant is not the job tenant, and writes nothing', async () => {
      stubFirestore({ extras: { x1: legacy() }, jobs: { job3: JOB } })
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, VISION), code('permission-denied'))
      assert.deepEqual(stub.writes, [])
    })

    it('gives a job with no tenant of its own the qbs default, for the check and for the stamp', async () => {
      // A legacy job nobody has stamped yet: scopeForJob reads it as tenant qbs with no clients.
      stubFirestore({ extras: { x1: legacy() }, jobs: { job3: { id: 'QBS-003' } } })
      await assert.rejects(
        call(approveExtra, { extraId: 'x1' }, VISION),
        code('permission-denied', 'You can only act on change orders for your own projects.'),
      )
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, CLIENT), code('permission-denied'))
      assert.deepEqual(stub.writes, [])

      assert.deepEqual(await call(approveExtra, { extraId: 'x1' }, QBS), { ok: true })
      const [patch] = stub.written('extras/')
      assert.equal(patch.data.status, 'Approved')
      assert.equal(patch.data.tenantId, 'qbs')
      assert.deepEqual(patch.data.clientUids, [])
      const [note] = stub.written('notifications/')
      assert.equal(note.data.tenantId, 'qbs')
      assert.deepEqual(note.data.clientUids, [])
    })

    it('treats a change order with only one of the two fields as unstamped', async () => {
      stubFirestore({ extras: { x1: legacy({ tenantId: 'vision' }), x2: legacy({ clientUids: ['c1'] }) }, jobs: { job3: JOB } })
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, VISION), code('permission-denied'))
      await call(approveExtra, { extraId: 'x2' }, QBS)
      assert.equal(stub.written('extras/')[0].data.tenantId, 'qbs')
    })

    it('answers a change order whose job is gone with not-found, and writes nothing', async () => {
      stubFirestore({ extras: { x1: legacy() }, jobs: {} })
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, QBS), code('not-found', 'That job no longer exists.'))
      assert.deepEqual(stub.writes, [])
    })

    it('answers a change order that names no job with not-found', async () => {
      stubFirestore({ extras: { x1: legacy({ job: undefined }), x2: legacy({ job: '' }) }, jobs: { job3: JOB } })
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, QBS), code('not-found', 'That job no longer exists.'))
      await assert.rejects(call(approveExtra, { extraId: 'x2' }, QBS), code('not-found', 'That job no longer exists.'))
    })
  })
})

describe('rejectExtra', () => {
  const NOTE = 'Use the 200A panel'

  it('requires a note, and refuses before reading anything when there is none', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    for (const note of [undefined, null, '', '   ', 5, {}, 'x'.repeat(1001)]) {
      await assert.rejects(call(rejectExtra, { extraId: 'x1', note }, QBS), code('invalid-argument', 'Say what should be revised.'))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('writes the rejection with who, when and the trimmed note', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    assert.deepEqual(await call(rejectExtra, { extraId: 'x1', note: `  ${NOTE}  ` }, QBS), { ok: true })
    const [patch] = stub.written('extras/')
    assert.equal(patch.op, 'update')
    assert.deepEqual(Object.keys(patch.data).sort(), ['rejectNotes', 'rejectedAt', 'rejectedBy', 'status'])
    assert.equal(patch.data.status, 'Rejected')
    assert.deepEqual(patch.data.rejectedBy, { uid: 'b1', email: 'dana@qbs.example', displayName: 'Dana Lee' })
    assert.equal(patch.data.rejectNotes, NOTE)
    assert.ok(isServerTime(patch.data.rejectedAt))
  })

  it('writes a warn notification and a history line, with the note cut short', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(rejectExtra, { extraId: 'x1', note: 'a'.repeat(120) }, QBS)
    const [note] = stub.written('notifications/')
    assert.equal(note.data.type, 'warn')
    assert.equal(note.data.msg, `CO-004 revision requested by Dana Lee (QBS-003): ${'a'.repeat(80)}`)
    assert.equal(note.data.tenantId, 'qbs')
    assert.deepEqual(note.data.clientUids, ['c1'])
    const [line] = stub.written('history/')
    assert.equal(line.data.type, 'change-order')
    assert.equal(line.data.action, 'rejected')
    assert.equal(line.data.summary, `CO-004 revision requested: ${'a'.repeat(60)}`)
    assert.equal(line.data.extraId, 'x1')
    assert.equal(line.data.actor, 'Dana Lee')
  })

  it('stores the whole note on the change order even though the notification cuts it', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(rejectExtra, { extraId: 'x1', note: 'b'.repeat(900) }, QBS)
    assert.equal(stub.written('extras/')[0].data.rejectNotes.length, 900)
  })

  it('lets a linked client ask for a revision', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    await call(rejectExtra, { extraId: 'x1', note: NOTE }, CLIENT)
    assert.equal(stub.written('extras/')[0].data.rejectedBy.uid, 'c1')
  })

  it('refuses a builder of another tenant and a client who is not linked', async () => {
    stubFirestore({ extras: { x1: stamped() } })
    for (const auth of [VISION, OTHER_CLIENT]) {
      await assert.rejects(
        call(rejectExtra, { extraId: 'x1', note: NOTE }, auth),
        code('permission-denied', 'You can only act on change orders for your own projects.'),
      )
    }
    assert.deepEqual(stub.writes, [])
  })

  it('refuses a draft and a change order that is already decided', async () => {
    stubFirestore({ extras: { d: stamped({ status: 'Draft' }), a: stamped({ status: 'Approved' }), r: stamped({ status: 'rejected' }) } })
    await assert.rejects(call(rejectExtra, { extraId: 'd', note: NOTE }, QBS), code('failed-precondition', 'This change order has not been sent for approval.'))
    await assert.rejects(call(rejectExtra, { extraId: 'a', note: NOTE }, QBS), code('failed-precondition', 'This change order has already been decided.'))
    await assert.rejects(call(rejectExtra, { extraId: 'r', note: NOTE }, QBS), code('failed-precondition', 'This change order has already been decided.'))
    assert.deepEqual(stub.writes, [])
  })

  it('stamps a change order written before scopes existed', async () => {
    stubFirestore({ extras: { x1: legacy() }, jobs: { job3: JOB } })
    await call(rejectExtra, { extraId: 'x1', note: NOTE }, QBS)
    const [patch] = stub.written('extras/')
    assert.equal(patch.data.tenantId, 'qbs')
    assert.deepEqual(patch.data.clientUids, ['c1'])
  })
})

describe('sendExtraToBuilder', () => {
  it('sends a draft: status, the qbs flag and both send times, with the scope of its job', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) }, jobs: { job3: JOB } })
    assert.deepEqual(await call(sendExtraToBuilder, { extraId: 'x1' }, INTERNAL), { ok: true })
    const [patch] = stub.written('extras/')
    assert.equal(patch.op, 'update')
    assert.equal(patch.path, 'extras/x1')
    assert.deepEqual(Object.keys(patch.data).sort(), ['clientUids', 'qbs', 'qbsSentAt', 'sentAt', 'status', 'tenantId'])
    assert.equal(patch.data.status, 'Sent to Builder')
    assert.equal(patch.data.qbs, true)
    assert.ok(isServerTime(patch.data.qbsSentAt))
    assert.ok(isServerTime(patch.data.sentAt))
  })

  it('writes an info notification for the builder, scoped like the change order', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) }, jobs: { job3: JOB } })
    await call(sendExtraToBuilder, { extraId: 'x1' }, OWNER)
    const [note] = stub.written('notifications/')
    assert.equal(note.data.type, 'info')
    assert.equal(note.data.msg, 'CO-004 sent to the builder: $4,100 (QBS-003)')
    assert.equal(note.data.tenantId, 'qbs')
    assert.deepEqual(note.data.clientUids, ['c1'])
    assert.equal(note.data.createdBy, 'o1')
    assert.equal(note.data.createdByEmail, 'jesse@p2em.com')
    const [line] = stub.written('history/')
    assert.equal(line.data.action, 'sent')
    assert.equal(line.data.summary, 'CO-004 sent to the builder: $4,100')
    assert.equal(line.data.actor, 'Jesse Parker')
  })

  it('sends again after a rejection, and again when it was already sent', async () => {
    stubFirestore({ extras: { r: stamped({ status: 'Rejected' }), s: stamped({ status: 'Sent to Builder' }), p: stamped({ status: 'pending' }) } })
    for (const id of ['r', 's', 'p']) {
      stub.clear()
      assert.deepEqual(await call(sendExtraToBuilder, { extraId: id }, OWNER), { ok: true })
      assert.equal(stub.written('extras/')[0].data.status, 'Sent to Builder', id)
    }
  })

  it('refuses a change order that is already approved', async () => {
    stubFirestore({ extras: { a: stamped({ status: 'Approved' }), b: stamped({ status: 'approved' }) } })
    for (const id of ['a', 'b']) {
      await assert.rejects(call(sendExtraToBuilder, { extraId: id }, OWNER), code('failed-precondition', 'This change order is already approved.'))
    }
    assert.deepEqual(stub.writes, [])
  })

  it('stamps a change order written before scopes existed, from its job', async () => {
    stubFirestore({ extras: { x1: legacy({ status: 'Draft' }) }, jobs: { job3: JOB } })
    await call(sendExtraToBuilder, { extraId: 'x1' }, INTERNAL)
    const [patch] = stub.written('extras/')
    assert.equal(patch.data.tenantId, 'qbs')
    assert.deepEqual(patch.data.clientUids, ['c1'])
    assert.equal(stub.written('notifications/')[0].data.tenantId, 'qbs')
  })

  // A draft carries no scope (the stamping triggers and the backfill leave it without
  // one), so every send of one stamps it, in the same update as the send. One that does
  // carry a scope is stamped from its job just the same (see the describe below).
  it('stamps an unstamped draft from its job in the same transaction and the same update as the send', async () => {
    for (const unstamped of [legacy({ status: 'Draft' }), legacy({ status: 'Draft', tenantId: 'vision' })]) {
      stubFirestore({ extras: { x1: unstamped }, jobs: { job3: JOB } })
      await call(sendExtraToBuilder, { extraId: 'x1' }, INTERNAL)
      assert.deepEqual(stub.calls.filter((entry) => entry === 'runTransaction'), ['runTransaction'])
      assert.deepEqual(stub.reads, ['extras/x1', 'query:jobs:id==QBS-003'])
      const writes = stub.written('extras/')
      assert.equal(writes.length, 1, 'one update carries the send and the stamp')
      assert.equal(writes[0].data.status, 'Sent to Builder')
      assert.equal(writes[0].data.tenantId, 'qbs')
      assert.deepEqual(writes[0].data.clientUids, ['c1'])
      const [note] = stub.written('notifications/')
      assert.deepEqual([note.data.tenantId, note.data.clientUids], ['qbs', ['c1']])
      mock.restoreAll()
    }
  })

  // A draft is not meant to carry a scope, so one it does carry (it was stamped before it
  // became a draft, say) is not trusted. Sending it takes the scope from its job, in the same
  // update as the send, and the notification carries that scope too.
  describe('a draft that carries a scope', () => {
    const carrying = (over = {}) => stamped({ status: 'Draft', ...over })
    const scopeWritten = () => {
      const [patch] = stub.written('extras/')
      const [note] = stub.written('notifications/')
      return [[patch.data.tenantId, patch.data.clientUids], [note.data.tenantId, note.data.clientUids]]
    }

    it('takes its scope from its job, and not from the one it carries', async () => {
      stubFirestore({ extras: { x1: carrying({ tenantId: 'vision', clientUids: ['c9'] }) }, jobs: { job3: JOB } })
      assert.deepEqual(await call(sendExtraToBuilder, { extraId: 'x1' }, INTERNAL), { ok: true })
      assert.deepEqual(stub.reads, ['extras/x1', 'query:jobs:id==QBS-003'], 'the job is read after the change order, in the same transaction')
      assert.deepEqual(scopeWritten(), [['qbs', ['c1']], ['qbs', ['c1']]])
      assert.equal(stub.written('extras/').length, 1, 'one update carries the send and the stamp')
    })

    it('follows its job when the job has moved since the draft was stamped', async () => {
      stubFirestore({ extras: { x1: carrying() }, jobs: { job3: { ...JOB, tenantId: 'vision', clientUids: ['c1', 'c7'] } } })
      await call(sendExtraToBuilder, { extraId: 'x1' }, OWNER)
      assert.deepEqual(scopeWritten(), [['vision', ['c1', 'c7']], ['vision', ['c1', 'c7']]])
    })

    it('reads its job even when it carries the very scope the job has, so every send of a draft is stamped from it', async () => {
      stubFirestore({ extras: { x1: carrying() }, jobs: { job3: JOB } })
      await call(sendExtraToBuilder, { extraId: 'x1' }, OWNER)
      assert.deepEqual(stub.reads, ['extras/x1', 'query:jobs:id==QBS-003'])
      assert.deepEqual(scopeWritten(), [['qbs', ['c1']], ['qbs', ['c1']]])
    })

    it('gives a job with no tenant of its own the qbs default, whatever the draft carries', async () => {
      stubFirestore({ extras: { x1: carrying({ tenantId: 'vision', clientUids: ['c9'] }) }, jobs: { job3: { id: 'QBS-003' } } })
      await call(sendExtraToBuilder, { extraId: 'x1' }, OWNER)
      assert.deepEqual(scopeWritten(), [['qbs', []], ['qbs', []]])
    })

    it('is answered with not-found, and nothing is written, when its job is gone or it names none', async () => {
      stubFirestore({ extras: { gone: carrying(), none: carrying({ job: undefined }), blank: carrying({ job: '' }) }, jobs: {} })
      for (const extraId of ['gone', 'none', 'blank']) {
        await assert.rejects(call(sendExtraToBuilder, { extraId }, OWNER), code('not-found', 'That job no longer exists.'), extraId)
      }
      assert.deepEqual(stub.writes, [])
    })

    it('is still refused for an approval or a revision, which are not a send, whatever scope it carries', async () => {
      stubFirestore({ extras: { x1: carrying() }, jobs: { job3: JOB } })
      await assert.rejects(call(approveExtra, { extraId: 'x1' }, QBS), code('failed-precondition', 'This change order has not been sent for approval.'))
      await assert.rejects(call(rejectExtra, { extraId: 'x1', note: 'Use the 200A panel' }, QBS), code('failed-precondition', 'This change order has not been sent for approval.'))
      assert.deepEqual(stub.writes, [])
    })
  })

  it('keeps the scope a change order that is not a draft carries, and does not look at its job', async () => {
    stubFirestore({ extras: { r: stamped({ status: 'Rejected' }), s: stamped({ status: 'Sent to Builder' }), p: stamped({ status: 'pending' }) }, jobs: {} })
    for (const id of ['r', 's', 'p']) {
      stub.clear()
      assert.deepEqual(await call(sendExtraToBuilder, { extraId: id }, OWNER), { ok: true }, id)
      assert.deepEqual(stub.reads, [`extras/${id}`], `${id}: only the change order is read`)
      assert.deepEqual(Object.keys(stub.written('extras/')[0].data).sort(), ['qbs', 'qbsSentAt', 'sentAt', 'status'], `${id}: no stamp is added`)
    }
  })

  it('answers a change order or a job that is gone with not-found', async () => {
    stubFirestore({ extras: { x1: legacy({ status: 'Draft' }) }, jobs: {} })
    await assert.rejects(call(sendExtraToBuilder, { extraId: 'x1' }, OWNER), code('not-found', 'That job no longer exists.'))
    await assert.rejects(call(sendExtraToBuilder, { extraId: 'nope' }, OWNER), code('not-found', 'That change order no longer exists.'))
    assert.deepEqual(stub.writes, [])
  })

  it('does not ask for a note', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) }, jobs: { job3: JOB } })
    assert.deepEqual(await call(sendExtraToBuilder, { extraId: 'x1' }, OWNER), { ok: true })
  })
})

// The portals send the total they showed (expectedTotal), so a change order whose
// total was changed after the person opened it is not decided at a total they never
// saw. The stored total is total, else amount, else 0.
describe('the total the caller was shown', () => {
  const TOTAL_CHANGED = 'This change order changed since you opened it. Review it again.'
  const NOTE = 'Use the 200A panel'
  const extras = () => ({
    a: stamped({ amount: 4100 }),
    t: stamped({ total: 4200, amount: 4100 }),
    z: { id: 'CO-007', job: 'QBS-003', status: 'Sent to Builder', tenantId: 'qbs', clientUids: ['c1'] },
  })

  for (const [name, fn, more] of [['approveExtra', approveExtra, {}], ['rejectExtra', rejectExtra, { note: NOTE }]]) {
    it(`${name} refuses a total that is not the stored one, and writes nothing`, async () => {
      stubFirestore({ extras: extras() })
      for (const [extraId, expectedTotal] of [['a', 4000], ['a', '4000'], ['t', 4100], ['z', 4100], ['a', null]]) {
        await assert.rejects(
          call(fn, { extraId, expectedTotal, ...more }, QBS),
          code('failed-precondition', TOTAL_CHANGED),
          `${extraId} at ${expectedTotal}`,
        )
      }
      assert.deepEqual(stub.writes, [])
    })

    it(`${name} goes ahead when the total sent is the stored one`, async () => {
      for (const [extraId, expectedTotal] of [['a', 4100], ['t', 4200], ['z', 0]]) {
        stubFirestore({ extras: extras() })
        assert.deepEqual(await call(fn, { extraId, expectedTotal, ...more }, QBS), { ok: true }, extraId)
        assert.equal(stub.written('extras/').length, 1, extraId)
        mock.restoreAll()
      }
    })

    it(`${name} goes ahead when no total is sent`, async () => {
      stubFirestore({ extras: extras() })
      assert.deepEqual(await call(fn, { extraId: 't', ...more }, QBS), { ok: true })
      assert.equal(stub.writes.length, 3)
    })

    it(`${name} tells a caller who may not act on it only that, whatever total they send`, async () => {
      stubFirestore({ extras: extras() })
      await assert.rejects(
        call(fn, { extraId: 'a', expectedTotal: 1, ...more }, VISION),
        code('permission-denied', 'You can only act on change orders for your own projects.'),
      )
    })

    it(`${name} still answers a decided change order as decided, whatever total is sent`, async () => {
      stubFirestore({ extras: { d: stamped({ status: 'Approved' }) } })
      await assert.rejects(
        call(fn, { extraId: 'd', expectedTotal: 1, ...more }, QBS),
        code('failed-precondition', 'This change order has already been decided.'),
      )
    })
  }

  it('is not asked of sendExtraToBuilder, which sends whatever total is passed', async () => {
    stubFirestore({ extras: { x1: stamped({ status: 'Draft' }) }, jobs: { job3: JOB } })
    assert.deepEqual(await call(sendExtraToBuilder, { extraId: 'x1', expectedTotal: 1 }, OWNER), { ok: true })
  })
})

describe('everything the three write', () => {
  it('is free of dashes in the wording, and every document carries who created it', async () => {
    stubFirestore({ extras: { d: stamped({ status: 'Draft', coNumber: 'CO-2026-001' }), p: stamped(), q: stamped() }, jobs: { job3: JOB } })
    await call(sendExtraToBuilder, { extraId: 'd' }, OWNER)
    await call(approveExtra, { extraId: 'p' }, QBS)
    await call(rejectExtra, { extraId: 'q', note: 'Please add the 3 phase panel' }, QBS)

    assert.equal(stub.written('notifications/').length, 3)
    for (const { data } of [...stub.written('notifications/'), ...stub.written('history/')]) {
      assert.ok(data.createdBy, 'createdBy')
      assert.ok(data.createdByEmail, 'createdByEmail')
      for (const text of [data.msg, data.summary].filter(Boolean)) assertNoDashes(text)
    }
  })
})

describe('the pure rules are reachable from here too', () => {
  it('re-exports extraState and extraTransition for callers and tests', () => {
    assert.equal(extras.extraState, extraState)
    assert.equal(extras.extraTransition, extraTransition)
  })
})
