import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createJob } from '../jobs.js'
import { assertNoDashes, code, isServerTime, stubFirestore as installStub } from './helpers/firestore-stub.js'

// The Firestore stub is shared with the other handler tests (helpers/firestore-stub.js).
// Each test installs it with the documents that exist, and `stub` then holds what the
// handler did: stub.calls, stub.reads, stub.writes and stub.written(prefix).
//
// jobs: { job1: { id: 'QBS-045' } }  job documents that exist, by document id
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

const OWNER = { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com', name: 'Jesse Parker' } }
const INTERNAL = { uid: 'i1', token: { role: 'internal', email: 'blake@p2em.com', name: 'Blake Neblett' } }
const QBS = { uid: 'b1', token: { role: 'builder', tenantId: 'qbs', email: 'dana@qbs.example', name: 'Dana Lee' } }
const CLIENT = { uid: 'c1', token: { role: 'client', email: 'casey@client.example', name: 'Casey Hart' } }

// What the New Job form sends (src/App.jsx handleCreateJob).
const form = () => ({
  id: 'QBS-045',
  address: '123 Main St',
  city: 'Brentwood, TN 37027',
  client: 'Dana Lee',
  type: 'Full MEP Renovation',
  pm: 'Blake Neblett',
  status: 'active',
  progress: 0,
  extras: 0,
  tenantId: 'qbs',
  lead: '',
  start: '2026-10-18',
  target: '2027-03-01',
  county: '',
  billingStatus: 'not-invoiced',
  permitNumber: '2026012345',
  subs: { electrical: 'Volt Co', plumbing: null, hvac: null },
  permits: { electrical: 'pending', plumbing: 'pending', hvac: 'pending' },
  insp: {
    electrical: { roughIn: 'pending', trim: 'blocked', final: 'blocked' },
    plumbing: { roughIn: 'pending', final: 'blocked' },
    hvac: { roughIn: 'pending', final: 'blocked' },
  },
})

const call = (data, auth) => createJob.run({ data, auth, rawRequest: {} })
const asOwner = (data) => call(data, OWNER)

describe('createJob guard', () => {
  it('turns a signed out caller away, touching nothing', async () => {
    stubFirestore()
    await assert.rejects(call(form(), undefined), code('unauthenticated', 'You must be signed in.'))
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('turns a builder and a client away, touching nothing', async () => {
    stubFirestore()
    for (const auth of [QBS, CLIENT]) {
      await assert.rejects(call(form(), auth), code('permission-denied', 'Staff access required.'))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('lets owner and internal staff in', async () => {
    stubFirestore()
    for (const auth of [OWNER, INTERNAL]) {
      assert.equal((await call(form(), auth)).ok, true)
    }
  })
})

describe('createJob validation', () => {
  it('refuses a bad request with invalid-argument and the message, before reading anything', async () => {
    stubFirestore()
    const cases = [
      [{ ...form(), id: 'qbs-45' }, 'Job ID must look like QBS-001.'],
      [{ ...form(), address: '  ' }, 'Enter the street address.'],
      [{ ...form(), client: undefined }, 'Enter the client name.'],
      [{ ...form(), tenantId: 'acme' }, 'Choose a tenant.'],
      [undefined, 'Job ID must look like QBS-001.'],
    ]
    for (const [data, message] of cases) {
      await assert.rejects(asOwner(data), code('invalid-argument', message))
    }
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
  })

  it('refuses a job id that is already taken with already-exists, and writes nothing', async () => {
    stubFirestore({ jobs: { existing: { id: 'QBS-045' } } })
    await assert.rejects(asOwner(form()), code('already-exists', 'A job with that ID already exists.'))
    assert.deepEqual(stub.reads, ['query:jobs:id==QBS-045'])
    assert.deepEqual(stub.writes, [])
  })
})

describe('createJob', () => {
  it('writes the job, and answers with { ok: true, docId } naming the new document', async () => {
    stubFirestore()
    const result = await call(form(), INTERNAL)
    const [job] = stub.written('jobs/')
    assert.equal(job.op, 'set')
    assert.match(job.path, /^jobs\/auto\d+$/)
    assert.deepEqual(result, { ok: true, docId: job.path.replace('jobs/', '') })
  })

  it('stores everything the form sent, with the server fields added', async () => {
    stubFirestore()
    await call(form(), INTERNAL)
    const { data } = stub.written('jobs/')[0]
    const expected = form()
    for (const key of Object.keys(expected)) assert.deepEqual(data[key], expected[key], key)
    assert.deepEqual(data.clientUids, [])
    assert.equal(data.createdBy, 'i1')
    assert.equal(data.createdByEmail, 'blake@p2em.com')
    assert.ok(isServerTime(data.createdAt), 'createdAt is a server timestamp')
    assert.deepEqual(Object.keys(data).sort(), [...Object.keys(expected), 'clientUids', 'createdAt', 'createdBy', 'createdByEmail'].sort())
  })

  it('sets the server fields itself, whatever the caller sent', async () => {
    stubFirestore()
    await asOwner({ ...form(), clientUids: ['intruder'], createdBy: 'someone', createdByEmail: 'someone@x.example', createdAt: '2000-01-01' })
    const { data } = stub.written('jobs/')[0]
    assert.deepEqual(data.clientUids, [])
    assert.equal(data.createdBy, 'o1')
    assert.equal(data.createdByEmail, 'jesse@p2em.com')
    assert.ok(isServerTime(data.createdAt))
  })

  it('checks the id is unused inside the transaction that writes the job', async () => {
    stubFirestore()
    await asOwner(form())
    assert.ok(stub.calls.includes('runTransaction'))
    assert.equal(stub.reads[0], 'query:jobs:id==QBS-045')
    assert.equal(stub.writes.length, 3)
  })

  it('keeps a name when one is sent, and does not invent one otherwise', async () => {
    stubFirestore()
    await asOwner({ ...form(), name: ' Lee Residence ' })
    assert.equal(stub.written('jobs/')[0].data.name, 'Lee Residence')
    stub.clear()
    await asOwner({ ...form(), id: 'QBS-046' })
    assert.equal('name' in stub.written('jobs/')[0].data, false)
  })

  it('drops what a job cannot hold', async () => {
    stubFirestore()
    await asOwner({ ...form(), fn: () => 1, list: [{ a: 1 }], deep: { a: { b: { c: { d: 1 } } } }, 'bad.key': 1 })
    const { data } = stub.written('jobs/')[0]
    for (const key of ['fn', 'list', 'bad.key']) assert.equal(key in data, false, key)
    assert.deepEqual(data.deep, { a: { b: {} } })
  })

  it('writes an info notification for the new job, scoped to its tenant with no clients yet', async () => {
    stubFirestore()
    await call(form(), INTERNAL)
    const [note] = stub.written('notifications/')
    assert.equal(note.op, 'set')
    assert.equal(note.data.type, 'info')
    assert.equal(note.data.msg, 'QBS-045 created by Blake Neblett')
    assert.equal(note.data.jobId, 'QBS-045')
    assert.equal(note.data.tenantId, 'qbs')
    assert.deepEqual(note.data.clientUids, [])
    assert.equal(note.data.createdBy, 'i1')
    assert.equal(note.data.createdByEmail, 'blake@p2em.com')
    assert.equal(note.data.read, false)
    assert.ok(isServerTime(note.data.createdAt))
  })

  it('writes the history line the Activity feed renders', async () => {
    stubFirestore()
    await call(form(), INTERNAL)
    const [line] = stub.written('history/')
    assert.equal(line.data.type, 'job')
    assert.equal(line.data.action, 'created')
    assert.equal(line.data.summary, 'QBS-045 created: 123 Main St')
    assert.equal(line.data.actor, 'Blake Neblett')
    assert.equal(line.data.actorUid, 'i1')
    assert.equal(line.data.jobId, 'QBS-045')
    assert.equal(line.data.createdBy, 'i1')
    assert.equal(line.data.createdByEmail, 'blake@p2em.com')
  })

  it('records the tenant it was given, so a vision job is not forced into qbs', async () => {
    stubFirestore()
    await asOwner({ ...form(), id: 'VIS-001', tenantId: 'vision' })
    assert.equal(stub.written('jobs/')[0].data.tenantId, 'vision')
    assert.equal(stub.written('notifications/')[0].data.tenantId, 'vision')
  })

  it('takes the actor from the sign in token, not from the request', async () => {
    stubFirestore()
    await call({ ...form(), actor: { uid: 'x' }, displayName: 'Someone Else' }, INTERNAL)
    assert.equal(stub.written('jobs/')[0].data.createdBy, 'i1')
    assert.equal(stub.written('history/')[0].data.actorUid, 'i1')
  })

  it('records a caller whose token has no email with null, never undefined', async () => {
    // The stub refuses undefined anywhere in written data, as Firestore does.
    stubFirestore()
    await call(form(), { uid: 'o2', token: { role: 'owner', name: 'Jesse Parker' } })
    assert.equal(stub.written('jobs/')[0].data.createdByEmail, null)
    assert.equal(stub.written('notifications/')[0].data.createdByEmail, null)
    assert.equal(stub.written('history/')[0].data.actorEmail, null)
  })

  // A client whose users document lists the id before the job exists is linked here:
  // onUserWritten only links a client to jobs that exist when their document is written.
  describe('the clients who already list the job', () => {
    const USERS = {
      c2: { role: 'client', clientJobIds: ['QBS-001', 'QBS-045'] },
      c1: { role: 'client', clientJobIds: ['QBS-045'] },
      c3: { role: 'client', clientJobIds: ['QBS-046'] },
      b1: { role: 'builder', tenantId: 'qbs', clientJobIds: ['QBS-045'] },
      i1: { role: 'internal', clientJobIds: ['QBS-045'] },
    }

    it('are stamped, sorted, on the job and on its notification, whatever clientUids the caller sent', async () => {
      stubFirestore({ users: USERS })
      await asOwner({ ...form(), clientUids: ['intruder'] })
      assert.deepEqual(stub.written('jobs/')[0].data.clientUids, ['c1', 'c2'])
      assert.deepEqual(stub.written('notifications/')[0].data.clientUids, ['c1', 'c2'])
      assert.equal(stub.written('notifications/')[0].data.tenantId, 'qbs')
    })

    it('give an empty clientUids when no client lists the job', async () => {
      stubFirestore({ users: { c3: USERS.c3, b1: USERS.b1, i1: USERS.i1 } })
      await asOwner(form())
      assert.deepEqual(stub.written('jobs/')[0].data.clientUids, [])
      assert.deepEqual(stub.written('notifications/')[0].data.clientUids, [])
    })

    it('are looked up inside the transaction, after the id check and before anything is written', async () => {
      // The stub refuses a read once a write is staged, so the run finishing proves the order.
      stubFirestore({ users: USERS })
      await asOwner(form())
      assert.deepEqual(stub.reads, ['query:jobs:id==QBS-045', 'query:users:role==client,clientJobIds array-contains QBS-045'])
      assert.equal(stub.writes.length, 3)
    })

    it('are not looked up for an id that is taken', async () => {
      stubFirestore({ jobs: { existing: { id: 'QBS-045' } }, users: USERS })
      await assert.rejects(asOwner(form()), code('already-exists'))
      assert.deepEqual(stub.reads, ['query:jobs:id==QBS-045'])
    })
  })

  it('is free of dashes in the wording', async () => {
    stubFirestore()
    await asOwner(form())
    for (const { data } of [...stub.written('notifications/'), ...stub.written('history/')]) {
      for (const text of [data.msg, data.summary].filter(Boolean)) assertNoDashes(text)
    }
  })
})
