import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../lib/admin.js'
import { validateNewUser as validateFromLib } from '../lib/users-validate.js'
import { createUser, onUserWritten, validateNewUser } from '../users.js'

// Nothing here reaches a network. The Admin Auth instance and the Firestore
// instance are the real singletons with the methods the handlers call replaced,
// so a call the handlers make that is not stubbed fails loudly (no credentials,
// no emulator) instead of quietly succeeding.

const authError = (code) => Object.assign(new Error(`Firebase auth error: ${code}`), { code })

let created, claimed, deleted, revoked // Auth calls, in order
let writes, removed, queries, batches // Firestore calls, in order
let logged // console.error and console.warn output

function stubAuth({ uid = 'new-uid', createError, claimsError, deleteError, revokeError } = {}) {
  const auth = getAuth()
  mock.method(auth, 'createUser', async (props) => {
    created.push(props)
    if (createError) throw createError
    return { uid, ...props }
  })
  mock.method(auth, 'setCustomUserClaims', async (target, claims) => {
    claimed.push({ uid: target, claims })
    if (claimsError) throw claimsError
  })
  mock.method(auth, 'deleteUser', async (target) => {
    deleted.push(target)
    if (deleteError) throw deleteError
  })
  mock.method(auth, 'revokeRefreshTokens', async (target) => {
    revoked.push(target)
    if (revokeError) throw revokeError
  })
}

// jobsById: { 'QBS-001': 'jobs/doc1' }  jobs a query on the id field finds
// jobsByUid: { u1: ['jobs/doc1'] }      jobs whose clientUids already list the uid
// userDocs: { o2: { role: 'owner' } }   users documents the request guard may read
function stubFirestore({ jobsById = {}, jobsByUid = {}, userDocs = {}, setError, batchError } = {}) {
  mock.method(db, 'doc', (path) => ({
    get: async () => {
      const data = userDocs[path.replace(/^users\//, '')]
      return { exists: data !== undefined, data: () => data }
    },
    set: async (data) => {
      if (setError) throw setError
      writes.push({ path, data })
    },
    delete: async () => {
      removed.push(path)
    },
  }))
  mock.method(db, 'collection', (name) => ({
    where: (field, op, value) => ({
      get: async () => {
        queries.push({ collection: name, field, op, value })
        const paths =
          field === 'id' && op === 'in'
            ? value.flatMap((id) => (jobsById[id] ? [jobsById[id]] : []))
            : field === 'clientUids' && op === 'array-contains'
              ? (jobsByUid[value] ?? [])
              : []
        return { docs: paths.map((path) => ({ ref: { path } })) }
      },
    }),
  }))
  mock.method(db, 'batch', () => {
    const ops = []
    return {
      update: (ref, data) => ops.push({ path: ref.path, data }),
      commit: async () => {
        if (batchError) throw batchError
        batches.push(ops)
      },
    }
  })
}

beforeEach(() => {
  created = []
  claimed = []
  deleted = []
  revoked = []
  writes = []
  removed = []
  queries = []
  batches = []
  logged = []
  mock.method(console, 'error', (...args) => logged.push(['error', ...args]))
  mock.method(console, 'warn', (...args) => logged.push(['warn', ...args]))
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

describe('users.js exports', () => {
  it('re-exports the pure validateNewUser so callers and tests can import it from here', () => {
    assert.equal(validateNewUser, validateFromLib)
  })
})

describe('createUser', () => {
  const OWNER = { uid: 'owner1', token: { role: 'owner', email: 'jesse@p2em.com' } }
  const call = (data, auth = OWNER) => createUser.run({ data, auth, rawRequest: {} })
  const staff = { email: 'Pat@Example.com', displayName: 'Pat Lee', role: 'internal' }

  it('rejects a signed out caller and touches nothing', async () => {
    stubAuth()
    stubFirestore()
    await assert.rejects(createUser.run({ data: staff, auth: undefined, rawRequest: {} }), code('unauthenticated', 'You must be signed in.'))
    assert.deepEqual([created, claimed, writes], [[], [], []])
  })

  it('rejects every caller who is not an owner and touches nothing', async () => {
    stubAuth()
    stubFirestore()
    for (const role of ['internal', 'builder', 'client']) {
      const caller = { uid: 'u1', token: { role, tenantId: 'qbs', email: 'x@y.co' } }
      await assert.rejects(call(staff, caller), code('permission-denied', 'Owner access required.'))
    }
    assert.deepEqual([created, claimed, writes], [[], [], []])
  })

  it('takes the role from the users document for a caller whose token has no role claim yet', async () => {
    stubAuth()
    stubFirestore({ userDocs: { o2: { role: 'owner' }, i2: { role: 'internal' } } })
    const noClaim = (uid) => ({ uid, token: { email: `${uid}@p2em.com` } })
    assert.deepEqual(await call(staff, noClaim('o2')), { uid: 'new-uid' })
    await assert.rejects(call(staff, noClaim('i2')), code('permission-denied', 'Owner access required.'))
    await assert.rejects(call(staff, noClaim('nobody')), code('permission-denied', 'Owner access required.'))
    assert.equal(created.length, 1)
  })

  it('answers invalid input with invalid-argument and the validation message, before any Auth call', async () => {
    stubAuth()
    stubFirestore()
    const cases = [
      [{ ...staff, email: 'nope' }, 'Enter a valid email address.'],
      [{ ...staff, role: 'admin' }, 'Choose a role.'],
      [{ ...staff, role: 'builder' }, 'Choose a builder tenant.'],
      [{ ...staff, role: 'client' }, 'Enter at least one job id like QBS-001.'],
      [{ ...staff, role: 'client', clientJobIds: ['bad'] }, 'Job ids must look like QBS-001.'],
      [undefined, 'Enter a valid email address.'],
    ]
    for (const [data, message] of cases) {
      await assert.rejects(call(data), code('invalid-argument', message))
    }
    assert.deepEqual([created, claimed, writes], [[], [], []])
  })

  it('creates the Auth user with the cleaned email and name, a random password and an unverified email', async () => {
    stubAuth()
    stubFirestore()
    await call(staff)
    assert.equal(created.length, 1)
    const [props] = created
    assert.deepEqual(Object.keys(props).sort(), ['displayName', 'email', 'emailVerified', 'password'])
    assert.equal(props.email, 'pat@example.com')
    assert.equal(props.displayName, 'Pat Lee')
    assert.equal(props.emailVerified, false)
    assert.match(props.password, /^[0-9a-f]{64}$/)
  })

  it('uses a different random password for every account', async () => {
    stubAuth()
    stubFirestore()
    await call(staff)
    await call({ ...staff, email: 'other@example.com' })
    assert.notEqual(created[0].password, created[1].password)
  })

  it('falls back to the email as the display name', async () => {
    stubAuth()
    stubFirestore()
    await call({ email: 'pat@example.com', role: 'owner' })
    assert.equal(created[0].displayName, 'pat@example.com')
  })

  it('sets claims for staff, with the p2-core tenant and no job ids', async () => {
    stubAuth({ uid: 'u-staff' })
    stubFirestore()
    await call(staff)
    assert.deepEqual(claimed, [
      { uid: 'u-staff', claims: { role: 'internal', tenantId: 'p2-core', clientJobIds: [] } },
    ])
  })

  it('sets claims for a builder with the chosen tenant', async () => {
    stubAuth({ uid: 'u-b' })
    stubFirestore()
    await call({ ...staff, role: 'builder', tenantId: 'vision' })
    assert.deepEqual(claimed[0].claims, { role: 'builder', tenantId: 'vision', clientJobIds: [] })
  })

  it('sets claims for a client with the cleaned job ids', async () => {
    stubAuth({ uid: 'u-c' })
    stubFirestore()
    await call({ ...staff, role: 'client', clientJobIds: [' qbs-001', 'VIS-002'] })
    assert.deepEqual(claimed[0].claims, {
      role: 'client',
      tenantId: 'p2-core',
      clientJobIds: ['QBS-001', 'VIS-002'],
    })
  })

  it('writes users/{uid} for staff with who created it and when, and no client fields', async () => {
    stubAuth({ uid: 'u-staff' })
    stubFirestore()
    await call(staff)
    assert.equal(writes.length, 1)
    const { path, data } = writes[0]
    assert.equal(path, 'users/u-staff')
    assert.deepEqual(Object.keys(data).sort(), [
      'createdAt',
      'createdBy',
      'createdByEmail',
      'displayName',
      'email',
      'role',
      'tenantId',
    ])
    assert.equal(data.email, 'pat@example.com')
    assert.equal(data.displayName, 'Pat Lee')
    assert.equal(data.role, 'internal')
    assert.equal(data.tenantId, 'p2-core')
    assert.equal(data.createdBy, 'owner1')
    assert.equal(data.createdByEmail, 'jesse@p2em.com')
    assert.ok(data.createdAt.isEqual(FieldValue.serverTimestamp()), 'createdAt is a server timestamp')
  })

  it('writes the job ids and the client name for a client', async () => {
    stubAuth({ uid: 'u-c' })
    stubFirestore()
    await call({ ...staff, displayName: 'Lee Homes', role: 'client', clientJobIds: ['QBS-001'] })
    const { data } = writes[0]
    assert.deepEqual(data.clientJobIds, ['QBS-001'])
    assert.equal(data.clientName, 'Lee Homes')
    assert.equal(data.tenantId, 'p2-core')
  })

  it('writes the tenant for a builder and no client fields', async () => {
    stubAuth({ uid: 'u-b' })
    stubFirestore()
    await call({ ...staff, role: 'builder', tenantId: 'qbs' })
    const { data } = writes[0]
    assert.equal(data.tenantId, 'qbs')
    assert.equal('clientJobIds' in data, false)
    assert.equal('clientName' in data, false)
  })

  it('records null when the caller token carries no email', async () => {
    stubAuth()
    stubFirestore()
    await call(staff, { uid: 'owner1', token: { role: 'owner' } })
    assert.equal(writes[0].data.createdByEmail, null)
  })

  it('returns only the uid, never the password', async () => {
    stubAuth({ uid: 'u-new' })
    stubFirestore()
    assert.deepEqual(await call(staff), { uid: 'u-new' })
  })

  it('sets the claims before it writes the document', async () => {
    const order = []
    stubAuth()
    stubFirestore()
    const auth = getAuth()
    mock.method(auth, 'setCustomUserClaims', async () => order.push('claims'))
    mock.method(db, 'doc', () => ({ set: async () => order.push('document') }))
    await call(staff)
    assert.deepEqual(order, ['claims', 'document'])
  })

  it('answers an email that is already registered with already-exists, and writes nothing', async () => {
    stubAuth({ createError: authError('auth/email-already-exists') })
    stubFirestore()
    await assert.rejects(call(staff), code('already-exists', 'An account with that email already exists.'))
    assert.deepEqual([claimed, writes, deleted], [[], [], []])
  })

  it('hides any other Auth error behind a generic message and logs the original', async () => {
    const original = authError('auth/internal-error')
    stubAuth({ createError: original })
    stubFirestore()
    await assert.rejects(call(staff), code('internal', 'Could not create the account. Try again.'))
    assert.deepEqual([claimed, writes, deleted], [[], [], []])
    assert.ok(logged.some(([level, , err]) => level === 'error' && err === original), 'original error is logged')
  })

  it('deletes the new Auth user again when setting claims fails, so a retry works', async () => {
    stubAuth({ uid: 'u-half', claimsError: authError('auth/internal-error') })
    stubFirestore()
    await assert.rejects(call(staff), code('internal', 'Could not create the account. Try again.'))
    assert.deepEqual(deleted, ['u-half'])
    assert.deepEqual(writes, [])
    assert.deepEqual(removed, [], 'no document was written, so none is deleted')
  })

  it('deletes the new Auth user and the document when the document write fails', async () => {
    stubAuth({ uid: 'u-half' })
    stubFirestore({ setError: new Error('firestore unavailable') })
    await assert.rejects(call(staff), code('internal', 'Could not create the account. Try again.'))
    assert.deepEqual(deleted, ['u-half'])
    assert.deepEqual(removed, ['users/u-half'])
  })

  it('still reports the original failure when the clean up also fails', async () => {
    stubAuth({
      uid: 'u-half',
      claimsError: authError('auth/internal-error'),
      deleteError: new Error('delete failed'),
    })
    stubFirestore()
    await assert.rejects(call(staff), code('internal', 'Could not create the account. Try again.'))
    assert.deepEqual(deleted, ['u-half'])
    assert.ok(logged.filter(([level]) => level === 'error').length >= 2, 'both failures are logged')
  })
})

describe('onUserWritten', () => {
  const snap = (data) => ({ exists: data != null, data: () => data })
  const event = (uid, before, after) => ({ params: { uid }, data: { before: snap(before), after: snap(after) } })
  const run = (uid, before, after) => onUserWritten.run(event(uid, before, after))

  const client = (ids) => ({ role: 'client', tenantId: 'p2-core', clientJobIds: ids })
  const hasOp = (ops, path, change) => ops.some((op) => op.path === path && op.data.clientUids.isEqual(change))

  it('sets claims from a new document and does not revoke', async () => {
    stubAuth()
    stubFirestore()
    await run('u1', null, { role: 'builder', tenantId: 'qbs', displayName: 'Bo' })
    assert.deepEqual(claimed, [{ uid: 'u1', claims: { role: 'builder', tenantId: 'qbs', clientJobIds: [] } }])
    assert.deepEqual(revoked, [])
    assert.deepEqual([queries, batches], [[], []])
  })

  it('adds a new client to the clientUids of the jobs with those ids', async () => {
    stubAuth()
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a', 'QBS-002': 'jobs/b', 'QBS-003': 'jobs/c' } })
    await run('u1', null, client(['QBS-001', 'QBS-002']))
    assert.deepEqual(queries, [{ collection: 'jobs', field: 'id', op: 'in', value: ['QBS-001', 'QBS-002'] }])
    assert.equal(batches.length, 1)
    assert.equal(batches[0].length, 2)
    assert.ok(hasOp(batches[0], 'jobs/a', FieldValue.arrayUnion('u1')))
    assert.ok(hasOp(batches[0], 'jobs/b', FieldValue.arrayUnion('u1')))
    assert.deepEqual(revoked, [])
  })

  it('asks for job ids ten at a time', async () => {
    stubAuth()
    stubFirestore()
    const ids = Array.from({ length: 23 }, (_, i) => `QBS-${String(i + 1).padStart(3, '0')}`)
    await run('u1', null, client(ids))
    assert.deepEqual(
      queries.map((q) => q.value.length),
      [10, 10, 3],
    )
    assert.deepEqual(queries.flatMap((q) => q.value), ids)
    assert.ok(queries.every((q) => q.field === 'id' && q.op === 'in'))
  })

  it('adds and removes only the job ids that changed', async () => {
    stubAuth()
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a', 'QBS-002': 'jobs/b', 'QBS-003': 'jobs/c' } })
    await run('u1', client(['QBS-001', 'QBS-002']), client(['QBS-002', 'QBS-003']))
    const ops = batches.flat()
    assert.equal(ops.length, 2)
    assert.ok(hasOp(ops, 'jobs/c', FieldValue.arrayUnion('u1')))
    assert.ok(hasOp(ops, 'jobs/a', FieldValue.arrayRemove('u1')))
    assert.deepEqual(revoked, [])
  })

  it('sets the claims again but changes no jobs and revokes nothing for an unchanged client', async () => {
    stubAuth()
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a' } })
    await run('u1', client(['QBS-001']), { ...client(['QBS-001']), displayName: 'Renamed' })
    assert.deepEqual(claimed, [
      { uid: 'u1', claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } },
    ])
    assert.deepEqual([queries, batches, revoked], [[], [], []])
  })

  it('sets the claims first, then revokes refresh tokens, when the role changes', async () => {
    const order = []
    stubAuth()
    stubFirestore()
    const auth = getAuth()
    mock.method(auth, 'setCustomUserClaims', async () => order.push('claims'))
    mock.method(auth, 'revokeRefreshTokens', async () => order.push('revoke'))
    await run('u1', { role: 'internal' }, { role: 'builder', tenantId: 'qbs' })
    assert.deepEqual(order, ['claims', 'revoke'])
  })

  it('removes a client from their jobs and revokes when their role changes away from client', async () => {
    stubAuth()
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a' } })
    await run('u1', client(['QBS-001']), { role: 'internal', tenantId: 'p2-core' })
    assert.deepEqual(revoked, ['u1'])
    assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayRemove('u1')))
    assert.deepEqual(claimed[0].claims, { role: 'internal', tenantId: 'p2-core', clientJobIds: [] })
  })

  it('clears the claims, revokes, and removes the uid from every job that lists it when the document is deleted', async () => {
    stubAuth()
    stubFirestore({
      jobsById: { 'QBS-001': 'jobs/a' },
      jobsByUid: { u1: ['jobs/a', 'jobs/z'] },
    })
    await run('u1', client(['QBS-001']), null)
    assert.deepEqual(claimed, [{ uid: 'u1', claims: null }])
    assert.deepEqual(revoked, ['u1'])
    const ops = batches.flat()
    assert.deepEqual(ops.map((op) => op.path).sort(), ['jobs/a', 'jobs/z'], 'each job once, including one not in the old list')
    assert.ok(ops.every((op) => op.data.clientUids.isEqual(FieldValue.arrayRemove('u1'))))
  })

  it('does not search for jobs that list the uid unless the document was deleted', async () => {
    stubAuth()
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a' } })
    await run('u1', client(['QBS-001']), { role: 'internal' })
    assert.ok(!queries.some((q) => q.field === 'clientUids'))
  })

  it('clears claims without revoking when a deleted document never had a role', async () => {
    stubAuth()
    stubFirestore()
    await run('u1', { displayName: 'No Role' }, null)
    assert.deepEqual(claimed, [{ uid: 'u1', claims: null }])
    assert.deepEqual(revoked, [])
  })

  it('sets a null role for a document whose role is not one of the four', async () => {
    stubAuth()
    stubFirestore()
    await run('u1', null, { role: 'superuser', tenantId: 'qbs' })
    assert.deepEqual(claimed[0].claims, { role: null, tenantId: 'qbs', clientJobIds: [] })
  })

  it('logs a warning and finishes without throwing when there is no Auth account for the uid', async () => {
    stubAuth({ claimsError: authError('auth/user-not-found') })
    stubFirestore()
    await run('ghost', null, { role: 'internal' })
    assert.ok(logged.some(([level, message]) => level === 'warn' && String(message).includes('ghost')))
    assert.ok(!logged.some(([level]) => level === 'error'))
  })

  it('does not revoke after a user-not-found, and still removes a deleted client from their jobs', async () => {
    stubAuth({ claimsError: authError('auth/user-not-found') })
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a' } })
    await run('ghost', client(['QBS-001']), null)
    assert.deepEqual(revoked, [])
    assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayRemove('ghost')))
  })

  it('treats user-not-found from the revoke call the same way', async () => {
    stubAuth({ revokeError: authError('auth/user-not-found') })
    stubFirestore()
    await run('ghost', { role: 'internal' }, { role: 'builder', tenantId: 'qbs' })
    assert.ok(logged.some(([level]) => level === 'warn'))
  })

  it('rethrows any other Auth error, after still updating the jobs', async () => {
    stubAuth({ claimsError: authError('auth/internal-error') })
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a' } })
    await assert.rejects(run('u1', null, client(['QBS-001'])), /auth\/internal-error/)
    assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayUnion('u1')))
  })

  it('rethrows a Firestore error, after still setting the claims', async () => {
    stubAuth()
    stubFirestore({ jobsById: { 'QBS-001': 'jobs/a' }, batchError: new Error('commit failed') })
    await assert.rejects(run('u1', null, client(['QBS-001'])), /commit failed/)
    assert.equal(claimed.length, 1)
  })

  it('splits a very large set of job updates into several batches', async () => {
    const jobsById = {}
    const ids = Array.from({ length: 450 }, (_, i) => `QBS-${String(i + 100).padStart(3, '0')}`)
    ids.forEach((id, i) => (jobsById[id] = `jobs/j${i}`))
    stubAuth()
    stubFirestore({ jobsById })
    await run('u1', null, client(ids))
    assert.ok(batches.length >= 2, 'more than one batch')
    assert.ok(batches.every((ops) => ops.length <= 400), 'no batch is over 400 writes')
    assert.equal(batches.flat().length, 450)
  })

  it('does nothing when the event carries no data', async () => {
    stubAuth()
    stubFirestore()
    await onUserWritten.run({ params: { uid: 'u1' }, data: undefined })
    assert.deepEqual([claimed, revoked, queries, batches], [[], [], [], []])
  })
})
