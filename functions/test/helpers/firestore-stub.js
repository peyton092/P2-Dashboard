// Helpers shared by the handler tests of the privileged callables (change orders,
// inspections, jobs). This is not a test: node's runner loads every file under
// test/, and loading this one only defines the exports below.
//
// Nothing here reaches a network. stubFirestore() replaces the methods the
// handlers call on the real Firestore instance, so a call that is not stubbed
// fails loudly (no credentials, no emulator) instead of quietly succeeding. A
// transaction is replayed the way Firestore treats it. What it stages is committed
// only if the callback finishes, so a refusal inside it leaves nothing written. A
// read after a write throws the error the Admin SDK throws, so a handler that
// reads once it has staged a write fails its tests as it would fail in production.
// And a value of undefined in written data throws, as the Admin SDK does unless it
// is told to ignore undefined properties.
//
// The triggers and the backfill read whole collections and write in batches, outside
// any transaction. The stub does not answer that unless asked
// (stubFirestore(docs, { outsideTransactions: true })), so a handler that should use a
// transaction still fails loudly if it reaches for a plain read or a batch.

import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../../lib/admin.js'

// The message of the Admin SDK's own error (transaction.js).
export const READ_AFTER_WRITE = 'Firestore transactions require all reads to be executed before all writes.'

// The most writes Firestore takes in one batch.
export const BATCH_LIMIT = 500

// A matcher for assert.rejects: an HttpsError with this code, and this message when
// one is given.
export const code = (expected, message) => (err) => {
  assert.ok(err instanceof HttpsError, `expected an HttpsError, got ${err}`)
  assert.equal(err.code, expected)
  if (message !== undefined) assert.equal(err.message, message)
  return true
}

// Whether a written value is a server timestamp.
export const isServerTime = (value) => value.isEqual(FieldValue.serverTimestamp())

// Job ids and change order numbers are data and keep their hyphens (QBS-003,
// CO-2026-001). Everything else in the words people read must be free of dashes
// of every kind.
const IDS = /[A-Z]+(-\d+)+/g
export function assertNoDashes(text) {
  assert.doesNotMatch(text.replace(IDS, 'ID'), /[-‐-―−]/, `dash in: ${text}`)
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))

// Firestore refuses undefined anywhere in written data. A server timestamp and the
// like are class instances, so only plain objects and arrays are searched.
function assertDefined(value, field) {
  if (value === undefined) {
    throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${field}").`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertDefined(item, `${field}[${i}]`))
  } else if (isPlainObject(value)) {
    for (const [key, inner] of Object.entries(value)) assertDefined(inner, field ? `${field}.${key}` : key)
  }
}

// collections: the documents that exist, as { collectionName: { docId: data } }, for
// example { extras: { x1: {...} }, jobs: { job3: {...} }, users: { u1: {...} } }.
//
// Stubs the Firestore methods the handlers use: collection(name).doc(id?),
// collection(name).where(field, '==', value).limit(n), doc('users/uid').get() and
// runTransaction. Returns what the handler did:
//   calls    every Firestore entry point it touched, in order
//   reads    every document or query it read inside a transaction, in order
//   writes   committed writes, in order: { op: 'set' | 'update', path, data }
//   written(prefix)   the committed writes under a path prefix, like 'history/'
//   batches  the committed batches, each the list of writes it held (always empty
//            unless outsideTransactions is on)
//   clear()  forgets calls, reads, writes and batches (the documents stay)
//
// outsideTransactions: true also stubs what the triggers and the backfill use outside
// a transaction. collection(name).get() and collection(name).where(field, '==',
// value).get() answer { empty, size, docs }, each doc { id, ref: { id, path }, data() }
// in the order the documents are listed. db.batch() stages update and set and commits
// them as one group on commit(). Staging undefined in the data throws at once, as the
// Admin SDK does. A commit throws the way Firestore does for more than 500 writes and
// for an update of a document that does not exist, and a batch that throws commits none
// of its writes. Documents are never changed by a write, so a later read still answers
// the documents the test started with.
// Undo it with mock.restoreAll().
export function stubFirestore(collections = {}, { outsideTransactions = false } = {}) {
  const stub = { calls: [], reads: [], writes: [], batches: [] }
  let auto = 0

  const dataAt = (path) => {
    const [name, id] = path.split('/')
    return collections[name]?.[id]
  }

  // The documents of a collection, all or those where field equals value, as a
  // snapshot a plain read answers with.
  const scan = (name, query) => {
    if (query) assert.equal(query.op, '==', 'the stub answers == queries only')
    const found = Object.entries(collections[name] ?? {}).filter(([, data]) => !query || data[query.field] === query.value)
    return {
      empty: found.length === 0,
      size: found.length,
      docs: found.map(([id, data]) => ({ id, ref: { id, path: `${name}/${id}` }, data: () => data })),
    }
  }

  mock.method(db, 'collection', (name) => {
    stub.calls.push(`collection:${name}`)
    const collection = {
      doc: (id) => {
        const docId = id ?? `auto${++auto}`
        return { id: docId, path: `${name}/${docId}` }
      },
      where: (field, op, value) => {
        const query = { name, field, op, value }
        const where = { limit: () => ({ query }) }
        if (outsideTransactions) where.get = async () => scan(name, query)
        return where
      },
    }
    if (outsideTransactions) collection.get = async () => scan(name)
    return collection
  })

  if (outsideTransactions) {
    mock.method(db, 'batch', () => {
      stub.calls.push('batch')
      const staged = []
      const stage = (op) => (ref, data) => {
        assertDefined(data, '')
        staged.push({ op, path: ref.path, data })
      }
      return {
        update: stage('update'),
        set: stage('set'),
        commit: async () => {
          if (staged.length > BATCH_LIMIT) throw new Error(`maximum ${BATCH_LIMIT} writes allowed per request`)
          for (const write of staged) {
            if (write.op === 'update' && dataAt(write.path) === undefined) throw new Error(`No document to update: ${write.path}`)
          }
          stub.batches.push([...staged])
          stub.writes.push(...staged)
        },
      }
    })
  }

  mock.method(db, 'doc', (path) => {
    stub.calls.push(`doc:${path}`)
    return {
      get: async () => {
        const data = dataAt(path)
        return { exists: data !== undefined, data: () => data }
      },
    }
  })

  mock.method(db, 'runTransaction', async (update) => {
    stub.calls.push('runTransaction')
    const staged = []
    const stage = (op) => (ref, data) => {
      assertDefined(data, '')
      staged.push({ op, path: ref.path, data })
    }
    const tx = {
      // Throws at once, as the SDK's Transaction.get does, not as a rejected promise.
      get: (target) => {
        if (staged.length > 0) throw new Error(READ_AFTER_WRITE)
        if (target.query) {
          const { name, field, op, value } = target.query
          assert.equal(op, '==', 'the stub answers == queries only')
          stub.reads.push(`query:${name}:${field}${op}${value}`)
          const found = Object.entries(collections[name] ?? {}).filter(([, data]) => data[field] === value)
          return Promise.resolve({
            empty: found.length === 0,
            size: found.length,
            docs: found.map(([id, data]) => ({ id, data: () => data })),
          })
        }
        stub.reads.push(target.path)
        const data = dataAt(target.path)
        return Promise.resolve({ exists: data !== undefined, data: () => data })
      },
      update: stage('update'),
      set: stage('set'),
    }
    const result = await update(tx)
    stub.writes.push(...staged)
    return result
  })

  stub.written = (prefix) => stub.writes.filter((write) => write.path.startsWith(prefix))
  stub.clear = () => {
    stub.calls.length = 0
    stub.reads.length = 0
    stub.writes.length = 0
    stub.batches.length = 0
  }
  return stub
}
