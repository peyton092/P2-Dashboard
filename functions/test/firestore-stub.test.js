import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from '../lib/admin.js'
import { READ_AFTER_WRITE, assertNoDashes, code, isServerTime, stubFirestore } from './helpers/firestore-stub.js'

// The handler tests lean on this stub to behave the way Firestore does, so what it
// promises is checked here.
afterEach(() => {
  mock.restoreAll()
})

const DOCS = {
  extras: { x1: { id: 'CO-004', job: 'QBS-003' }, x2: { id: 'CO-005', job: 'QBS-003' } },
  jobs: { job3: { id: 'QBS-003', tenantId: 'qbs' }, job4: { id: 'QBS-004', tenantId: 'qbs' } },
  users: { u1: { displayName: 'Dana Lee' } },
}

describe('stubFirestore transactions', () => {
  it('commits what the callback staged once it finishes, and answers with what it returned', async () => {
    const stub = stubFirestore(DOCS)
    const result = await db.runTransaction(async (tx) => {
      await tx.get(db.collection('extras').doc('x1'))
      tx.update(db.collection('extras').doc('x1'), { status: 'Approved' })
      tx.set(db.collection('history').doc(), { type: 'change-order' })
      return 'done'
    })
    assert.equal(result, 'done')
    assert.deepEqual(stub.writes.map((w) => [w.op, w.path.replace(/auto\d+$/, 'autoN')]), [
      ['update', 'extras/x1'],
      ['set', 'history/autoN'],
    ])
  })

  it('commits nothing when the callback throws, and passes the error on', async () => {
    const stub = stubFirestore(DOCS)
    await assert.rejects(
      db.runTransaction(async (tx) => {
        tx.update(db.collection('extras').doc('x1'), { status: 'Approved' })
        throw new HttpsError('failed-precondition', 'Not now.')
      }),
      code('failed-precondition', 'Not now.'),
    )
    assert.deepEqual(stub.writes, [])
  })

  it('refuses a read once a write is staged, with the Admin SDK message', async () => {
    const stub = stubFirestore(DOCS)
    await assert.rejects(
      db.runTransaction(async (tx) => {
        tx.set(db.collection('history').doc(), { type: 'change-order' })
        await tx.get(db.collection('extras').doc('x1'))
      }),
      { message: READ_AFTER_WRITE },
    )
    assert.equal(READ_AFTER_WRITE, 'Firestore transactions require all reads to be executed before all writes.')
    assert.deepEqual(stub.writes, [], 'a transaction that broke the rule commits nothing')
  })

  it('refuses a query read after a write the same way, and throws from get itself', async () => {
    stubFirestore(DOCS)
    await db.runTransaction(async (tx) => {
      tx.update(db.collection('extras').doc('x1'), { status: 'Approved' })
      assert.throws(() => tx.get({ query: { name: 'jobs', field: 'id', op: '==', value: 'QBS-003' } }), { message: READ_AFTER_WRITE })
    })
  })

  it('allows any number of reads while nothing has been written yet', async () => {
    const stub = stubFirestore(DOCS)
    await db.runTransaction(async (tx) => {
      await tx.get(db.collection('extras').doc('x1'))
      await tx.get(db.collection('jobs').where('id', '==', 'QBS-003').limit(1))
      await tx.get(db.collection('extras').doc('x2'))
      tx.set(db.collection('history').doc(), { type: 'change-order' })
    })
    assert.deepEqual(stub.reads, ['extras/x1', 'query:jobs:id==QBS-003', 'extras/x2'])
    assert.equal(stub.writes.length, 1)
  })

  it('refuses undefined in written data, naming the field, and keeps everything else', async () => {
    const stub = stubFirestore(DOCS)
    const stageWith = (data) => db.runTransaction(async (tx) => tx.set(db.collection('history').doc(), data))
    await assert.rejects(stageWith({ jobId: undefined }), /Cannot use "undefined" as a Firestore value \(found in field "jobId"\)/)
    await assert.rejects(stageWith({ actor: { email: undefined } }), /found in field "actor\.email"/)
    await assert.rejects(stageWith({ list: ['a', undefined] }), /found in field "list\[1\]"/)
    assert.deepEqual(stub.writes, [])

    await stageWith({ jobId: null, createdAt: FieldValue.serverTimestamp(), clientUids: [], nested: { a: 'b' } })
    assert.equal(stub.writes.length, 1)
    assert.ok(isServerTime(stub.writes[0].data.createdAt))
  })
})

describe('stubFirestore reads', () => {
  it('answers a document that exists and one that does not', async () => {
    stubFirestore(DOCS)
    await db.runTransaction(async (tx) => {
      const found = await tx.get(db.collection('extras').doc('x1'))
      assert.equal(found.exists, true)
      assert.deepEqual(found.data(), { id: 'CO-004', job: 'QBS-003' })
      const missing = await tx.get(db.collection('extras').doc('nope'))
      assert.equal(missing.exists, false)
      assert.equal(missing.data(), undefined)
      const noCollection = await tx.get(db.collection('elsewhere').doc('x'))
      assert.equal(noCollection.exists, false)
    })
  })

  it('answers an equality query with the matching documents', async () => {
    stubFirestore(DOCS)
    await db.runTransaction(async (tx) => {
      const one = await tx.get(db.collection('jobs').where('id', '==', 'QBS-004').limit(1))
      assert.equal(one.empty, false)
      assert.equal(one.size, 1)
      assert.equal(one.docs[0].id, 'job4')
      assert.deepEqual(one.docs[0].data(), { id: 'QBS-004', tenantId: 'qbs' })
      const many = await tx.get(db.collection('jobs').where('tenantId', '==', 'qbs').limit(5))
      assert.equal(many.size, 2)
      const none = await tx.get(db.collection('jobs').where('id', '==', 'QBS-999').limit(1))
      assert.equal(none.empty, true)
      assert.deepEqual(none.docs, [])
      const noCollection = await tx.get(db.collection('elsewhere').where('id', '==', 'x').limit(1))
      assert.equal(noCollection.empty, true)
    })
  })

  it('refuses a query that is not an equality, so a handler cannot lean on one it does not answer', async () => {
    stubFirestore(DOCS)
    await assert.rejects(
      db.runTransaction((tx) => tx.get(db.collection('jobs').where('id', 'in', ['QBS-003']).limit(1))),
      /the stub answers == queries only/,
    )
  })

  it('reads a users document outside a transaction', async () => {
    const stub = stubFirestore(DOCS)
    const found = await db.doc('users/u1').get()
    assert.equal(found.exists, true)
    assert.equal(found.data().displayName, 'Dana Lee')
    assert.equal((await db.doc('users/ghost').get()).exists, false)
    assert.deepEqual(stub.calls, ['doc:users/u1', 'doc:users/ghost'])
  })
})

describe('stubFirestore bookkeeping', () => {
  it('gives each new document a different id, and uses the one it is given', () => {
    stubFirestore()
    const first = db.collection('history').doc()
    const second = db.collection('history').doc()
    assert.notEqual(first.id, second.id)
    assert.equal(first.path, `history/${first.id}`)
    assert.deepEqual(db.collection('extras').doc('x1'), { id: 'x1', path: 'extras/x1' })
  })

  it('records the entry points touched, and lists committed writes by path prefix', async () => {
    const stub = stubFirestore(DOCS)
    await db.runTransaction(async (tx) => {
      tx.set(db.collection('notifications').doc(), { msg: 'a' })
      tx.set(db.collection('history').doc(), { summary: 'b' })
      tx.set(db.collection('notifications').doc(), { msg: 'c' })
    })
    assert.deepEqual(stub.calls, [
      'runTransaction', 'collection:notifications', 'collection:history', 'collection:notifications',
    ])
    assert.deepEqual(stub.written('notifications/').map((w) => w.data.msg), ['a', 'c'])
    assert.deepEqual(stub.written('history/').map((w) => w.data.summary), ['b'])
    assert.deepEqual(stub.written('extras/'), [])
  })

  it('forgets calls, reads and writes on clear, and keeps the documents', async () => {
    const stub = stubFirestore(DOCS)
    await db.runTransaction(async (tx) => {
      await tx.get(db.collection('extras').doc('x1'))
      tx.set(db.collection('history').doc(), { summary: 'b' })
    })
    stub.clear()
    assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
    await db.runTransaction(async (tx) => {
      assert.equal((await tx.get(db.collection('extras').doc('x1'))).exists, true)
    })
  })

  it('leaves everything else on the instance unstubbed, so it fails loudly', () => {
    stubFirestore(DOCS)
    assert.equal(typeof db.collection('extras').get, 'undefined')
    assert.equal(typeof db.batch, 'function', 'the real batch is still there, and would need a network')
  })
})

// The triggers and the backfill read collections and write in batches, outside any
// transaction. That is opt in, so a handler that is meant to use a transaction still
// fails loudly if it reaches for either.
describe('stubFirestore outside a transaction (opt in)', () => {
  const OPT_IN = { outsideTransactions: true }

  it('is off unless asked for: no plain read of a collection or a query, and the batch is the real one', () => {
    stubFirestore(DOCS)
    assert.equal(typeof db.collection('extras').get, 'undefined')
    assert.equal(typeof db.collection('extras').where('job', '==', 'QBS-003').get, 'undefined')
    assert.equal(db.batch.mock, undefined, 'db.batch is not replaced')
  })

  it('reads every document of a collection, each with its id, reference and data', async () => {
    stubFirestore(DOCS, OPT_IN)
    const snap = await db.collection('extras').get()
    assert.equal(snap.empty, false)
    assert.equal(snap.size, 2)
    assert.deepEqual(snap.docs.map((doc) => doc.id), ['x1', 'x2'])
    assert.deepEqual(snap.docs[0].ref, { id: 'x1', path: 'extras/x1' })
    assert.deepEqual(snap.docs[1].data(), { id: 'CO-005', job: 'QBS-003' })
  })

  it('reads a collection that has no documents, or does not exist, as empty', async () => {
    stubFirestore({ extras: {} }, OPT_IN)
    for (const name of ['extras', 'elsewhere']) {
      const snap = await db.collection(name).get()
      assert.deepEqual([snap.empty, snap.size, snap.docs], [true, 0, []])
    }
  })

  it('answers an equality query with the matching documents, and refuses any other operator', async () => {
    stubFirestore(DOCS, OPT_IN)
    const some = await db.collection('jobs').where('id', '==', 'QBS-004').get()
    assert.deepEqual(some.docs.map((doc) => doc.id), ['job4'])
    assert.deepEqual(some.docs[0].ref, { id: 'job4', path: 'jobs/job4' })
    const none = await db.collection('jobs').where('id', '==', 'QBS-999').get()
    assert.equal(none.empty, true)
    await assert.rejects(db.collection('jobs').where('id', 'in', ['QBS-003']).get(), /the stub answers == queries only/)
  })

  it('still answers the transaction reads and the query the privileged callables use', async () => {
    const stub = stubFirestore(DOCS, OPT_IN)
    await db.runTransaction(async (tx) => {
      assert.equal((await tx.get(db.collection('extras').doc('x1'))).exists, true)
      assert.equal((await tx.get(db.collection('jobs').where('id', '==', 'QBS-003').limit(1))).size, 1)
      tx.update(db.collection('extras').doc('x1'), { status: 'Approved' })
    })
    assert.equal(stub.writes.length, 1)
  })

  it('commits a batch as one group, in the order it was staged, and not before commit', async () => {
    const stub = stubFirestore(DOCS, OPT_IN)
    const batch = db.batch()
    batch.update(db.collection('extras').doc('x1'), { tenantId: 'qbs' })
    batch.set(db.collection('history').doc('h1'), { type: 'job' })
    batch.update(db.collection('extras').doc('x2'), { tenantId: 'qbs' })
    assert.deepEqual(stub.writes, [], 'nothing is written until commit')
    await batch.commit()
    assert.deepEqual(stub.writes.map((w) => [w.op, w.path]), [
      ['update', 'extras/x1'], ['set', 'history/h1'], ['update', 'extras/x2'],
    ])
    assert.deepEqual(stub.batches.map((group) => group.length), [3])
    assert.deepEqual(stub.written('extras/').map((w) => w.data), [{ tenantId: 'qbs' }, { tenantId: 'qbs' }])
  })

  it('keeps each batch as its own group', async () => {
    const stub = stubFirestore(DOCS, OPT_IN)
    for (const id of ['x1', 'x2']) {
      const batch = db.batch()
      batch.update(db.collection('extras').doc(id), { tenantId: 'qbs' })
      await batch.commit()
    }
    assert.deepEqual(stub.batches.map((group) => group.map((w) => w.path)), [['extras/x1'], ['extras/x2']])
    assert.equal(stub.writes.length, 2)
  })

  it('refuses a batch of more than 500 writes, as Firestore does, and commits none of it', async () => {
    const stub = stubFirestore(DOCS, OPT_IN)
    const batch = db.batch()
    for (let i = 0; i < 501; i++) batch.update(db.collection('extras').doc('x1'), { n: i })
    await assert.rejects(batch.commit(), /maximum 500 writes allowed per request/)
    assert.deepEqual([stub.writes, stub.batches], [[], []])

    const exactly = db.batch()
    for (let i = 0; i < 500; i++) exactly.update(db.collection('extras').doc('x1'), { n: i })
    await exactly.commit()
    assert.equal(stub.writes.length, 500)
  })

  it('refuses undefined in staged data, naming the field, as the Admin SDK does', () => {
    stubFirestore(DOCS, OPT_IN)
    const batch = db.batch()
    assert.throws(() => batch.update(db.collection('extras').doc('x1'), { clientUids: [undefined] }), /found in field "clientUids\[0\]"/)
    assert.throws(() => batch.set(db.collection('history').doc('h1'), { jobId: undefined }), /found in field "jobId"/)
  })

  it('refuses to update a document that does not exist, as Firestore does, and commits none of the batch', async () => {
    const stub = stubFirestore(DOCS, OPT_IN)
    const batch = db.batch()
    batch.update(db.collection('extras').doc('x1'), { tenantId: 'qbs' })
    batch.update(db.collection('extras').doc('gone'), { tenantId: 'qbs' })
    await assert.rejects(batch.commit(), /No document to update: extras\/gone/)
    assert.deepEqual([stub.writes, stub.batches], [[], []])
  })

  it('records the batch as an entry point, and forgets it, and the groups, on clear', async () => {
    const stub = stubFirestore(DOCS, OPT_IN)
    const batch = db.batch()
    batch.update(db.collection('extras').doc('x1'), { tenantId: 'qbs' })
    await batch.commit()
    assert.deepEqual(stub.calls, ['batch', 'collection:extras'])
    stub.clear()
    assert.deepEqual([stub.calls, stub.reads, stub.writes, stub.batches], [[], [], [], []])
  })

  it('keeps no groups when nothing is batched, so the shape is the same either way', () => {
    assert.deepEqual(stubFirestore(DOCS).batches, [])
    mock.restoreAll()
    assert.deepEqual(stubFirestore(DOCS, OPT_IN).batches, [])
  })
})

describe('the shared assertions', () => {
  it('code matches an HttpsError by code and, when given, message', () => {
    const error = new HttpsError('not-found', 'Gone.')
    assert.equal(code('not-found')(error), true)
    assert.equal(code('not-found', 'Gone.')(error), true)
    assert.throws(() => code('internal')(error), /internal/)
    assert.throws(() => code('not-found', 'Other.')(error))
    assert.throws(() => code('not-found')(new Error('plain')), /expected an HttpsError/)
  })

  it('assertNoDashes lets job ids and change order numbers through and refuses any other dash', () => {
    assertNoDashes('CO-2026-001 approved by Dana Lee: $4,100 (QBS-003)')
    assert.throws(() => assertNoDashes('rough-in passed'))
    assert.throws(() => assertNoDashes('CO-004 approved — $4,100'))
    assert.throws(() => assertNoDashes('2 – 3'))
    assert.throws(() => assertNoDashes('minus − sign'))
  })

  it('isServerTime recognizes a server timestamp and nothing else', () => {
    assert.equal(isServerTime(FieldValue.serverTimestamp()), true)
    assert.equal(isServerTime(FieldValue.delete()), false)
  })
})
