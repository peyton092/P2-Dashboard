import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { getAuth } from 'firebase-admin/auth'
import '../lib/admin.js'
import { currentClaimRole } from '../lib/auth-claims.js'

// Nothing here reaches a network: getUser on the real Auth instance is replaced.
const authError = (code) => Object.assign(new Error(`Firebase auth error: ${code}`), { code })

let asked
function stubGetUser(answer) {
  mock.method(getAuth(), 'getUser', async (uid) => {
    asked.push(uid)
    if (answer instanceof Error) throw answer
    return answer
  })
}

beforeEach(() => {
  asked = []
})

afterEach(() => {
  mock.restoreAll()
})

describe('currentClaimRole', () => {
  it('is the role in the custom claims of the account, which it asks for by uid', async () => {
    stubGetUser({ uid: 'u1', customClaims: { role: 'owner', tenantId: 'p2-core', clientJobIds: [] } })
    assert.equal(await currentClaimRole('u1'), 'owner')
    assert.deepEqual(asked, ['u1'])
  })

  it('gives each of the four roles back as it is', async () => {
    for (const role of ['owner', 'internal', 'builder', 'client']) {
      mock.restoreAll()
      stubGetUser({ customClaims: { role } })
      assert.equal(await currentClaimRole('u1'), role)
    }
  })

  it('is null for an account with no custom claims at all', async () => {
    stubGetUser({ uid: 'u1' })
    assert.equal(await currentClaimRole('u1'), null)
  })

  it('is null when the claims hold no role, or a role that is not a string', async () => {
    for (const customClaims of [{}, { role: null }, { role: undefined }, { role: 7 }, { role: ['owner'] }, { role: { name: 'owner' } }, { tenantId: 'qbs' }]) {
      mock.restoreAll()
      stubGetUser({ customClaims })
      assert.equal(await currentClaimRole('u1'), null, JSON.stringify(customClaims))
    }
  })

  it('is null for an account that does not exist, as that has no claims', async () => {
    stubGetUser(authError('auth/user-not-found'))
    assert.equal(await currentClaimRole('ghost'), null)
  })

  it('throws any other failure, so a caller protecting a role does not guess one', async () => {
    stubGetUser(authError('auth/internal-error'))
    await assert.rejects(currentClaimRole('u1'), /auth\/internal-error/)
    mock.restoreAll()
    stubGetUser(new Error('network down'))
    await assert.rejects(currentClaimRole('u1'), /network down/)
  })
})
