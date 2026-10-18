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

// The where clauses the stub answers. A document matches == when the field holds the
// value, and array-contains when the field is a list with the value in it.
const OPERATORS = ['==', 'array-contains']
const matches = (data, { field, op, value }) =>
  op === '==' ? data[field] === value : Array.isArray(data[field]) && data[field].includes(value)

// The clauses of a query, whether the stub built it ({ name, clauses }) or a test wrote
// one clause out by hand ({ name, field, op, value }).
const clausesOf = (query) => query.clauses ?? [{ field: query.field, op: query.op, value: query.value }]

// How a clause is written in stub.reads: id==QBS-003, clientJobIds array-contains QBS-003.
const clauseLabel = ({ field, op, value }) => (op === '==' ? `${field}==${value}` : `${field} ${op} ${value}`)

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
// collection(name).where(field, op, value), with more where clauses chained after it
// and .limit(n) last if the handler likes, doc('users/uid').get() and runTransaction.
// A where clause is == or array-contains (the field holds a list with the value in
// it), and a document matches a query when it matches every clause; limit is not
// applied. Returns what the handler did:
//   calls    every Firestore entry point it touched, in order
//   reads    every document or query it read inside a transaction, in order: a
//            document by its path, a query as query:collection:clauses, the clauses
//            joined by commas, like query:jobs:id==QBS-003 or
//            query:users:role==client,clientJobIds array-contains QBS-003
//   writes   committed writes, in order: { op: 'set' | 'update', path, data }
//   written(prefix)   the committed writes under a path prefix, like 'history/'
//   batches  the committed batches, each the list of writes it held (always empty
//            unless outsideTransactions is on)
//   clear()  forgets calls, reads, writes and batches (the documents stay)
//
// outsideTransactions: true also stubs what the triggers and the backfill use outside
// a transaction. collection(name).get() and the get() of a query (the same where
// clauses as above) answer { empty, size, docs }, each doc { id, ref: { id, path }, data() }
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

  // The documents of a collection that match every clause (all of them for none), in
  // the order the documents are listed.
  const matching = (name, clauses) => {
    for (const { op } of clauses) {
      assert.ok(OPERATORS.includes(op), 'the stub answers == and array-contains queries only')
    }
    return Object.entries(collections[name] ?? {}).filter(([, data]) => clauses.every((clause) => matches(data, clause)))
  }

  // The documents of a collection, all or those a query matches, as a snapshot a plain
  // read answers with.
  const scan = (name, clauses = []) => {
    const found = matching(name, clauses)
    return {
      empty: found.length === 0,
      size: found.length,
      docs: found.map(([id, data]) => ({ id, ref: { id, path: `${name}/${id}` }, data: () => data })),
    }
  }

  // A query on a collection: its clauses so far, more of them chained on, and limit.
  const queryOn = (name, clauses) => {
    const query = { name, clauses }
    const chain = {
      query,
      where: (field, op, value) => queryOn(name, [...clauses, { field, op, value }]),
      limit: () => ({ query }),
    }
    if (outsideTransactions) chain.get = async () => scan(name, clauses)
    return chain
  }

  mock.method(db, 'collection', (name) => {
    stub.calls.push(`collection:${name}`)
    const collection = {
      doc: (id) => {
        const docId = id ?? `auto${++auto}`
        return { id: docId, path: `${name}/${docId}` }
      },
      where: (field, op, value) => queryOn(name, [{ field, op, value }]),
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
          const { name } = target.query
          const clauses = clausesOf(target.query)
          const found = matching(name, clauses)
          stub.reads.push(`query:${name}:${clauses.map(clauseLabel).join(',')}`)
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
