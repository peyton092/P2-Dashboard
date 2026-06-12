// Pure routing helpers for the push-notification fan-out (functions/index.js
// → onNotificationCreated). Decides WHO a notification doc targets based on
// its fields; the Cloud Function wrapper does the actual users-collection
// queries from that decision.
//
// Carrying the priority order (uids → role → staff → tenant → none) as a pure
// classifier means we can unit-test it without firebase-admin, and a future
// refactor can't silently change the targeting rules. Audit C-2 (push spam)
// was the reason this logic was tightened from the previous "blast every
// fcm_token" behavior — protecting it from regression is the goal.

const KNOWN_ROLES = new Set(['owner', 'internal', 'builder', 'client'])

// Classifies a notification doc into a routing decision. Pure — no I/O.
//
// Returns one of:
//   { kind: 'uids',   uids: [string, …] }   — explicit recipient list
//   { kind: 'role',   role: 'owner' | 'internal' | 'builder' | 'client' }
//   { kind: 'staff' }                        — owner + internal (broadcast)
//   { kind: 'tenant', tenantId: string }     — every user with this tenantId
//   { kind: 'empty' }                        — nothing to do (silent drop)
//
// Priority (highest first):
//   1. recipientUids — most specific, always wins when non-empty.
//   2. recipientRole === one of the known roles.
//   3. recipientRole === 'staff' OR (no role AND no tenantId) — legacy
//      fallback. The "no signal at all" case routes to staff only, NOT to
//      everybody, which is the C-2 hardening.
//   4. tenantId — broadcast to that tenant's users.
//   5. anything else — empty (e.g. recipientRole is a string we don't
//      recognize and no tenantId).
export function classifyNotificationRouting(data) {
  const d = data || {}

  if (Array.isArray(d.recipientUids) && d.recipientUids.length > 0) {
    // De-dup and filter to strings — a malicious / buggy writer can't slip
    // non-string entries into the FCM `where in` query downstream.
    const uids = [...new Set(d.recipientUids.filter(u => typeof u === 'string' && u.length > 0))]
    if (uids.length > 0) return { kind: 'uids', uids }
  }

  const role = d.recipientRole
  if (typeof role === 'string' && KNOWN_ROLES.has(role)) {
    return { kind: 'role', role }
  }
  if (role === 'staff' || (!role && !d.tenantId)) {
    return { kind: 'staff' }
  }

  if (typeof d.tenantId === 'string' && d.tenantId.length > 0) {
    return { kind: 'tenant', tenantId: d.tenantId }
  }

  return { kind: 'empty' }
}
