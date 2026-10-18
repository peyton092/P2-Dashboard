import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { claimsPatchFor, jobLinkChanges } from '../lib/users-sync.js'
import { validateNewUser } from '../lib/users-validate.js'

const client = (ids, extra = {}) => ({ role: 'client', tenantId: 'p2-core', clientJobIds: ids, ...extra })
const builder = (tenantId = 'qbs') => ({ role: 'builder', tenantId })
const internal = { role: 'internal', tenantId: 'p2-core' }
const owner = { role: 'owner', tenantId: 'p2-core' }

describe('claimsPatchFor: first assignment', () => {
  it('sets claims from the document and never revokes', () => {
    assert.deepEqual(claimsPatchFor(null, client(['QBS-001', 'QBS-002'])), {
      claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001', 'QBS-002'] },
      jobIds: ['QBS-001', 'QBS-002'],
      revoke: false,
    })
  })

  it('gives staff and builders an empty clientJobIds claim and no jobs', () => {
    assert.deepEqual(claimsPatchFor(null, owner), {
      claims: { role: 'owner', tenantId: 'p2-core', clientJobIds: [] },
      jobIds: [],
      revoke: false,
    })
    assert.deepEqual(claimsPatchFor(undefined, builder('vision')), {
      claims: { role: 'builder', tenantId: 'vision', clientJobIds: [] },
      jobIds: [],
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

  it('wants no jobs once the role is no longer client', () => {
    const patch = claimsPatchFor(client(['QBS-001', 'QBS-002']), internal)
    assert.deepEqual(patch.jobIds, [])
    assert.deepEqual(patch.claims.clientJobIds, [])
    assert.equal(patch.revoke, true)
  })

  it('wants every listed job when someone becomes a client', () => {
    const patch = claimsPatchFor(internal, client(['QBS-001', 'VIS-002']))
    assert.deepEqual(patch.jobIds, ['QBS-001', 'VIS-002'])
    assert.equal(patch.revoke, true)
  })

  it('treats an invalid role in the new document as no role, which is a change', () => {
    const patch = claimsPatchFor(client(['QBS-001']), { role: 'admin', clientJobIds: ['QBS-001'] })
    assert.equal(patch.claims.role, null)
    assert.equal(patch.revoke, true)
    assert.deepEqual(patch.jobIds, [])
    assert.deepEqual(patch.claims.clientJobIds, [])
  })

  it('revokes when the role field is removed from the document', () => {
    const patch = claimsPatchFor(internal, { displayName: 'Pat' })
    assert.equal(patch.revoke, true)
    assert.deepEqual(patch.claims, { role: null, tenantId: 'p2-core', clientJobIds: [] })
  })
})

describe('claimsPatchFor: deleted document', () => {
  it('clears the claims, revokes, and wants no jobs', () => {
    assert.deepEqual(claimsPatchFor(client(['QBS-001', 'QBS-002']), null), {
      claims: null,
      jobIds: [],
      revoke: true,
    })
  })

  it('revokes a deleted staff or builder document', () => {
    for (const before of [owner, internal, builder()]) {
      assert.deepEqual(claimsPatchFor(before, undefined), { claims: null, jobIds: [], revoke: true })
    }
  })

  it('does not revoke when the deleted document never had a role', () => {
    assert.equal(claimsPatchFor({ displayName: 'Pat' }, null).revoke, false)
    assert.equal(claimsPatchFor({ role: 'admin' }, null).revoke, false)
  })

  it('is empty when there was nothing before and nothing after', () => {
    assert.deepEqual(claimsPatchFor(null, null), { claims: null, jobIds: [], revoke: false })
  })
})

describe('claimsPatchFor: edits that keep the role', () => {
  it('wants every listed job and does not revoke for an unchanged document', () => {
    const doc = client(['QBS-001', 'QBS-002'])
    assert.deepEqual(claimsPatchFor(doc, { ...doc }), {
      claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001', 'QBS-002'] },
      jobIds: ['QBS-001', 'QBS-002'],
      revoke: false,
    })
  })

  it('ignores edits to fields that are not claims', () => {
    const before = client(['QBS-001'], { displayName: 'Pat' })
    const after = client(['QBS-001'], { displayName: 'Patricia', clientName: 'Lee Homes' })
    const patch = claimsPatchFor(before, after)
    assert.deepEqual(patch.jobIds, ['QBS-001'])
    assert.equal(patch.revoke, false)
  })

  it('wants the whole new list, however the list changed', () => {
    const patch = claimsPatchFor(client(['QBS-001', 'QBS-002']), client(['QBS-002', 'QBS-003']))
    assert.deepEqual(patch.jobIds, ['QBS-002', 'QBS-003'])
    assert.deepEqual(patch.claims.clientJobIds, ['QBS-002', 'QBS-003'])
    assert.equal(patch.revoke, false)
  })

  it('depends only on the new document, not on what the old one listed', () => {
    const now = client(['QBS-005'])
    for (const before of [null, {}, internal, client(['QBS-001']), client(['QBS-005']), builder()]) {
      assert.deepEqual(claimsPatchFor(before, now).jobIds, ['QBS-005'])
      assert.deepEqual(claimsPatchFor(before, now).claims, {
        role: 'client',
        tenantId: 'p2-core',
        clientJobIds: ['QBS-005'],
      })
    }
  })

  it('updates the claims but does not revoke when only the tenant changes', () => {
    const patch = claimsPatchFor(builder('qbs'), builder('vision'))
    assert.equal(patch.claims.tenantId, 'vision')
    assert.equal(patch.revoke, false)
    assert.deepEqual(patch.jobIds, [])
  })
})

describe('claimsPatchFor: tenant', () => {
  it('keeps qbs or vision for a builder', () => {
    assert.equal(claimsPatchFor(null, builder('qbs')).claims.tenantId, 'qbs')
    assert.equal(claimsPatchFor(null, builder('vision')).claims.tenantId, 'vision')
  })

  it('gives a builder with a missing or invalid tenant no tenant, not a default one', () => {
    for (const tenantId of [undefined, null, '', 'p2-core', 'acme', 'QBS', ' qbs', 42, ['qbs']]) {
      assert.equal(claimsPatchFor(null, { role: 'builder', tenantId }).claims.tenantId, null, String(tenantId))
    }
    assert.equal(claimsPatchFor(null, { role: 'builder' }).claims.tenantId, null)
  })

  it('puts owner, internal and client in p2-core whatever tenant is stored', () => {
    for (const role of ['owner', 'internal', 'client']) {
      for (const tenantId of ['qbs', 'vision', 'acme', '', null, undefined, 7]) {
        const doc = { role, tenantId, clientJobIds: ['QBS-001'] }
        assert.equal(claimsPatchFor(null, doc).claims.tenantId, 'p2-core', `${role} ${tenantId}`)
      }
    }
  })

  it('puts a document with no valid role in p2-core', () => {
    for (const role of [undefined, null, 'admin', 'Builder']) {
      assert.equal(claimsPatchFor(null, { role, tenantId: 'qbs' }).claims.tenantId, 'p2-core')
    }
  })

  it('cleans the tenant exactly as createUser does for every role and value', () => {
    const roles = ['owner', 'internal', 'builder', 'client']
    const tenants = ['qbs', 'vision', 'p2-core', 'acme', '', null, undefined, 7, ['qbs']]
    for (const role of roles) {
      for (const tenantId of tenants) {
        const created = validateNewUser({ email: 'a@b.co', role, tenantId, clientJobIds: ['QBS-001'] })
        const synced = claimsPatchFor(null, { role, tenantId, clientJobIds: ['QBS-001'] }).claims.tenantId
        if (created.ok) assert.equal(synced, created.value.tenantId, `${role} ${String(tenantId)}`)
        else assert.equal(synced, null, `${role} ${String(tenantId)} is rejected by createUser, so no tenant`)
      }
    }
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

  it('keeps only non empty string job ids, once each, in order', () => {
    const patch = claimsPatchFor(null, client(['QBS-002', 'QBS-001', 'QBS-002', '', 7, null, undefined, {}]))
    assert.deepEqual(patch.claims.clientJobIds, ['QBS-002', 'QBS-001'])
    assert.deepEqual(patch.jobIds, ['QBS-002', 'QBS-001'])
  })

  it('uses an empty list when clientJobIds is missing or not an array', () => {
    for (const clientJobIds of [undefined, null, 'QBS-001', { 0: 'QBS-001' }, 7]) {
      const patch = claimsPatchFor(null, { role: 'client', tenantId: 'p2-core', clientJobIds })
      assert.deepEqual(patch.claims.clientJobIds, [])
      assert.deepEqual(patch.jobIds, [])
    }
  })

  it('ignores clientJobIds on any role other than client', () => {
    for (const role of ['owner', 'internal', 'builder']) {
      const patch = claimsPatchFor(null, { role, tenantId: 'qbs', clientJobIds: ['QBS-001'] })
      assert.deepEqual(patch.claims.clientJobIds, [])
      assert.deepEqual(patch.jobIds, [])
    }
  })

  it('treats a document with no fields as existing with no role, not as deleted', () => {
    assert.deepEqual(claimsPatchFor(null, {}), {
      claims: { role: null, tenantId: 'p2-core', clientJobIds: [] },
      jobIds: [],
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
    assert.notEqual(patch.jobIds, after.clientJobIds)
    assert.notEqual(patch.jobIds, patch.claims.clientJobIds)
    assert.deepEqual(after.clientJobIds, ['QBS-001', 'QBS-002'])
    assert.deepEqual(before.clientJobIds, ['QBS-001'])
  })
})

describe('jobLinkChanges', () => {
  // A job as the trigger sees it: the document path, its `id` field and its clientUids.
  const job = (path, id, clientUids = []) => ({ path, id, clientUids })

  it('links the user to a wanted job that does not list them', () => {
    const a = job('jobs/a', 'QBS-001')
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001'], [a], []), { add: [a], remove: [] })
  })

  it('leaves a wanted job that already lists the user alone', () => {
    const a = job('jobs/a', 'QBS-001', ['u2', 'u1'])
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001'], [a], [a]), { add: [], remove: [] })
  })

  it('links every wanted job that is missing the user, even when nothing about the user changed', () => {
    const listed = job('jobs/a', 'QBS-001', ['u1'])
    const missing = job('jobs/b', 'QBS-002', ['u9'])
    const bare = job('jobs/c', 'QBS-003')
    const result = jobLinkChanges('u1', ['QBS-001', 'QBS-002', 'QBS-003'], [listed, missing, bare], [listed])
    assert.deepEqual(result, { add: [missing, bare], remove: [] })
  })

  it('unlinks the user from a job that lists them but is no longer wanted', () => {
    const kept = job('jobs/a', 'QBS-001', ['u1'])
    const stale = job('jobs/b', 'QBS-002', ['u1', 'u2'])
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001'], [kept], [kept, stale]), { add: [], remove: [stale] })
  })

  it('unlinks the user from every job when no job is wanted (not a client, or deleted)', () => {
    const a = job('jobs/a', 'QBS-001', ['u1'])
    const b = job('jobs/b', 'QBS-002', ['u1'])
    assert.deepEqual(jobLinkChanges('u1', [], [], [a, b]), { add: [], remove: [a, b] })
  })

  it('does not unlink a job that turns out not to list the user', () => {
    const elsewhere = job('jobs/o', 'QBS-002', ['u9'])
    const bare = { path: 'jobs/p', id: 'QBS-003' }
    assert.deepEqual(jobLinkChanges('u1', [], [], [elsewhere, bare]), { add: [], remove: [] })
  })

  it('does nothing when no job is wanted and none lists the user', () => {
    assert.deepEqual(jobLinkChanges('u1', [], [], []), { add: [], remove: [] })
  })

  it('unlinks a job whose id is missing, since it cannot be a wanted one', () => {
    const odd = { path: 'jobs/x', clientUids: ['u1'] }
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001'], [], [odd]), { add: [], remove: [odd] })
  })

  it('treats a missing or non array clientUids as listing nobody', () => {
    const noField = { path: 'jobs/a', id: 'QBS-001' }
    const wrongType = { path: 'jobs/b', id: 'QBS-002', clientUids: 'u1' }
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001', 'QBS-002'], [noField, wrongType], []), {
      add: [noField, wrongType],
      remove: [],
    })
  })

  it('ignores a wanted entry whose id is not one of the wanted ids', () => {
    const other = job('jobs/z', 'QBS-099')
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001'], [other], []), { add: [], remove: [] })
  })

  it('lists each job once, even when it is passed twice', () => {
    const a = job('jobs/a', 'QBS-001')
    const s = job('jobs/s', 'QBS-002', ['u1'])
    assert.deepEqual(jobLinkChanges('u1', ['QBS-001'], [a, { ...a }], [s, { ...s }]), { add: [a], remove: [s] })
  })

  it('never adds and removes the same job, and never modifies its inputs', () => {
    const jobs = Object.freeze([
      Object.freeze(job('jobs/a', 'QBS-001', Object.freeze(['u1']))),
      Object.freeze(job('jobs/b', 'QBS-002', Object.freeze([]))),
    ])
    const ids = Object.freeze(['QBS-002'])
    const result = jobLinkChanges('u1', ids, jobs, jobs)
    assert.deepEqual(result.add.map((j) => j.path), ['jobs/b'])
    assert.deepEqual(result.remove.map((j) => j.path), ['jobs/a'])
  })
})
