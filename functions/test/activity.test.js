import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../lib/admin.js'
import { buildActor, actorOf } from '../lib/actor.js'
import { historyDoc, notificationDoc } from '../lib/activity.js'
import { cleanDocId } from '../lib/doc-id.js'

afterEach(() => {
  mock.restoreAll()
})

describe('buildActor', () => {
  const auth = (token) => ({ uid: 'u1', token })

  it('takes the uid, the email and the name from the sign in token', () => {
    assert.deepEqual(buildActor(auth({ email: 'dana@qbs.example', name: 'Dana Lee' })), {
      uid: 'u1',
      email: 'dana@qbs.example',
      displayName: 'Dana Lee',
    })
  })

  it('falls back from the token name to the users document name, then the email, then Unknown user', () => {
    assert.equal(buildActor(auth({ email: 'a@b.co' }), { displayName: 'Dana Lee' }).displayName, 'Dana Lee')
    assert.equal(buildActor(auth({ email: 'a@b.co' }), {}).displayName, 'a@b.co')
    assert.equal(buildActor(auth({ email: 'a@b.co' })).displayName, 'a@b.co')
    assert.equal(buildActor(auth({})).displayName, 'Unknown user')
    assert.equal(buildActor({ uid: 'u1' }).displayName, 'Unknown user')
  })

  it('prefers the token name over the users document', () => {
    assert.equal(buildActor(auth({ name: 'Token Name' }), { displayName: 'Doc Name' }).displayName, 'Token Name')
  })

  it('treats blank and non string values as missing, and trims names', () => {
    assert.equal(buildActor(auth({ name: '   ', email: 'a@b.co' }), { displayName: ' Doc ' }).displayName, 'Doc')
    assert.equal(buildActor(auth({ name: 7, email: 'a@b.co' })).displayName, 'a@b.co')
    assert.equal(buildActor(auth({ email: '' })).email, null)
    assert.equal(buildActor(auth({ email: 5 })).email, null)
    assert.equal(buildActor(auth({})).email, null)
  })

  it('returns exactly uid, email and displayName', () => {
    const actor = buildActor(auth({ email: 'a@b.co', name: 'A', role: 'owner', tenantId: 'qbs' }))
    assert.deepEqual(Object.keys(actor).sort(), ['displayName', 'email', 'uid'])
  })
})

describe('actorOf', () => {
  let reads
  function stubUsers(docs = {}) {
    reads = []
    mock.method(db, 'doc', (path) => ({
      get: async () => {
        reads.push(path)
        const data = docs[path.replace(/^users\//, '')]
        return { exists: data !== undefined, data: () => data }
      },
    }))
  }

  it('does not read Firestore when the token carries a name', async () => {
    stubUsers()
    const actor = await actorOf({ auth: { uid: 'u1', token: { name: 'Dana Lee', email: 'd@x.co' } } })
    assert.deepEqual(actor, { uid: 'u1', email: 'd@x.co', displayName: 'Dana Lee' })
    assert.deepEqual(reads, [])
  })

  it('reads users/{uid} once, only when the token has no name', async () => {
    stubUsers({ u1: { displayName: 'Dana Lee' } })
    const actor = await actorOf({ auth: { uid: 'u1', token: { email: 'd@x.co' } } })
    assert.equal(actor.displayName, 'Dana Lee')
    assert.deepEqual(reads, ['users/u1'])
  })

  it('falls back to the email when there is no users document either', async () => {
    stubUsers({})
    const actor = await actorOf({ auth: { uid: 'u1', token: { email: 'd@x.co' } } })
    assert.equal(actor.displayName, 'd@x.co')
  })

  it('never reads an actor from the request data', async () => {
    stubUsers()
    const actor = await actorOf({
      auth: { uid: 'u1', token: { name: 'Dana Lee', email: 'd@x.co' } },
      data: { actor: { uid: 'someone-else', displayName: 'Boss' }, approvedBy: 'Boss', displayName: 'Boss' },
    })
    assert.deepEqual(actor, { uid: 'u1', email: 'd@x.co', displayName: 'Dana Lee' })
  })
})

describe('notificationDoc', () => {
  const actor = { uid: 'u1', email: 'dana@qbs.example', displayName: 'Dana Lee' }
  const scope = { tenantId: 'qbs', clientUids: ['c1', 'c2'] }

  it('carries the alert, the job, the scope, the author and an unread flag', () => {
    const doc = notificationDoc({ type: 'success', msg: 'CO-004 approved', jobId: 'QBS-003', scope, actor })
    assert.deepEqual(Object.keys(doc).sort(), [
      'clientUids',
      'createdAt',
      'createdBy',
      'createdByEmail',
      'jobId',
      'msg',
      'read',
      'tenantId',
      'type',
    ])
    assert.equal(doc.type, 'success')
    assert.equal(doc.msg, 'CO-004 approved')
    assert.equal(doc.jobId, 'QBS-003')
    assert.equal(doc.tenantId, 'qbs')
    assert.deepEqual(doc.clientUids, ['c1', 'c2'])
    assert.equal(doc.createdBy, 'u1')
    assert.equal(doc.createdByEmail, 'dana@qbs.example')
    assert.equal(doc.read, false)
    assert.ok(doc.createdAt.isEqual(FieldValue.serverTimestamp()), 'createdAt is a server timestamp')
  })

  it('copies clientUids so the scope it was built from stays untouched', () => {
    const doc = notificationDoc({ type: 'info', msg: 'm', jobId: 'J', scope, actor })
    doc.clientUids.push('c3')
    assert.deepEqual(scope.clientUids, ['c1', 'c2'])
  })

  it('records null rather than undefined for a missing job or email', () => {
    const doc = notificationDoc({ type: 'info', msg: 'm', scope, actor: { ...actor, email: null } })
    assert.equal(doc.jobId, null)
    assert.equal(doc.createdByEmail, null)
  })
})

describe('historyDoc', () => {
  const actor = { uid: 'u1', email: 'dana@qbs.example', displayName: 'Dana Lee' }

  it('has the shape the Activity feed renders, plus who did it', () => {
    const doc = historyDoc({
      type: 'change-order',
      action: 'approved',
      summary: 'CO-004 approved: $4,100',
      jobId: 'QBS-003',
      extraId: 'x1',
      actor,
    })
    assert.deepEqual(Object.keys(doc).sort(), [
      'action',
      'actor',
      'actorEmail',
      'actorUid',
      'createdAt',
      'createdBy',
      'createdByEmail',
      'extraId',
      'jobId',
      'summary',
      'type',
    ])
    assert.equal(doc.type, 'change-order')
    assert.equal(doc.action, 'approved')
    assert.equal(doc.summary, 'CO-004 approved: $4,100')
    assert.equal(doc.actor, 'Dana Lee', 'the feed shows actor as text')
    assert.equal(doc.actorUid, 'u1')
    assert.equal(doc.actorEmail, 'dana@qbs.example')
    assert.equal(doc.jobId, 'QBS-003')
    assert.equal(doc.extraId, 'x1')
    assert.equal(doc.createdBy, 'u1')
    assert.equal(doc.createdByEmail, 'dana@qbs.example')
    assert.ok(doc.createdAt.isEqual(FieldValue.serverTimestamp()), 'createdAt is a server timestamp')
  })

  it('has no extraId unless one is given', () => {
    const doc = historyDoc({ type: 'inspection', action: 'passed', summary: 's', jobId: 'QBS-003', actor })
    assert.equal('extraId' in doc, false)
  })

  it('records null rather than undefined for a missing job or email', () => {
    const doc = historyDoc({ type: 'job', action: 'created', summary: 's', actor: { ...actor, email: null } })
    assert.equal(doc.jobId, null)
    assert.equal(doc.actorEmail, null)
    assert.equal(doc.createdByEmail, null)
  })
})

describe('cleanDocId', () => {
  it('accepts the ids Firestore generates and the plain ones the app uses', () => {
    for (const id of ['k3Jd9sLq0PzXv81AbCdE', 'QBS-001', 'carlos', 'CO_004', 'a.b', '7']) {
      assert.equal(cleanDocId(id), id, id)
    }
  })

  it('refuses anything that could name a different document', () => {
    for (const bad of ['a/b', 'jobs/x/files/y', '/x', 'x/', '.', '..', '__name__', '_x', ' x', 'x ', 'a b', 'a\nb', '']) {
      assert.equal(cleanDocId(bad), null, JSON.stringify(bad))
    }
  })

  it('refuses values that are not strings, and very long ones', () => {
    for (const bad of [undefined, null, 5, {}, ['x'], true]) {
      assert.equal(cleanDocId(bad), null, JSON.stringify(bad))
    }
    assert.equal(cleanDocId('a'.repeat(200)), 'a'.repeat(200))
    assert.equal(cleanDocId('a'.repeat(201)), null)
  })
})
