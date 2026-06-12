import { describe, it, expect } from 'vitest'
import { buildCallerScope, ownsRecordOnServer, actorStamp } from './scope.js'

// ── buildCallerScope ──────────────────────────────────────────────────────────

describe('buildCallerScope', () => {
  it('derives role from the custom claim when present', () => {
    const scope = buildCallerScope({
      auth: { uid: 'u1', token: { role: 'owner', email: 'jesse@p2.test' } },
      userData: { role: 'client' /* should be ignored — claim wins */ },
    })
    expect(scope.role).toBe('owner')
    expect(scope.isStaff).toBe(true)
  })

  it('falls back to the users-doc role when the claim is missing', () => {
    const scope = buildCallerScope({
      auth: { uid: 'u2', token: {} },
      userData: { role: 'builder', tenantId: 'qbs' },
    })
    expect(scope.role).toBe('builder')
    expect(scope.tenantId).toBe('qbs')
    expect(scope.isStaff).toBe(false)
  })

  it('marks owner and internal as staff, nothing else', () => {
    expect(buildCallerScope({ auth: { token: { role: 'owner'    } } }).isStaff).toBe(true)
    expect(buildCallerScope({ auth: { token: { role: 'internal' } } }).isStaff).toBe(true)
    expect(buildCallerScope({ auth: { token: { role: 'builder'  } } }).isStaff).toBe(false)
    expect(buildCallerScope({ auth: { token: { role: 'client'   } } }).isStaff).toBe(false)
    expect(buildCallerScope({ auth: { token: {}                  } }).isStaff).toBe(false)
  })

  it('falls back to display name from users doc when claim has none', () => {
    const scope = buildCallerScope({
      auth: { uid: 'u3', token: {} },
      userData: { name: 'Mike Rodriguez' },
    })
    expect(scope.displayName).toBe('Mike Rodriguez')
  })

  it('prefers `name` over `displayName` in the users doc', () => {
    const scope = buildCallerScope({
      auth: { token: {} },
      userData: { name: 'preferred', displayName: 'legacy' },
    })
    expect(scope.displayName).toBe('preferred')
  })

  it('falls through to email when neither display name field is set', () => {
    const scope = buildCallerScope({
      auth: { token: { email: 'someone@p2.test' } },
      userData: {},
    })
    expect(scope.email).toBe('someone@p2.test')
    expect(scope.displayName).toBeNull()
  })

  it('coerces a missing clientJobIds to an empty array', () => {
    expect(buildCallerScope({ auth: { token: {} }, userData: {}              }).clientJobIds).toEqual([])
    expect(buildCallerScope({ auth: { token: {} }, userData: { clientJobIds: null } }).clientJobIds).toEqual([])
    expect(buildCallerScope({ auth: { token: {} }, userData: { clientJobIds: 'oops' } }).clientJobIds).toEqual([])
  })

  it('preserves a clientJobIds array', () => {
    const scope = buildCallerScope({
      auth: { uid: 'u4', token: { role: 'client' } },
      userData: { clientJobIds: ['QBS-001', 'QBS-002'] },
    })
    expect(scope.clientJobIds).toEqual(['QBS-001', 'QBS-002'])
  })

  it('returns null fields for an empty / missing auth payload', () => {
    const scope = buildCallerScope({})
    expect(scope.uid).toBeNull()
    expect(scope.email).toBeNull()
    expect(scope.tenantId).toBeNull()
    expect(scope.role).toBeNull()
    expect(scope.isStaff).toBe(false)
    expect(scope.clientJobIds).toEqual([])
  })
})

// ── ownsRecordOnServer ────────────────────────────────────────────────────────

const staff   = { isStaff: true,  uid: 'staff-1', tenantId: null }
const builder = { isStaff: false, uid: 'b-1',    tenantId: 'qbs' }
const client  = { isStaff: false, uid: 'c-1',    tenantId: null }

describe('ownsRecordOnServer', () => {
  it('staff own everything', () => {
    expect(ownsRecordOnServer(staff, { tenantId: 'vision' })).toBe(true)
    expect(ownsRecordOnServer(staff, { tenantId: 'qbs', clientUids: ['other'] })).toBe(true)
    expect(ownsRecordOnServer(staff, {})).toBe(true)
  })

  it('a tenant member owns docs in their own tenant', () => {
    expect(ownsRecordOnServer(builder, { tenantId: 'qbs' })).toBe(true)
  })

  it('a tenant member does NOT own docs in another tenant', () => {
    expect(ownsRecordOnServer(builder, { tenantId: 'vision' })).toBe(false)
  })

  it('a client owns a doc when their uid is in clientUids', () => {
    expect(ownsRecordOnServer(client, { clientUids: ['c-1', 'c-2'] })).toBe(true)
  })

  it('a client does NOT own a doc with a different clientUids list', () => {
    expect(ownsRecordOnServer(client, { clientUids: ['c-2'] })).toBe(false)
  })

  it('does NOT fall back to allow when neither field is set (closes the legacy escape)', () => {
    // firestore.rules has a legacy fallback for pre-backfill docs; server-side
    // we always have a doc to inspect so the fallback is unnecessary and
    // explicitly absent — this test pins that.
    expect(ownsRecordOnServer(builder, {})).toBe(false)
    expect(ownsRecordOnServer(client,  {})).toBe(false)
  })

  it('a tenant member with a null tenantId never matches', () => {
    const noTenant = { isStaff: false, uid: 'x', tenantId: null }
    expect(ownsRecordOnServer(noTenant, { tenantId: 'qbs' })).toBe(false)
  })

  it('ignores a clientUids value that is not an array', () => {
    expect(ownsRecordOnServer(client, { clientUids: 'c-1' })).toBe(false)
    expect(ownsRecordOnServer(client, { clientUids: { 'c-1': true } })).toBe(false)
  })

  it('returns false for missing / null inputs rather than throwing', () => {
    expect(ownsRecordOnServer(null, { tenantId: 'qbs' })).toBe(false)
    expect(ownsRecordOnServer(builder, null)).toBe(false)
    expect(ownsRecordOnServer(builder, undefined)).toBe(false)
  })
})

// ── actorStamp ────────────────────────────────────────────────────────────────

describe('actorStamp', () => {
  it('prefers displayName for the actor label', () => {
    const stamp = actorStamp({
      uid: 'u1', email: 'a@p2.test', displayName: 'Mike Rodriguez', role: 'internal',
    })
    expect(stamp).toEqual({
      actor: 'Mike Rodriguez',
      actorUid: 'u1',
      actorRole: 'internal',
      actorEmail: 'a@p2.test',
    })
  })

  it("falls back to email when there's no display name", () => {
    expect(actorStamp({ uid: 'u', email: 'e@p2.test', displayName: null, role: 'client' }).actor).toBe('e@p2.test')
  })

  it("falls back to 'User' when both display name and email are missing", () => {
    expect(actorStamp({ uid: 'u', email: null, displayName: null, role: null }).actor).toBe('User')
  })

  it('null-safe for missing scope', () => {
    expect(actorStamp(null)).toEqual({
      actor: 'User', actorUid: null, actorRole: null, actorEmail: null,
    })
  })
})
