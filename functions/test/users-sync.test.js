import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { claimsPatchFor } from '../lib/users-sync.js'

const client = (ids, extra = {}) => ({ role: 'client', tenantId: 'p2-core', clientJobIds: ids, ...extra })
const builder = (tenantId = 'qbs') => ({ role: 'builder', tenantId })
const internal = { role: 'internal', tenantId: 'p2-core' }
const owner = { role: 'owner', tenantId: 'p2-core' }

describe('claimsPatchFor: first assignment', () => {
  it('sets claims from the document and never revokes', () => {
    assert.deepEqual(claimsPatchFor(null, client(['QBS-001', 'QBS-002'])), {
      claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001', 'QBS-002'] },
      addJobIds: ['QBS-001', 'QBS-002'],
      removeJobIds: [],
      revoke: false,
    })
  })

  it('gives staff and builders an empty clientJobIds claim and no job changes', () => {
    assert.deepEqual(claimsPatchFor(null, owner), {
      claims: { role: 'owner', tenantId: 'p2-core', clientJobIds: [] },
      addJobIds: [],
      removeJobIds: [],
      revoke: false,
    })
    assert.deepEqual(claimsPatchFor(undefined, builder('vision')), {
      claims: { role: 'builder', tenantId: 'vision', clientJobIds: [] },
      addJobIds: [],
      removeJobIds: [],
      revoke: false,
    })
  })

  it('does not revoke when the document existed before but had no role', () => {
    assert.equal(claimsPatchFor({ displayName: 'Pat' }, internal).revoke, false)
    assert.equal(claimsPatchFor({ role: null }, internal).revoke, false)
    assert.equal(claimsPatchFor({ role: 'superuser' }, internal).revoke, false)
    assert.equal(claimsPatchFor({}, client(['QBS-001'])).revoke, false)
  })
})

describe('claimsPatchFor: role changes', () => {
  it('revokes when an existing role changes', () => {
    const patch = claimsPatchFor(internal, builder())
    assert.equal(patch.revoke, true)
    assert.deepEqual(patch.claims, { role: 'builder', tenantId: 'qbs', clientJobIds: [] })
  })

  it('revokes on every kind of role change', () => {
    const roles = [owner, internal, builder(), client(['QBS-001'])]
    for (const from of roles) {
      for (const to of roles) {
        const expected = from.role !== to.role
        assert.equal(claimsPatchFor(from, to).revoke, expected, `${from.role} to ${to.role}`)
      }
    }
  })

  it('removes a client from every previous job when the role is no longer client', () => {
    const patch = claimsPatchFor(client(['QBS-001', 'QBS-002']), internal)
    assert.deepEqual(patch.removeJobIds, ['QBS-001', 'QBS-002'])
    assert.deepEqual(patch.addJobIds, [])
    assert.deepEqual(patch.claims.clientJobIds, [])
    assert.equal(patch.revoke, true)
  })

  it('adds a new client to every job in the list', () => {
    const patch = claimsPatchFor(internal, client(['QBS-001', 'VIS-002']))
    assert.deepEqual(patch.addJobIds, ['QBS-001', 'VIS-002'])
    assert.deepEqual(patch.removeJobIds, [])
    assert.equal(patch.revoke, true)
  })

  it('treats an invalid role in the new document as no role, which is a change', () => {
    const patch = claimsPatchFor(client(['QBS-001']), { role: 'admin', clientJobIds: ['QBS-001'] })
    assert.equal(patch.claims.role, null)
    assert.equal(patch.revoke, true)
    assert.deepEqual(patch.removeJobIds, ['QBS-001'])
    assert.deepEqual(patch.addJobIds, [])
    assert.deepEqual(patch.claims.clientJobIds, [])
  })

  it('revokes when the role field is removed from the document', () => {
    const patch = claimsPatchFor(internal, { displayName: 'Pat' })
    assert.equal(patch.revoke, true)
    assert.deepEqual(patch.claims, { role: null, tenantId: null, clientJobIds: [] })
  })
})

describe('claimsPatchFor: deleted document', () => {
  it('clears the claims, revokes, and removes the client from all previous jobs', () => {
    assert.deepEqual(claimsPatchFor(client(['QBS-001', 'QBS-002']), null), {
      claims: null,
      addJobIds: [],
      removeJobIds: ['QBS-001', 'QBS-002'],
      revoke: true,
    })
  })

  it('revokes a deleted staff or builder document without job changes', () => {
    for (const before of [owner, internal, builder()]) {
      assert.deepEqual(claimsPatchFor(before, undefined), {
        claims: null,
        addJobIds: [],
        removeJobIds: [],
        revoke: true,
      })
    }
  })

  it('does not revoke when the deleted document never had a role', () => {
    assert.equal(claimsPatchFor({ displayName: 'Pat' }, null).revoke, false)
    assert.equal(claimsPatchFor({ role: 'admin' }, null).revoke, false)
  })

  it('is empty when there was nothing before and nothing after', () => {
    assert.deepEqual(claimsPatchFor(null, null), {
      claims: null,
      addJobIds: [],
      removeJobIds: [],
      revoke: false,
    })
  })
})

describe('claimsPatchFor: edits that keep the role', () => {
  it('produces no job changes and no revoke for an unchanged document', () => {
    const doc = client(['QBS-001', 'QBS-002'])
    assert.deepEqual(claimsPatchFor(doc, { ...doc }), {
      claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001', 'QBS-002'] },
      addJobIds: [],
      removeJobIds: [],
      revoke: false,
    })
  })

  it('ignores edits to fields that are not claims', () => {
    const before = client(['QBS-001'], { displayName: 'Pat' })
    const after = client(['QBS-001'], { displayName: 'Patricia', clientName: 'Lee Homes' })
    const patch = claimsPatchFor(before, after)
    assert.deepEqual(patch.addJobIds, [])
    assert.deepEqual(patch.removeJobIds, [])
    assert.equal(patch.revoke, false)
  })

  it('adds only the new job ids and removes only the dropped ones', () => {
    const patch = claimsPatchFor(client(['QBS-001', 'QBS-002']), client(['QBS-002', 'QBS-003']))
    assert.deepEqual(patch.addJobIds, ['QBS-003'])
    assert.deepEqual(patch.removeJobIds, ['QBS-001'])
    assert.deepEqual(patch.claims.clientJobIds, ['QBS-002', 'QBS-003'])
    assert.equal(patch.revoke, false)
  })

  it('does not treat reordering as a change', () => {
    const patch = claimsPatchFor(client(['QBS-001', 'QBS-002']), client(['QBS-002', 'QBS-001']))
    assert.deepEqual(patch.addJobIds, [])
    assert.deepEqual(patch.removeJobIds, [])
  })

  it('updates the claims but does not revoke when only the tenant changes', () => {
    const patch = claimsPatchFor(builder('qbs'), builder('vision'))
    assert.equal(patch.claims.tenantId, 'vision')
    assert.equal(patch.revoke, false)
    assert.deepEqual(patch.addJobIds, [])
    assert.deepEqual(patch.removeJobIds, [])
  })
})

describe('claimsPatchFor: reading the documents', () => {
  it('takes the role only from the four valid roles', () => {
    for (const role of ['owner', 'internal', 'builder', 'client']) {
      assert.equal(claimsPatchFor(null, { role }).claims.role, role)
    }
    for (const role of [undefined, null, '', 'admin', 'Owner', 42, ['owner']]) {
      assert.equal(claimsPatchFor(null, { role }).claims.role, null)
    }
  })

  it('takes the tenant only when it is a non empty string, else null', () => {
    assert.equal(claimsPatchFor(null, { role: 'builder', tenantId: 'vision' }).claims.tenantId, 'vision')
    for (const tenantId of [undefined, null, '', 7, ['qbs']]) {
      assert.equal(claimsPatchFor(null, { role: 'builder', tenantId }).claims.tenantId, null)
    }
  })

  it('keeps only non empty string job ids, once each, in order', () => {
    const patch = claimsPatchFor(null, client(['QBS-002', 'QBS-001', 'QBS-002', '', 7, null, undefined, {}]))
    assert.deepEqual(patch.claims.clientJobIds, ['QBS-002', 'QBS-001'])
    assert.deepEqual(patch.addJobIds, ['QBS-002', 'QBS-001'])
  })

  it('uses an empty list when clientJobIds is missing or not an array', () => {
    for (const clientJobIds of [undefined, null, 'QBS-001', { 0: 'QBS-001' }, 7]) {
      const patch = claimsPatchFor(null, { role: 'client', tenantId: 'p2-core', clientJobIds })
      assert.deepEqual(patch.claims.clientJobIds, [])
      assert.deepEqual(patch.addJobIds, [])
    }
  })

  it('ignores clientJobIds on any role other than client', () => {
    for (const role of ['owner', 'internal', 'builder']) {
      const patch = claimsPatchFor(null, { role, tenantId: 'qbs', clientJobIds: ['QBS-001'] })
      assert.deepEqual(patch.claims.clientJobIds, [])
      assert.deepEqual(patch.addJobIds, [])
    }
    const demoted = claimsPatchFor({ role: 'builder', clientJobIds: ['QBS-001'] }, internal)
    assert.deepEqual(demoted.removeJobIds, [])
  })

  it('treats a document with no fields as existing with no role, not as deleted', () => {
    assert.deepEqual(claimsPatchFor(null, {}), {
      claims: { role: null, tenantId: null, clientJobIds: [] },
      addJobIds: [],
      removeJobIds: [],
      revoke: false,
    })
  })

  it('treats anything that is not a plain object as a missing document', () => {
    for (const bad of [undefined, null, 'client', 7, true, ['client']]) {
      assert.equal(claimsPatchFor(bad, bad).claims, null)
    }
  })

  it('never shares arrays with its inputs and never modifies them', () => {
    const before = Object.freeze({ role: 'client', clientJobIds: Object.freeze(['QBS-001']) })
    const after = Object.freeze({ role: 'client', clientJobIds: Object.freeze(['QBS-001', 'QBS-002']) })
    const patch = claimsPatchFor(before, after)
    assert.notEqual(patch.claims.clientJobIds, after.clientJobIds)
    assert.deepEqual(after.clientJobIds, ['QBS-001', 'QBS-002'])
    assert.deepEqual(before.clientJobIds, ['QBS-001'])
  })
})
