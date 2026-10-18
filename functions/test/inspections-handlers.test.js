import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../lib/admin.js'
import { passInspection, failInspection } from '../inspections.js'

// Nothing here reaches a network. The Firestore instance is the real singleton
// with the methods the handlers call replaced, so a call the handlers make that
// is not stubbed fails loudly instead of quietly succeeding. A transaction is
// replayed the way Firestore treats it: what it stages is committed only if the
// callback finishes.

let calls // every Firestore entry point the handler touched, in order
let reads // every document read inside the transaction, in order
let writes // committed writes, in order: { op, path, data }

// jobs: { j1: { id: 'QBS-003', ... } }   job documents that exist, by document id
// userDocs: { u1: { displayName } }      users documents the actor lookup may read
function stubFirestore({ jobs = {}, userDocs = {} } = {}) {
  let auto = 0
  mock.method(db, 'collection', (name) => {
    calls.push(`collection:${name}`)
    return { doc: (id) => ({ path: `${name}/${id ?? `auto${++auto}`}` }) }
  })
  mock.method(db, 'doc', (path) => {
    calls.push(`doc:${path}`)
    return {
      get: async () => {
        const data = userDocs[path.replace(/^users\//, '')]
        return { exists: data !== undefined, data: () => data }
      },
    }
  })
  mock.method(db, 'runTransaction', async (update) => {
    calls.push('runTransaction')
    const staged = []
    const tx = {
      get: async (ref) => {
        reads.push(ref.path)
        const data = jobs[ref.path.replace(/^jobs\//, '')]
        return { exists: data !== undefined, data: () => data }
      },
      update: (ref, data) => staged.push({ op: 'update', path: ref.path, data }),
      set: (ref, data) => staged.push({ op: 'set', path: ref.path, data }),
    }
    const result = await update(tx)
    writes.push(...staged)
    return result
  })
}

beforeEach(() => {
  calls = []
  reads = []
  writes = []
})

afterEach(() => {
  mock.restoreAll()
  mock.timers.reset()
})

const code = (expected, message) => (err) => {
  assert.ok(err instanceof HttpsError, `expected an HttpsError, got ${err}`)
  assert.equal(err.code, expected)
  if (message !== undefined) assert.equal(err.message, message)
  return true
}

const isServerTime = (value) => value.isEqual(FieldValue.serverTimestamp())
const written = (prefix) => writes.filter((w) => w.path.startsWith(prefix))

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
    assert.deepEqual([calls, reads, writes], [[], [], []])
  })

  it('turns a builder and a client away, touching nothing', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    for (const fn of [passInspection, failInspection]) {
      for (const auth of [QBS, CLIENT]) {
        await assert.rejects(call(fn, request, auth), code('permission-denied', 'Staff access required.'))
      }
    }
    assert.deepEqual([calls, reads, writes], [[], [], []])
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
    assert.deepEqual([calls, reads, writes], [[], [], []])
  })

  it('refuses an unknown trade and an unusable job id', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await assert.rejects(call(passInspection, { ...request, trade: 'roofing' }, OWNER), code('invalid-argument', 'Choose electrical, plumbing or HVAC.'))
    for (const jobDocId of [undefined, '', 'job1/files/f1', 7]) {
      await assert.rejects(call(passInspection, { ...request, jobDocId }, OWNER), code('invalid-argument', 'Choose a job.'))
    }
    await assert.rejects(call(passInspection, undefined, OWNER), code('invalid-argument', 'Choose a job.'))
    assert.deepEqual([calls, reads, writes], [[], [], []])
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
    const [patch] = written('jobs/')
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
    assert.deepEqual(written('jobs/')[0].data, { 'insp.hvac.final': 'passed', 'insp.hvac.finalDate': '2026-10-19' })
  })

  it('writes a success notification scoped like the job', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, OWNER)
    const [note] = written('notifications/')
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
    const [line] = written('history/')
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
    assert.ok(calls.includes('runTransaction'))
    assert.deepEqual(reads, ['jobs/job1'])
    assert.equal(writes.length, 3)
  })

  it('records every phase every trade has', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    const phases = { electrical: ['roughIn', 'trim', 'final'], plumbing: ['roughIn', 'final'], hvac: ['roughIn', 'final'] }
    for (const [trade, list] of Object.entries(phases)) {
      for (const phase of list) {
        writes = []
        await call(passInspection, { jobDocId: 'job1', trade, phase }, OWNER)
        assert.equal(written('jobs/')[0].data[`insp.${trade}.${phase}`], 'passed', `${trade} ${phase}`)
      }
    }
  })

  it('takes the actor from the sign in token, not from the request', async () => {
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, { ...request, actor: { uid: 'x', displayName: 'Someone Else' }, displayName: 'Someone Else' }, OWNER)
    assert.equal(written('history/')[0].data.actorUid, 'o1')
    assert.equal(written('history/')[0].data.actor, 'Jesse Parker')
  })

  it('answers a job that does not exist with not-found, and writes nothing', async () => {
    stubFirestore({ jobs: {} })
    await assert.rejects(call(passInspection, request, OWNER), code('not-found', 'That job no longer exists.'))
    assert.deepEqual(writes, [])
  })

  it('writes a job id of null when the job record has none', async () => {
    stubFirestore({ jobs: { job1: { tenantId: 'qbs' } } })
    await call(passInspection, request, OWNER)
    assert.equal(written('notifications/')[0].data.jobId, null)
    assert.equal(written('notifications/')[0].data.msg, 'Job electrical rough in passed')
  })
})

describe('failInspection', () => {
  it('sets failed and the date, and writes an error notification and a history line', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-02T10:00:00Z') })
    stubFirestore({ jobs: { job1: JOB } })
    assert.deepEqual(await call(failInspection, { jobDocId: 'job1', trade: 'plumbing', phase: 'final' }, OWNER), { ok: true })
    assert.deepEqual(written('jobs/')[0].data, { 'insp.plumbing.final': 'failed', 'insp.plumbing.finalDate': '2026-03-02' })
    const [note] = written('notifications/')
    assert.equal(note.data.type, 'error')
    assert.equal(note.data.msg, 'QBS-003 plumbing final failed')
    const [line] = written('history/')
    assert.equal(line.data.action, 'failed')
    assert.equal(line.data.type, 'inspection')
  })
})

describe('everything it writes', () => {
  it('is free of dashes in the wording', async () => {
    const IDS = /[A-Z]+(-\d+)+/g
    stubFirestore({ jobs: { job1: JOB } })
    await call(passInspection, request, OWNER)
    await call(failInspection, { jobDocId: 'job1', trade: 'hvac', phase: 'roughIn' }, OWNER)
    for (const { data } of [...written('notifications/'), ...written('history/')]) {
      for (const text of [data.msg, data.summary].filter(Boolean)) {
        assert.doesNotMatch(text.replace(IDS, 'ID'), /[-‐-―−]/, `dash in: ${text}`)
      }
    }
  })
})
