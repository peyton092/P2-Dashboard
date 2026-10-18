import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../lib/admin.js'
import { createJob } from '../jobs.js'

// Nothing here reaches a network. The Firestore instance is the real singleton
// with the methods the handler calls replaced, so a call it makes that is not
// stubbed fails loudly instead of quietly succeeding. A transaction is replayed
// the way Firestore treats it: what it stages is committed only if the callback
// finishes.

let calls // every Firestore entry point the handler touched, in order
let reads // every query read inside the transaction, in order
let writes // committed writes, in order: { op, path, data }

// jobs: [{ id: 'QBS-045' }]   the job documents that exist
function stubFirestore({ jobs = [], userDocs = {} } = {}) {
  let auto = 0
  mock.method(db, 'collection', (name) => {
    calls.push(`collection:${name}`)
    return {
      doc: (id) => {
        const docId = id ?? `auto${++auto}`
        return { id: docId, path: `${name}/${docId}` }
      },
      where: (field, op, value) => ({ limit: () => ({ query: { name, field, op, value } }) }),
    }
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
      get: async ({ query }) => {
        const { name, field, op, value } = query
        reads.push(`query:${name}:${field}${op}${value}`)
        const found = name === 'jobs' && field === 'id' && op === '==' ? jobs.filter((job) => job.id === value) : []
        return { empty: found.length === 0, docs: found.map((job) => ({ data: () => job })) }
      },
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
    assert.deepEqual([calls, reads, writes], [[], [], []])
  })

  it('turns a builder and a client away, touching nothing', async () => {
    stubFirestore()
    for (const auth of [QBS, CLIENT]) {
      await assert.rejects(call(form(), auth), code('permission-denied', 'Staff access required.'))
    }
    assert.deepEqual([calls, reads, writes], [[], [], []])
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
    assert.deepEqual([calls, reads, writes], [[], [], []])
  })

  it('refuses a job id that is already taken with already-exists, and writes nothing', async () => {
    stubFirestore({ jobs: [{ id: 'QBS-045' }] })
    await assert.rejects(asOwner(form()), code('already-exists', 'A job with that ID already exists.'))
    assert.deepEqual(reads, ['query:jobs:id==QBS-045'])
    assert.deepEqual(writes, [])
  })
})

describe('createJob', () => {
  it('writes the job, and answers with { ok: true, docId } naming the new document', async () => {
    stubFirestore()
    const result = await call(form(), INTERNAL)
    const [job] = written('jobs/')
    assert.equal(job.op, 'set')
    assert.match(job.path, /^jobs\/auto\d+$/)
    assert.deepEqual(result, { ok: true, docId: job.path.replace('jobs/', '') })
  })

  it('stores everything the form sent, with the server fields added', async () => {
    stubFirestore()
    await call(form(), INTERNAL)
    const { data } = written('jobs/')[0]
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
    const { data } = written('jobs/')[0]
    assert.deepEqual(data.clientUids, [])
    assert.equal(data.createdBy, 'o1')
    assert.equal(data.createdByEmail, 'jesse@p2em.com')
    assert.ok(isServerTime(data.createdAt))
  })

  it('checks the id is unused inside the transaction that writes the job', async () => {
    stubFirestore()
    await asOwner(form())
    assert.ok(calls.includes('runTransaction'))
    assert.deepEqual(reads, ['query:jobs:id==QBS-045'])
    assert.equal(writes.length, 3)
  })

  it('keeps a name when one is sent, and does not invent one otherwise', async () => {
    stubFirestore()
    await asOwner({ ...form(), name: ' Lee Residence ' })
    assert.equal(written('jobs/')[0].data.name, 'Lee Residence')
    writes = []
    await asOwner({ ...form(), id: 'QBS-046' })
    assert.equal('name' in written('jobs/')[0].data, false)
  })

  it('drops what a job cannot hold', async () => {
    stubFirestore()
    await asOwner({ ...form(), fn: () => 1, list: [{ a: 1 }], deep: { a: { b: { c: { d: 1 } } } }, 'bad.key': 1 })
    const { data } = written('jobs/')[0]
    for (const key of ['fn', 'list', 'bad.key']) assert.equal(key in data, false, key)
    assert.deepEqual(data.deep, { a: { b: {} } })
  })

  it('writes an info notification for the new job, scoped to its tenant with no clients yet', async () => {
    stubFirestore()
    await call(form(), INTERNAL)
    const [note] = written('notifications/')
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
    const [line] = written('history/')
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
    assert.equal(written('jobs/')[0].data.tenantId, 'vision')
    assert.equal(written('notifications/')[0].data.tenantId, 'vision')
  })

  it('takes the actor from the sign in token, not from the request', async () => {
    stubFirestore()
    await call({ ...form(), actor: { uid: 'x' }, displayName: 'Someone Else' }, INTERNAL)
    assert.equal(written('jobs/')[0].data.createdBy, 'i1')
    assert.equal(written('history/')[0].data.actorUid, 'i1')
  })

  it('is free of dashes in the wording', async () => {
    const IDS = /[A-Z]+(-\d+)+/g
    stubFirestore()
    await asOwner(form())
    for (const { data } of [...written('notifications/'), ...written('history/')]) {
      for (const text of [data.msg, data.summary].filter(Boolean)) {
        assert.doesNotMatch(text.replace(IDS, 'ID'), /[-‐-―−]/, `dash in: ${text}`)
      }
    }
  })
})
