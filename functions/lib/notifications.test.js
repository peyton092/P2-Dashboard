import { describe, it, expect } from 'vitest'
import { classifyNotificationRouting } from './notifications.js'

// ── Priority order ────────────────────────────────────────────────────────────

describe('classifyNotificationRouting — priority order', () => {
  it('recipientUids wins over recipientRole and tenantId', () => {
    const route = classifyNotificationRouting({
      recipientUids: ['u1'],
      recipientRole: 'owner',
      tenantId: 'qbs',
    })
    expect(route).toEqual({ kind: 'uids', uids: ['u1'] })
  })

  it('recipientRole (known) wins over tenantId', () => {
    const route = classifyNotificationRouting({
      recipientRole: 'builder',
      tenantId: 'qbs',
    })
    expect(route).toEqual({ kind: 'role', role: 'builder' })
  })

  it("recipientRole === 'staff' wins over tenantId", () => {
    const route = classifyNotificationRouting({
      recipientRole: 'staff',
      tenantId: 'qbs',
    })
    expect(route).toEqual({ kind: 'staff' })
  })

  it('tenantId is the lowest non-empty signal', () => {
    expect(classifyNotificationRouting({ tenantId: 'qbs' })).toEqual({
      kind: 'tenant', tenantId: 'qbs',
    })
  })
})

// ── Each kind in isolation ────────────────────────────────────────────────────

describe('classifyNotificationRouting — recipientUids', () => {
  it('returns the uids unchanged when all are valid strings', () => {
    expect(classifyNotificationRouting({ recipientUids: ['a', 'b', 'c'] }))
      .toEqual({ kind: 'uids', uids: ['a', 'b', 'c'] })
  })

  it('de-duplicates entries', () => {
    expect(classifyNotificationRouting({ recipientUids: ['a', 'b', 'a'] }))
      .toEqual({ kind: 'uids', uids: ['a', 'b'] })
  })

  it('strips non-string entries', () => {
    expect(classifyNotificationRouting({
      recipientUids: ['ok', 42, null, undefined, { bad: 1 }, ''],
    })).toEqual({ kind: 'uids', uids: ['ok'] })
  })

  it('falls through when recipientUids ends up empty after filtering', () => {
    // Defensive bug-fix vs the original behavior: the old code returned
    // `new Set([null])` here, which would then explode in the downstream
    // Firestore `where('uid', 'in', [null])` query. Falling through to the
    // staff fallback is a graceful degradation.
    expect(classifyNotificationRouting({ recipientUids: [null, ''] }))
      .toEqual({ kind: 'staff' })
  })

  it('falls through when recipientUids is empty', () => {
    expect(classifyNotificationRouting({ recipientUids: [], tenantId: 'qbs' }))
      .toEqual({ kind: 'tenant', tenantId: 'qbs' })
  })

  it('falls through when recipientUids is not an array', () => {
    expect(classifyNotificationRouting({ recipientUids: 'one-uid-as-string' }))
      .toEqual({ kind: 'staff' })
  })
})

describe('classifyNotificationRouting — recipientRole', () => {
  it.each(['owner', 'internal', 'builder', 'client'])(
    'accepts %s as a role broadcast', (role) => {
      expect(classifyNotificationRouting({ recipientRole: role }))
        .toEqual({ kind: 'role', role })
    },
  )

  it("maps 'staff' to the dedicated staff broadcast", () => {
    expect(classifyNotificationRouting({ recipientRole: 'staff' }))
      .toEqual({ kind: 'staff' })
  })

  it('treats unknown role strings as missing — falls through', () => {
    // Plus tenantId so the fallback ISN'T staff — exposes that the role
    // wasn't accepted.
    expect(classifyNotificationRouting({ recipientRole: 'admin', tenantId: 'qbs' }))
      .toEqual({ kind: 'tenant', tenantId: 'qbs' })
  })

  it('treats non-string role as missing', () => {
    expect(classifyNotificationRouting({ recipientRole: 42, tenantId: 'qbs' }))
      .toEqual({ kind: 'tenant', tenantId: 'qbs' })
  })
})

// ── The C-2 hardening: legacy fallback ────────────────────────────────────────

describe('classifyNotificationRouting — legacy fallback (audit C-2)', () => {
  it('routes empty notifications to staff, NOT to everyone', () => {
    // This is the C-2 hardening: a notification with no targeting info
    // used to blast every fcm_token. Now it lands on staff only.
    expect(classifyNotificationRouting({})).toEqual({ kind: 'staff' })
    expect(classifyNotificationRouting({ msg: 'hi', type: 'info' }))
      .toEqual({ kind: 'staff' })
  })

  it('falls back to staff when called with null / undefined', () => {
    expect(classifyNotificationRouting(null)).toEqual({ kind: 'staff' })
    expect(classifyNotificationRouting(undefined)).toEqual({ kind: 'staff' })
  })
})

// ── tenantId ──────────────────────────────────────────────────────────────────

describe('classifyNotificationRouting — tenantId', () => {
  it('accepts a tenant broadcast', () => {
    expect(classifyNotificationRouting({ tenantId: 'vision' }))
      .toEqual({ kind: 'tenant', tenantId: 'vision' })
  })

  it('ignores an empty-string tenantId — falls through to empty kind', () => {
    // Empty tenantId is meaningless. Falls through to the empty bucket
    // since we already passed the "no signal" check above (tenantId IS set).
    // The only way to reach the empty kind today is via a non-string /
    // empty-string tenantId combined with a non-empty unknown role.
    expect(classifyNotificationRouting({ recipientRole: 'admin', tenantId: '' }))
      .toEqual({ kind: 'empty' })
  })

  it('ignores a non-string tenantId', () => {
    expect(classifyNotificationRouting({ recipientRole: 'admin', tenantId: 42 }))
      .toEqual({ kind: 'empty' })
  })
})
