import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../lib/admin.js'
import { validateNewUser as validateFromLib } from '../lib/users-validate.js'
import { createUser, onUserWritten, validateNewUser } from '../users.js'
import { assertNoDashes } from './helpers/firestore-stub.js'

// Nothing here reaches a network. The Admin Auth instance and the Firestore
// instance are the real singletons with the methods the handlers call replaced,
// so a call the handlers make that is not stubbed fails loudly (no credentials,
// no emulator) instead of quietly succeeding.

const authError = (code) => Object.assign(new Error(`Firebase auth error: ${code}`), { code })

let created, claimed, deleted, revoked, fetched // Auth calls, in order
let writes, removed, queries, batches // Firestore calls, in order
let logged // console.error and console.warn output

// existing: the custom claims the account has now, like { role: 'owner' }; none by default.
// getUserError: what reading the account fails with.
function stubAuth({ uid = 'new-uid', createError, claimsError, deleteError, revokeError, existing, getUserError } = {}) {
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
  mock.method(auth, 'getUser', async (target) => {
    fetched.push(target)
    if (getUserError) throw getUserError
    return { uid: target, customClaims: existing }
  })
}

// jobs: [{ path: 'jobs/a', id: 'QBS-001', clientUids: ['u1'] }]  the job documents that exist
// userDocs: { o2: { role: 'owner' } }                              users documents the request guard may read
// The jobs queries answer the way Firestore does: `id in [...]` and `clientUids array-contains uid`,
// and every document returned carries its own id and clientUids.
function stubFirestore({ jobs = [], userDocs = {}, setError, batchError } = {}) {
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
        const found = jobs.filter((job) => {
          if (name !== 'jobs') return false
          if (field === 'id' && op === 'in') return value.includes(job.id)
          if (field === 'clientUids' && op === 'array-contains') return (job.clientUids ?? []).includes(value)
          return false
        })
        return {
          docs: found.map((job) => ({
            ref: { path: job.path },
            data: () => ({ id: job.id, clientUids: job.clientUids }),
          })),
        }
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
  fetched = []
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
  // `now` is the document as it is when the handler runs. The handler reads it
  // again through the snapshot in the event, so it can differ from what the event
  // says; by default it is the same.
  const snap = (data, ref) => ({ exists: data != null, data: () => data, ref })
  let rereads
  function event(uid, before, after, now = after) {
    const ref = {
      get: async () => {
        rereads += 1
        return snap(now)
      },
    }
    return { params: { uid }, data: { before: snap(before, ref), after: snap(after, ref) } }
  }
  const run = (uid, before, after, now) => onUserWritten.run(event(uid, before, after, now))

  const client = (ids) => ({ role: 'client', tenantId: 'p2-core', clientJobIds: ids })
  const job = (path, id, clientUids = []) => ({ path, id, clientUids })
  const hasOp = (ops, path, change) => ops.some((op) => op.path === path && op.data.clientUids.isEqual(change))
  const idQueries = () => queries.filter((q) => q.field === 'id')
  const linkQueries = () => queries.filter((q) => q.field === 'clientUids')

  beforeEach(() => {
    rereads = 0
  })

  describe('claims', () => {
    it('sets claims from a new document and does not revoke', async () => {
      stubAuth()
      stubFirestore()
      await run('u1', null, { role: 'builder', tenantId: 'qbs', displayName: 'Bo' })
      assert.deepEqual(claimed, [{ uid: 'u1', claims: { role: 'builder', tenantId: 'qbs', clientJobIds: [] } }])
      assert.deepEqual(revoked, [])
      assert.deepEqual(batches, [])
    })

    it('cleans the tenant per role, as createUser does', async () => {
      stubAuth()
      stubFirestore()
      await run('b', null, { role: 'builder', tenantId: 'p2-core' })
      await run('i', null, { role: 'internal', tenantId: 'qbs' })
      await run('c', null, { role: 'client', tenantId: 'vision', clientJobIds: ['QBS-001'] })
      await run('v', null, { role: 'builder', tenantId: 'vision' })
      assert.deepEqual(
        claimed.map((c) => [c.uid, c.claims.tenantId]),
        [['b', null], ['i', 'p2-core'], ['c', 'p2-core'], ['v', 'vision']],
      )
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

    it('sets the claims again but revokes nothing for an unchanged document or a tenant only change', async () => {
      stubAuth()
      stubFirestore()
      await run('u1', client(['QBS-001']), { ...client(['QBS-001']), displayName: 'Renamed' })
      await run('u2', { role: 'builder', tenantId: 'qbs' }, { role: 'builder', tenantId: 'vision' })
      assert.deepEqual(
        claimed.map((c) => [c.uid, c.claims.role, c.claims.tenantId]),
        [['u1', 'client', 'p2-core'], ['u2', 'builder', 'vision']],
      )
      assert.deepEqual(revoked, [])
    })

    it('clears the claims and revokes when the document is deleted', async () => {
      stubAuth()
      stubFirestore()
      await run('u1', client(['QBS-001']), null)
      assert.deepEqual(claimed, [{ uid: 'u1', claims: null }])
      assert.deepEqual(revoked, ['u1'])
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
      assert.deepEqual(claimed[0].claims, { role: null, tenantId: 'p2-core', clientJobIds: [] })
    })
  })

  // Only an owner can write a staff role into a users document, so a document that
  // said owner or internal before the write was set by an owner, and lowering it is
  // how an owner changes a staff role. Any other write (a new document, or one over a
  // document that said builder, client, nothing or a role that does not exist) never
  // lowers an account that is owner or internal now: internal staff can create a
  // client document for an owner whose claims were set by hand, and edit it again
  // later, and neither write may take the owner's role away. The claims write is
  // skipped and the jobs half still runs.
  describe('a write over a document that did not say owner or internal never lowers staff', () => {
    const claimsOf = (role) => ({ role, tenantId: 'p2-core', clientJobIds: [] })
    const warnings = () => logged.filter(([level]) => level === 'warn').map(([, message]) => String(message))

    const LOWERED = [
      ['owner', { role: 'internal', tenantId: 'p2-core' }],
      ['owner', { role: 'builder', tenantId: 'qbs' }],
      ['owner', client(['QBS-001'])],
      ['owner', { displayName: 'No role yet' }],
      ['owner', { role: 'superuser', tenantId: 'qbs' }],
      ['internal', { role: 'builder', tenantId: 'qbs' }],
      ['internal', client(['QBS-001'])],
      ['internal', { tenantId: 'qbs' }],
    ]
    for (const [had, doc] of LOWERED) {
      it(`leaves an account that is ${had} now alone when its new document says ${doc.role ?? 'nothing'}`, async () => {
        stubAuth({ existing: claimsOf(had) })
        stubFirestore()
        await run('u1', null, doc)
        assert.deepEqual(claimed, [])
        assert.deepEqual(revoked, [])
        assert.equal(warnings().length, 1)
      })
    }

    it('names the uid and both roles in the warning, which has no dash', async () => {
      stubAuth({ existing: claimsOf('owner') })
      stubFirestore()
      await run('u1', null, client(['QBS-001']))
      const [warning] = warnings()
      assert.match(warning, /u1/)
      assert.match(warning, /owner/)
      assert.match(warning, /client/)
      assertNoDashes(warning)
    })

    it('says no role when the document has none', async () => {
      stubAuth({ existing: claimsOf('internal') })
      stubFirestore()
      await run('u1', null, { displayName: 'No role yet' })
      assert.match(warnings()[0], /no role/)
    })

    it('still links the jobs of a client document whose claims it leaves alone', async () => {
      stubAuth({ existing: claimsOf('owner') })
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      await run('u1', null, client(['QBS-001']))
      assert.deepEqual(claimed, [])
      assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayUnion('u1')))
    })

    it('does not clear the claims of staff when the document it just created is already gone', async () => {
      stubAuth({ existing: claimsOf('owner') })
      stubFirestore()
      await run('u1', null, { role: 'owner', tenantId: 'p2-core' }, null)
      assert.deepEqual(claimed, [])
      assert.equal(warnings().length, 1)
    })

    const KEPT = [
      ['owner', { role: 'owner', tenantId: 'p2-core' }],
      ['internal', { role: 'internal', tenantId: 'p2-core' }],
      ['internal', { role: 'owner', tenantId: 'p2-core' }],
      ['builder', client(['QBS-001'])],
      ['builder', { role: 'builder', tenantId: 'vision' }],
      ['client', { role: 'internal', tenantId: 'p2-core' }],
      ['superuser', { role: 'builder', tenantId: 'qbs' }],
    ]
    for (const [had, doc] of KEPT) {
      it(`sets the claims when the account is ${had} now and its new document says ${doc.role}`, async () => {
        stubAuth({ existing: claimsOf(had) })
        stubFirestore()
        await run('u1', null, doc)
        assert.equal(claimed.length, 1)
        assert.equal(claimed[0].claims.role, doc.role)
        assert.deepEqual(warnings(), [])
      })
    }

    it('sets the claims when the account has none yet', async () => {
      for (const existing of [undefined, {}, { role: null }, { role: 7 }]) {
        mock.restoreAll()
        mock.method(console, 'warn', (...args) => logged.push(['warn', ...args]))
        claimed = []
        stubAuth({ existing })
        stubFirestore()
        await run('u1', null, { role: 'client', tenantId: 'p2-core', clientJobIds: [] })
        assert.equal(claimed.length, 1, JSON.stringify(existing))
      }
      assert.deepEqual(warnings(), [])
    })

    it('reads the account before it sets any claims', async () => {
      const order = []
      stubAuth()
      stubFirestore()
      const auth = getAuth()
      mock.method(auth, 'getUser', async () => {
        order.push('read')
        return {}
      })
      mock.method(auth, 'setCustomUserClaims', async () => order.push('claims'))
      await run('u1', null, { role: 'builder', tenantId: 'qbs' })
      assert.deepEqual(order, ['read', 'claims'])
    })

    it('treats an account that does not exist as having no claims, and goes on to set them', async () => {
      stubAuth({ getUserError: authError('auth/user-not-found') })
      stubFirestore()
      await run('u1', null, { role: 'builder', tenantId: 'qbs' })
      assert.deepEqual(fetched, ['u1'])
      assert.equal(claimed.length, 1)
      assert.deepEqual(warnings(), [])
    })

    it('logs one warning and does not fail when the account is missing for the read and the write', async () => {
      stubAuth({ getUserError: authError('auth/user-not-found'), claimsError: authError('auth/user-not-found') })
      stubFirestore()
      await run('ghost', null, { role: 'internal' })
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /ghost/)
      assert.ok(!logged.some(([level]) => level === 'error'))
    })

    it('rethrows any other failure to read the account, sets no claims, and still links the jobs', async () => {
      stubAuth({ getUserError: authError('auth/internal-error') })
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      await assert.rejects(run('u1', null, client(['QBS-001'])), /auth\/internal-error/)
      assert.deepEqual(claimed, [])
      assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayUnion('u1')))
    })

    it('leaves an owner alone when internal staff create a client document for them, and again when they edit it', async () => {
      stubAuth({ existing: claimsOf('owner') })
      stubFirestore()
      const created = client(['QBS-001'])
      await run('x', null, created)
      assert.deepEqual(claimed, [])
      assert.equal(warnings().length, 1)

      const edited = { ...created, clientJobIds: ['QBS-001', 'QBS-002'] }
      await run('x', created, edited)
      assert.deepEqual(claimed, [], 'the claims are still the owner ones')
      assert.deepEqual(revoked, [])
      assert.equal(warnings().length, 2)
      assert.match(warnings()[1], /users\/x says client/)
      assert.match(warnings()[1], /already owner/)
      assertNoDashes(warnings()[1])
    })

    for (const before of [{ role: 'builder', tenantId: 'qbs' }, client(['QBS-001']), { displayName: 'No role' }, { role: 'superuser' }]) {
      it(`leaves internal staff alone when a document that said ${before.role ?? 'nothing'} is changed to a lower role`, async () => {
        stubAuth({ existing: claimsOf('internal') })
        stubFirestore()
        await run('u1', before, { role: 'builder', tenantId: 'vision' })
        assert.deepEqual(fetched, ['u1'])
        assert.deepEqual(claimed, [])
        assert.deepEqual(revoked, [])
        assert.equal(warnings().length, 1)
      })
    }

    it('keeps an owner when a client document over their hand set claims is deleted, and says the document is gone', async () => {
      stubAuth({ existing: claimsOf('owner') })
      stubFirestore()
      await run('x', client(['QBS-001']), null)
      assert.deepEqual(claimed, [])
      assert.deepEqual(revoked, [])
      assert.match(warnings()[0], /users\/x is gone/)
      assertNoDashes(warnings()[0])
    })

    // How a staff account whose claims were set by hand is offboarded, as SECURITY.md says: the staff
    // role goes into its users document first, and deleting that document is what takes the claims
    // away. Deleting a document that never said staff leaves the account as it is.
    for (const role of ['owner', 'internal']) {
      it(`offboards a hand set ${role} account in two steps: its role is written into its document, then the document is deleted`, async () => {
        stubAuth({ existing: claimsOf(role) })
        stubFirestore()

        await run('x', client(['QBS-001']), null)
        assert.deepEqual([claimed, revoked], [[], []], 'a deletion over a document that never said staff keeps the claims')
        assert.match(warnings()[0], /users\/x is gone/)

        await run('x', null, { role, tenantId: 'p2-core' })
        assert.deepEqual(claimed, [{ uid: 'x', claims: claimsOf(role) }], 'writing the staff role in sets the claims it already has')
        assert.deepEqual(revoked, [], 'and signs nobody out')

        fetched.length = 0
        await run('x', { role, tenantId: 'p2-core' }, null)
        assert.deepEqual(claimed.at(-1), { uid: 'x', claims: null }, 'deleting that document clears the claims')
        assert.deepEqual(revoked, ['x'], 'and revokes the refresh tokens')
        assert.deepEqual(fetched, [], 'without reading the account, since a deletion over a staff document is an owner\'s')
      })
    }

    it('lowers the claims when an owner changes a document that said internal to client, without reading the account', async () => {
      stubAuth({ existing: claimsOf('internal') })
      stubFirestore()
      await run('x', { role: 'internal', tenantId: 'p2-core' }, client(['QBS-001']))
      assert.deepEqual(claimed, [{ uid: 'x', claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } }])
      assert.deepEqual(revoked, ['x'])
      assert.deepEqual(fetched, [])
      assert.deepEqual(warnings(), [])
    })

    it('reads the account only when the document did not say owner or internal before the write', async () => {
      stubAuth({ existing: claimsOf('owner') })
      stubFirestore()
      await run('u1', { role: 'internal' }, { role: 'client', clientJobIds: [] })
      await run('u2', { role: 'owner', tenantId: 'p2-core' }, null)
      assert.deepEqual(fetched, [])
      assert.equal(claimed.length, 2, 'an owner editing or deleting a staff document is how a staff role is changed, so it is applied')

      await run('u3', client(['QBS-001']), client(['QBS-001']))
      await run('u4', null, { role: 'builder', tenantId: 'qbs' })
      assert.deepEqual(fetched, ['u3', 'u4'])
    })
  })

  describe('reading the document as it is now', () => {
    it('reads the document once, through the snapshot in the event', async () => {
      stubAuth()
      stubFirestore()
      await run('u1', null, client(['QBS-001']))
      assert.equal(rereads, 1)
    })

    it('uses the document as it is now, not as the event says', async () => {
      // This event is for the write that made the user an owner. A later write has
      // since made them a client of one job.
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      await run('u1', { role: 'internal' }, { role: 'owner', tenantId: 'p2-core' }, client(['QBS-001']))
      assert.deepEqual(claimed, [
        { uid: 'u1', claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } },
      ])
      assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayUnion('u1')))
    })

    it('lets a late event for an older write leave the latest role in place', async () => {
      // Writes: internal to builder (event 1), then builder to client (event 2).
      // Event 2 is handled first and event 1 arrives after it.
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      const builderDoc = { role: 'builder', tenantId: 'qbs' }
      await run('u1', builderDoc, client(['QBS-001']), client(['QBS-001']))
      await run('u1', { role: 'internal' }, builderDoc, client(['QBS-001']))
      assert.deepEqual(
        claimed.map((c) => c.claims.role),
        ['client', 'client'],
      )
      assert.ok(claimed.every((c) => c.claims.clientJobIds.join() === 'QBS-001'))
    })

    it('treats a document that is gone now as deleted, even though the event says it exists', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['u1'])] })
      await run('u1', { role: 'internal' }, { role: 'internal' }, null)
      assert.deepEqual(claimed, [{ uid: 'u1', claims: null }])
      assert.deepEqual(revoked, ['u1'])
      assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayRemove('u1')))
    })

    it('does not clear anything for a deletion event when the document exists again', async () => {
      stubAuth()
      stubFirestore()
      await run('u1', client(['QBS-001']), null, { role: 'internal', tenantId: 'p2-core' })
      assert.deepEqual(claimed, [{ uid: 'u1', claims: { role: 'internal', tenantId: 'p2-core', clientJobIds: [] } }])
      assert.deepEqual(revoked, ['u1'], 'the role changed from client to internal')
    })

    it('keeps the revoke rule: never on first assignment, whatever the document says now', async () => {
      stubAuth()
      stubFirestore()
      await run('u1', null, { role: 'internal' }, { role: 'owner', tenantId: 'p2-core' })
      await run('u2', { displayName: 'No role yet' }, { role: 'internal' }, { role: 'client', clientJobIds: [] })
      assert.deepEqual(revoked, [])
    })

    it('changes nothing when the document cannot be read, and the event fails', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      const failing = event('u1', null, client(['QBS-001']))
      failing.data.after.ref.get = async () => {
        throw new Error('read failed')
      }
      await assert.rejects(onUserWritten.run(failing), /read failed/)
      assert.deepEqual([claimed, revoked, queries, batches], [[], [], [], []])
    })
  })

  describe('job links', () => {
    it('links a new client to every job whose id they list', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001'), job('jobs/b', 'QBS-002'), job('jobs/c', 'QBS-003')] })
      await run('u1', null, client(['QBS-001', 'QBS-002']))
      assert.deepEqual(idQueries(), [{ collection: 'jobs', field: 'id', op: 'in', value: ['QBS-001', 'QBS-002'] }])
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
        idQueries().map((q) => q.value.length),
        [10, 10, 3],
      )
      assert.deepEqual(idQueries().flatMap((q) => q.value), ids)
      assert.ok(idQueries().every((q) => q.op === 'in'))
    })

    it('adds only the missing links and removes only the stale ones', async () => {
      stubAuth()
      stubFirestore({
        jobs: [
          job('jobs/a', 'QBS-001', ['u1']),
          job('jobs/b', 'QBS-002', ['u1', 'u2']),
          job('jobs/c', 'QBS-003', ['u2']),
        ],
      })
      await run('u1', client(['QBS-001', 'QBS-002']), client(['QBS-002', 'QBS-003']))
      const ops = batches.flat()
      assert.equal(ops.length, 2)
      assert.ok(hasOp(ops, 'jobs/c', FieldValue.arrayUnion('u1')))
      assert.ok(hasOp(ops, 'jobs/a', FieldValue.arrayRemove('u1')))
      assert.deepEqual(revoked, [])
    })

    it('writes no job at all when every listed job already links the user', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['u1']), job('jobs/b', 'QBS-002', ['u1'])] })
      await run('u1', client(['QBS-001', 'QBS-002']), { ...client(['QBS-001', 'QBS-002']), displayName: 'Renamed' })
      assert.deepEqual(batches, [])
      assert.equal(idQueries().length, 1)
      assert.equal(linkQueries().length, 1)
    })

    it('links every listed job even when the document did not change, so a missed link is put right', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['u1']), job('jobs/b', 'QBS-002', ['u9'])] })
      await run('u1', client(['QBS-001', 'QBS-002']), client(['QBS-001', 'QBS-002']))
      const ops = batches.flat()
      assert.equal(ops.length, 1)
      assert.ok(hasOp(ops, 'jobs/b', FieldValue.arrayUnion('u1')))
    })

    it('links a job that was created after its client the next time the document is written', async () => {
      stubAuth()
      stubFirestore({ jobs: [] })
      await run('u1', null, client(['QBS-050']))
      assert.deepEqual(batches, [])
      mock.restoreAll()
      stubAuth()
      stubFirestore({ jobs: [job('jobs/new', 'QBS-050')] })
      await run('u1', client(['QBS-050']), client(['QBS-050']))
      assert.ok(hasOp(batches.flat(), 'jobs/new', FieldValue.arrayUnion('u1')))
    })

    it('ignores listed ids that no job has', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      await run('u1', null, client(['QBS-001', 'QBS-404']))
      assert.equal(batches.flat().length, 1)
    })

    it('unlinks a job that lists the user but is no longer in their list, whatever the old document said', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['u1']), job('jobs/z', 'QBS-777', ['u1', 'u2'])] })
      await run('u1', client(['QBS-001']), client(['QBS-001']))
      const ops = batches.flat()
      assert.equal(ops.length, 1)
      assert.ok(hasOp(ops, 'jobs/z', FieldValue.arrayRemove('u1')))
    })

    it('unlinks the user from every job when their role stops being client', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['u1']), job('jobs/b', 'QBS-002', ['u1'])] })
      await run('u1', client(['QBS-001', 'QBS-002']), { role: 'internal', tenantId: 'p2-core' })
      assert.deepEqual(idQueries(), [], 'no job is wanted, so there is nothing to look up by id')
      const ops = batches.flat()
      assert.deepEqual(ops.map((op) => op.path).sort(), ['jobs/a', 'jobs/b'])
      assert.ok(ops.every((op) => op.data.clientUids.isEqual(FieldValue.arrayRemove('u1'))))
      assert.deepEqual(revoked, ['u1'])
    })

    it('unlinks the user from every job that lists them when the document is deleted', async () => {
      stubAuth()
      stubFirestore({
        jobs: [job('jobs/a', 'QBS-001', ['u1']), job('jobs/z', 'QBS-777', ['u1']), job('jobs/o', 'QBS-002', ['u2'])],
      })
      await run('u1', client(['QBS-001']), null)
      const ops = batches.flat()
      assert.deepEqual(ops.map((op) => op.path).sort(), ['jobs/a', 'jobs/z'], 'each job once, and not the one for u2')
      assert.ok(ops.every((op) => op.data.clientUids.isEqual(FieldValue.arrayRemove('u1'))))
    })

    it('only looks for stale links for staff and builders, and writes nothing when there are none', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['someone'])] })
      await run('u1', null, { role: 'internal', tenantId: 'p2-core' })
      await run('u2', null, { role: 'builder', tenantId: 'qbs' })
      assert.deepEqual(idQueries(), [])
      assert.equal(linkQueries().length, 2)
      assert.deepEqual(batches, [])
    })

    it('splits a very large set of job updates into several batches', async () => {
      const jobs = []
      const ids = Array.from({ length: 450 }, (_, i) => `QBS-${String(i + 100).padStart(3, '0')}`)
      ids.forEach((id, i) => jobs.push(job(`jobs/j${i}`, id)))
      stubAuth()
      stubFirestore({ jobs })
      await run('u1', null, client(ids))
      assert.ok(batches.length >= 2, 'more than one batch')
      assert.ok(batches.every((ops) => ops.length <= 400), 'no batch is over 400 writes')
      assert.equal(batches.flat().length, 450)
    })
  })

  describe('failures', () => {
    it('logs a warning and finishes without throwing when there is no Auth account for the uid', async () => {
      stubAuth({ claimsError: authError('auth/user-not-found') })
      stubFirestore()
      await run('ghost', null, { role: 'internal' })
      assert.ok(logged.some(([level, message]) => level === 'warn' && String(message).includes('ghost')))
      assert.ok(!logged.some(([level]) => level === 'error'))
    })

    it('does not revoke after a user-not-found, and still unlinks a deleted client from their jobs', async () => {
      stubAuth({ claimsError: authError('auth/user-not-found') })
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001', ['ghost'])] })
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
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')] })
      await assert.rejects(run('u1', null, client(['QBS-001'])), /auth\/internal-error/)
      assert.ok(hasOp(batches.flat(), 'jobs/a', FieldValue.arrayUnion('u1')))
    })

    it('rethrows a Firestore error, after still setting the claims', async () => {
      stubAuth()
      stubFirestore({ jobs: [job('jobs/a', 'QBS-001')], batchError: new Error('commit failed') })
      await assert.rejects(run('u1', null, client(['QBS-001'])), /commit failed/)
      assert.equal(claimed.length, 1)
    })

    it('does nothing when the event carries no data', async () => {
      stubAuth()
      stubFirestore()
      await onUserWritten.run({ params: { uid: 'u1' }, data: undefined })
      assert.deepEqual([claimed, revoked, queries, batches], [[], [], [], []])
      assert.equal(rereads, 0)
    })
  })
})
