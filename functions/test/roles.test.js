import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VALID_ROLES, isStaff, isOwner, claimsOf, mergeUserDoc } from '../lib/roles.js'

describe('VALID_ROLES', () => {
  it('lists exactly the four roles', () => {
    assert.deepEqual([...VALID_ROLES], ['owner', 'internal', 'builder', 'client'])
  })
})

describe('isStaff', () => {
  it('is true for owner and internal', () => {
    assert.equal(isStaff({ role: 'owner' }), true)
    assert.equal(isStaff({ role: 'internal' }), true)
  })

  it('is false for builder and client', () => {
    assert.equal(isStaff({ role: 'builder' }), false)
    assert.equal(isStaff({ role: 'client' }), false)
  })

  it('is false for a null role, a missing role, unknown roles and null claims', () => {
    assert.equal(isStaff({ role: null }), false)
    assert.equal(isStaff({}), false)
    assert.equal(isStaff({ role: 'admin' }), false)
    assert.equal(isStaff({ role: 'Owner' }), false)
    assert.equal(isStaff(null), false)
    assert.equal(isStaff(undefined), false)
  })
})

describe('isOwner', () => {
  it('is true only for owner', () => {
    assert.equal(isOwner({ role: 'owner' }), true)
    assert.equal(isOwner({ role: 'internal' }), false)
    assert.equal(isOwner({ role: 'builder' }), false)
    assert.equal(isOwner({ role: 'client' }), false)
    assert.equal(isOwner({ role: null }), false)
    assert.equal(isOwner(null), false)
  })
})

describe('claimsOf', () => {
  it('returns null when there is no auth', () => {
    assert.equal(claimsOf(null), null)
    assert.equal(claimsOf(undefined), null)
  })

  it('maps a callable auth with all claims present', () => {
    const auth = {
      uid: 'u1',
      token: { role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001', 'QBS-002'], email: 'a@b.co' },
    }
    assert.deepEqual(claimsOf(auth), {
      uid: 'u1',
      role: 'client',
      tenantId: 'qbs',
      clientJobIds: ['QBS-001', 'QBS-002'],
    })
  })

  it('maps a token with no custom claims to null role, null tenant and an empty array', () => {
    assert.deepEqual(claimsOf({ uid: 'u2', token: {} }), {
      uid: 'u2',
      role: null,
      tenantId: null,
      clientJobIds: [],
    })
  })

  it('tolerates an auth object with no token', () => {
    assert.deepEqual(claimsOf({ uid: 'u3' }), {
      uid: 'u3',
      role: null,
      tenantId: null,
      clientJobIds: [],
    })
  })

  it('treats explicit null claims as missing', () => {
    const out = claimsOf({ uid: 'u4', token: { role: null, tenantId: null, clientJobIds: null } })
    assert.deepEqual(out, { uid: 'u4', role: null, tenantId: null, clientJobIds: [] })
  })

  it('replaces a clientJobIds claim that is not an array with an empty array', () => {
    assert.deepEqual(claimsOf({ uid: 'u5', token: { clientJobIds: 'QBS-001' } }).clientJobIds, [])
    assert.deepEqual(claimsOf({ uid: 'u5', token: { clientJobIds: { 0: 'QBS-001' } } }).clientJobIds, [])
  })

  it('does not carry over unrelated token fields', () => {
    const out = claimsOf({ uid: 'u6', token: { role: 'owner', email: 'o@p2.co', name: 'Owner' } })
    assert.deepEqual(Object.keys(out).sort(), ['clientJobIds', 'role', 'tenantId', 'uid'])
  })
})

describe('mergeUserDoc', () => {
  const none = { uid: 'u1', role: null, tenantId: null, clientJobIds: [] }

  it('fills role, tenantId and clientJobIds from the document when the claims have none', () => {
    const doc = { role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001'] }
    assert.deepEqual(mergeUserDoc(none, doc), {
      uid: 'u1',
      role: 'client',
      tenantId: 'qbs',
      clientJobIds: ['QBS-001'],
    })
  })

  it('keeps claims values that are present, even when the document disagrees', () => {
    const claims = { uid: 'u1', role: 'builder', tenantId: 'vision', clientJobIds: ['QBS-009'] }
    const doc = { role: 'owner', tenantId: 'qbs', clientJobIds: ['QBS-001'] }
    assert.deepEqual(mergeUserDoc(claims, doc), claims)
  })

  it('fills only the fields that are missing', () => {
    const claims = { uid: 'u1', role: 'builder', tenantId: null, clientJobIds: [] }
    const doc = { role: 'owner', tenantId: 'qbs', clientJobIds: ['QBS-001'] }
    assert.deepEqual(mergeUserDoc(claims, doc), {
      uid: 'u1',
      role: 'builder',
      tenantId: 'qbs',
      clientJobIds: ['QBS-001'],
    })
  })

  it('treats empty strings as missing', () => {
    const claims = { uid: 'u1', role: '', tenantId: '', clientJobIds: [] }
    const out = mergeUserDoc(claims, { role: 'internal', tenantId: 'qbs' })
    assert.equal(out.role, 'internal')
    assert.equal(out.tenantId, 'qbs')
  })

  it('rejects a document role that is not one of the four roles', () => {
    for (const bad of ['admin', 'Owner', 'OWNER', '', 7, null, undefined, ['owner'], { role: 'owner' }]) {
      assert.equal(mergeUserDoc(none, { role: bad }).role, null, `role ${JSON.stringify(bad)}`)
    }
  })

  it('rejects an invalid tenantId in the document', () => {
    for (const bad of ['', 5, null, undefined, ['qbs']]) {
      assert.equal(mergeUserDoc(none, { tenantId: bad }).tenantId, null, `tenantId ${JSON.stringify(bad)}`)
    }
  })

  it('ignores a clientJobIds value in the document that is not an array', () => {
    assert.deepEqual(mergeUserDoc(none, { clientJobIds: 'QBS-001' }).clientJobIds, [])
    assert.deepEqual(mergeUserDoc(none, { clientJobIds: null }).clientJobIds, [])
  })

  it('drops non string entries from the documents clientJobIds', () => {
    const out = mergeUserDoc(none, { clientJobIds: ['QBS-001', 7, null, '', 'QBS-002'] })
    assert.deepEqual(out.clientJobIds, ['QBS-001', 'QBS-002'])
  })

  it('returns the claims unchanged when there is no document', () => {
    assert.deepEqual(mergeUserDoc(none, null), none)
    assert.deepEqual(mergeUserDoc(none, undefined), none)
  })

  it('does not mutate its inputs', () => {
    const claims = { uid: 'u1', role: null, tenantId: null, clientJobIds: [] }
    const doc = { role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001'] }
    const out = mergeUserDoc(claims, doc)
    assert.notEqual(out, claims)
    assert.deepEqual(claims, { uid: 'u1', role: null, tenantId: null, clientJobIds: [] })
    assert.deepEqual(doc, { role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001'] })
    out.clientJobIds.push('QBS-999')
    assert.deepEqual(doc.clientJobIds, ['QBS-001'])
  })

  it('returns null for null claims', () => {
    assert.equal(mergeUserDoc(null, { role: 'owner' }), null)
  })

  it('produces claims that isStaff understands', () => {
    assert.equal(isStaff(mergeUserDoc(none, { role: 'internal' })), true)
    assert.equal(isStaff(mergeUserDoc(none, { role: 'client' })), false)
    assert.equal(isStaff(mergeUserDoc(none, { role: 'admin' })), false)
    assert.equal(isOwner(mergeUserDoc(none, { role: 'owner' })), true)
  })
})
