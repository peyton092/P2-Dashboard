import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from '../lib/admin.js'
import { requireAuth, requireStaff, requireOwner } from '../lib/authz.js'

// users/{uid} reads are stubbed on the Firestore instance, so no test touches
// the network. `reads` records every document path that was fetched.
let reads = []
function stubUsers(docsByUid = {}) {
  reads = []
  mock.method(db, 'doc', (path) => ({
    get: async () => {
      reads.push(path)
      const data = docsByUid[path.replace(/^users\//, '')]
      return { exists: data !== undefined, data: () => data }
    },
  }))
}

afterEach(() => {
  mock.restoreAll()
  reads = []
})

const reqFor = (uid, token = {}) => ({ auth: { uid, token } })

const denied = (code, message) => (err) => {
  assert.ok(err instanceof HttpsError, `expected an HttpsError, got ${err}`)
  assert.equal(err.code, code)
  assert.equal(err.message, message)
  return true
}

describe('requireAuth', () => {
  it('throws unauthenticated when the request has no auth, without reading Firestore', async () => {
    stubUsers()
    await assert.rejects(requireAuth({}), denied('unauthenticated', 'You must be signed in.'))
    await assert.rejects(requireAuth({ auth: null }), denied('unauthenticated', 'You must be signed in.'))
    assert.deepEqual(reads, [])
  })

  it('returns the token claims and does not read Firestore when the token has a role', async () => {
    stubUsers({ u1: { role: 'owner' } })
    const claims = await requireAuth(
      reqFor('u1', { role: 'builder', tenantId: 'qbs', clientJobIds: [], email: 'b@qbs.co' }),
    )
    assert.deepEqual(claims, { uid: 'u1', role: 'builder', tenantId: 'qbs', clientJobIds: [] })
    assert.deepEqual(reads, [])
  })

  it('does not fall back to the document for a role claim that is present but not a real role', async () => {
    stubUsers({ u1: { role: 'owner' } })
    const claims = await requireAuth(reqFor('u1', { role: 'admin' }))
    assert.equal(claims.role, 'admin')
    assert.deepEqual(reads, [])
  })

  it('reads users/{uid} exactly once and merges it when the token has no role claim', async () => {
    stubUsers({ u2: { role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001'], displayName: 'Pat' } })
    const claims = await requireAuth(reqFor('u2', { email: 'pat@example.com' }))
    assert.deepEqual(claims, { uid: 'u2', role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001'] })
    assert.deepEqual(reads, ['users/u2'])
  })

  it('treats a null role claim as missing', async () => {
    stubUsers({ u3: { role: 'internal' } })
    const claims = await requireAuth(reqFor('u3', { role: null }))
    assert.equal(claims.role, 'internal')
    assert.deepEqual(reads, ['users/u3'])
  })

  it('leaves the role null when the users document does not exist', async () => {
    stubUsers({})
    const claims = await requireAuth(reqFor('ghost'))
    assert.deepEqual(claims, { uid: 'ghost', role: null, tenantId: null, clientJobIds: [] })
    assert.deepEqual(reads, ['users/ghost'])
  })

  it('leaves the role null when the document exists but has no valid role', async () => {
    stubUsers({ u4: { displayName: 'No Role' }, u5: { role: 'superuser' } })
    assert.equal((await requireAuth(reqFor('u4'))).role, null)
    assert.equal((await requireAuth(reqFor('u5'))).role, null)
  })

  it('fails closed when the users document cannot be read', async () => {
    mock.method(db, 'doc', () => ({
      get: async () => {
        throw new Error('firestore unavailable')
      },
    }))
    await assert.rejects(requireAuth(reqFor('u6')), /firestore unavailable/)
  })
})

describe('requireStaff', () => {
  it('returns the claims for owner and internal tokens', async () => {
    stubUsers()
    assert.equal((await requireStaff(reqFor('o1', { role: 'owner' }))).role, 'owner')
    assert.equal((await requireStaff(reqFor('i1', { role: 'internal' }))).uid, 'i1')
    assert.deepEqual(reads, [])
  })

  it('throws permission-denied for builder and client tokens', async () => {
    stubUsers()
    const msg = 'Staff access required.'
    await assert.rejects(requireStaff(reqFor('b1', { role: 'builder', tenantId: 'qbs' })), denied('permission-denied', msg))
    await assert.rejects(requireStaff(reqFor('c1', { role: 'client' })), denied('permission-denied', msg))
  })

  it('uses the users document when the token has no role', async () => {
    stubUsers({ s1: { role: 'internal' }, s2: { role: 'client' } })
    assert.equal((await requireStaff(reqFor('s1'))).role, 'internal')
    await assert.rejects(requireStaff(reqFor('s2')), denied('permission-denied', 'Staff access required.'))
  })

  it('throws permission-denied for a signed in user with no role anywhere', async () => {
    stubUsers({})
    await assert.rejects(requireStaff(reqFor('nobody')), denied('permission-denied', 'Staff access required.'))
  })

  it('throws unauthenticated, not permission-denied, when signed out', async () => {
    stubUsers()
    await assert.rejects(requireStaff({}), denied('unauthenticated', 'You must be signed in.'))
  })
})

describe('requireOwner', () => {
  it('returns the claims for an owner token', async () => {
    stubUsers()
    const claims = await requireOwner(reqFor('o1', { role: 'owner' }))
    assert.deepEqual(claims, { uid: 'o1', role: 'owner', tenantId: null, clientJobIds: [] })
  })

  it('throws permission-denied for internal, builder and client tokens', async () => {
    stubUsers()
    const msg = 'Owner access required.'
    await assert.rejects(requireOwner(reqFor('i1', { role: 'internal' })), denied('permission-denied', msg))
    await assert.rejects(requireOwner(reqFor('b1', { role: 'builder' })), denied('permission-denied', msg))
    await assert.rejects(requireOwner(reqFor('c1', { role: 'client' })), denied('permission-denied', msg))
  })

  it('uses the users document when the token has no role', async () => {
    stubUsers({ o2: { role: 'owner' }, i2: { role: 'internal' } })
    assert.equal((await requireOwner(reqFor('o2'))).role, 'owner')
    await assert.rejects(requireOwner(reqFor('i2')), denied('permission-denied', 'Owner access required.'))
  })

  it('throws unauthenticated when signed out', async () => {
    stubUsers()
    await assert.rejects(requireOwner({ auth: undefined }), denied('unauthenticated', 'You must be signed in.'))
  })
})
