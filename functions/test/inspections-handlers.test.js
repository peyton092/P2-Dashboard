import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { passInspection, failInspection } from '../inspections.js'
import { assertNoDashes, code, isServerTime, stubFirestore as installStub } from './helpers/firestore-stub.js'

// The Firestore stub is shared with the other handler tests (helpers/firestore-stub.js).
// Each test installs it with the documents that exist, and `stub` then holds what the
// handler did: stub.calls, stub.reads, stub.writes and stub.written(prefix).
//
// jobs:  { job1: { id: 'QBS-003', ... } }  job documents that exist, by document id
// users: { u1: { displayName } }           users documents the actor lookup may read
let stub
const stubFirestore = (collections) => {
  stub = installStub(collections)
}

beforeEach(() => {
  stub = undefined
})

afterEach(() => {
  mock.restoreAll()
  mock.timers.reset()
})

const OWNER = { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com', name: 'Jesse Parker' } }
const INTERNAL = { uid: 'i1', token: { role: 'internal', email: 'pat@p2em.com', name: 'Pat Lee' } }
const QBS = { uid: 'b1', token: { role: 'builder', tenantId: 'qbs', email: 'dana@qbs.example', name: 'Dana Lee' } }
const CLIENT = { uid: 'c1', token: { role: 'client', email: 'casey@client.example', name: 'Casey Hart' } }

const JOB = { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1'] }
const call = (fn, data, auth) => fn.run({ data, auth, rawRequest: {} })
const request = { jobDocId: 'job1', trade: 'electrical', phase: 'roughIn' }

describe('the guard runs before anything is read', () => {
  it('turns a signed out caller away, touching nothing', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    for (const fn of [passInspection, failInspection]) {
      await assert.rejects(call(fn, request, undefined), code('unauthenticated', 'You must be signed in.'))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('turns a builder and a client away, touching nothing', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    for (const fn of [passInspection, failInspection]) {
      for (const auth of [QBS, CLIENT]) {
        await assert.rejects(call(fn, request, auth), code('permission-denied', 'Staff access required.'))
      }
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('lets owner and internal staff in', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    for (const auth of [OWNER, INTERNAL]) {
      assert.deepEqual(await call(passInspection, request, auth), { ok: true })
    }
  })
})

describe('invalid requests are refused before anything is read', () => {
  it('refuses a phase the trade does not have, plumbing trim above all', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    const message = 'That inspection phase does not exist for this trade.'
    await assert.rejects(call(passInspection, { ...request, trade: 'plumbing', phase: 'trim' }, OWNER), code('invalid-argument', message))
    await assert.rejects(call(failInspection, { ...request, trade: 'hvac', phase: 'trim' }, OWNER), code('invalid-argument', message))
    await assert.rejects(call(passInspection, { ...request, phase: 'start' }, OWNER), code('invalid-argument', message))
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('refuses an unknown trade and an unusable job id', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await assert.rejects(call(passInspection, { ...request, trade: 'roofing' }, OWNER), code('invalid-argument', 'Choose electrical, plumbing or HVAC.'))
    for (const jobDocId of [undefined, '', 'job1/files/f1', 7]) {
      await assert.rejects(call(passInspection, { ...request, jobDocId }, OWNER), code('invalid-argument', 'Choose a job.'))
    }
    await assert.rejects(call(passInspection, undefined, OWNER), code('invalid-argument', 'Choose a job.'))
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('does not accept the old jobId key', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await assert.rejects(call(passInspection, { jobId: 'job1', trade: 'electrical', phase: 'roughIn' }, OWNER), code('invalid-argument', 'Choose a job.'))
  })
})

describe('passInspection', () => {
  it('sets the phase result and its date on the job, and nothing else', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T23:30:00Z') })
    stubFirestore({ jobs: { job1: JOB } })
    assert.deepEqual(await call(passInspection, request, OWNER), { ok: true })
    const [patch] = stub.written('jobs/')
    assert.equal(patch.op, 'update')
    assert.equal(patch.path, 'jobs/job1')
    assert.deepEqual(patch.data, {
      'insp.electrical.roughIn': 'passed',
      'insp.electrical.roughInDate': '2026-10-18',
    })
  })

  it('dates the result by the UTC day', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T00:05:00Z') })
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, { ...request, trade: 'hvac', phase: 'final' }, OWNER)
    assert.deepEqual(stub.written('jobs/')[0].data, { 'insp.hvac.final': 'passed', 'insp.hvac.finalDate': '2026-10-19' })
  })

  it('writes a success notification scoped like the job', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, OWNER)
    const [note] = stub.written('notifications/')
    assert.equal(note.op, 'set')
    assert.equal(note.data.type, 'success')
    assert.equal(note.data.msg, 'QBS-003 electrical rough in passed')
    assert.equal(note.data.jobId, 'QBS-003')
    assert.equal(note.data.tenantId, 'qbs')
    assert.deepEqual(note.data.clientUids, ['c1'])
    assert.equal(note.data.createdBy, 'o1')
    assert.equal(note.data.createdByEmail, 'jesse@p2em.com')
    assert.equal(note.data.read, false)
    assert.ok(isServerTime(note.data.createdAt))
  })

  it('writes the history line the Activity feed renders', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, INTERNAL)
    const [line] = stub.written('history/')
    assert.equal(line.data.type, 'inspection')
    assert.equal(line.data.action, 'passed')
    assert.equal(line.data.summary, 'QBS-003 electrical rough in passed')
    assert.equal(line.data.actor, 'Pat Lee')
    assert.equal(line.data.actorUid, 'i1')
    assert.equal(line.data.jobId, 'QBS-003')
    assert.equal(line.data.createdBy, 'i1')
    assert.equal(line.data.createdByEmail, 'pat@p2em.com')
    assert.equal('extraId' in line.data, false)
  })

  it('reads the job and writes all three in one transaction', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, OWNER)
    assert.ok(stub.calls.includes('runTransaction'))
    assert.deepEqual(stub.reads, ['jobs/job1'])
    assert.equal(stub.writes.length, 3)
  })

  it('records every phase every trade has', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    const phases = { electrical: ['roughIn', 'trim', 'final'], plumbing: ['roughIn', 'final'], hvac: ['roughIn', 'final'] }
    for (const [trade, list] of Object.entries(phases)) {
      for (const phase of list) {
        stub.clear()
        await call(passInspection, { jobDocId: 'job1', trade, phase }, OWNER)
        assert.equal(stub.written('jobs/')[0].data[`insp.${trade}.${phase}`], 'passed', `${trade} ${phase}`)
      }
    }
  })

  it('takes the actor from the sign in token, not from the request', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, { ...request, actor: { uid: 'x', displayName: 'Someone Else' }, displayName: 'Someone Else' }, OWNER)
    assert.equal(stub.written('history/')[0].data.actorUid, 'o1')
    assert.equal(stub.written('history/')[0].data.actor, 'Jesse Parker')
  })

  it('records a caller whose token has no email with null, never undefined', async () => {
    // The stub refuses undefined anywhere in written data, as Firestore does.
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, { uid: 'o2', token: { role: 'owner', name: 'Jesse Parker' } })
    assert.equal(stub.written('notifications/')[0].data.createdByEmail, null)
    assert.equal(stub.written('history/')[0].data.actorEmail, null)
    assert.equal(stub.written('history/')[0].data.createdByEmail, null)
  })

  it('answers a job that does not exist with not-found, and writes nothing', async () => {
    stubFirestore({ jobs: {} })
    await assert.rejects(call(passInspection, request, OWNER), code('not-found', 'That job no longer exists.'))
    assert.deepEqual(stub.writes, [])
  })

  it('writes a job id of null when the job record has none', async () => {
    stubFirestore({ jobs: { job1: { tenantId: 'qbs' } } })
    await call(passInspection, request, OWNER)
    assert.equal(stub.written('notifications/')[0].data.jobId, null)
    assert.equal(stub.written('notifications/')[0].data.msg, 'Job electrical rough in passed')
  })
})

describe('failInspection', () => {
  it('sets failed and the date, and writes an error notification and a history line', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-02T10:00:00Z') })
    stubFirestore({ jobs: { job1: JOB } })
    assert.deepEqual(await call(failInspection, { jobDocId: 'job1', trade: 'plumbing', phase: 'final' }, OWNER), { ok: true })
    assert.deepEqual(stub.written('jobs/')[0].data, { 'insp.plumbing.final': 'failed', 'insp.plumbing.finalDate': '2026-03-02' })
    const [note] = stub.written('notifications/')
    assert.equal(note.data.type, 'error')
    assert.equal(note.data.msg, 'QBS-003 plumbing final failed')
    const [line] = stub.written('history/')
    assert.equal(line.data.action, 'failed')
    assert.equal(line.data.type, 'inspection')
  })
})

describe('everything it writes', () => {
  it('is free of dashes in the wording', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, OWNER)
    await call(failInspection, { jobDocId: 'job1', trade: 'hvac', phase: 'roughIn' }, OWNER)
    for (const { data } of [...stub.written('notifications/'), ...stub.written('history/')]) {
      for (const text of [data.msg, data.summary].filter(Boolean)) assertNoDashes(text)
    }
  })
})
