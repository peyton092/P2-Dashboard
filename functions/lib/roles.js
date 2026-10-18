// Pure role logic shared by the Cloud Functions. Nothing here imports Firebase,
// so it can be unit tested without initializing the Admin SDK. The request
// guards that need Firestore live in authz.js.
//
// "claims" below is the plain object produced by claimsOf():
//   { uid, role, tenantId, clientJobIds }

import { tenantForRole } from './users-validate.js'

// Roles are exactly these four. Staff means owner or internal.
export const VALID_ROLES = Object.freeze(['owner', 'internal', 'builder', 'client'])

export const isStaff = (claims) => claims?.role === 'owner' || claims?.role === 'internal'

export const isOwner = (claims) => claims?.role === 'owner'

// Only the two staff roles are ranked here. Every other value, builder, client,
// an unknown name or nothing at all, ranks the same, below both.
const staffRank = (role) => (role === 'owner' ? 2 : role === 'internal' ? 1 : 0)

// Whether giving an account `nextRole` would lower the owner or internal role it
// has now (existingRole, from its current claims). The claims sync asks this for
// every write over a users document that did not say owner or internal (a new
// one included), and the backfill for every user, so that neither takes a role
// away from staff whose claims were set by hand. Raising a role, keeping it, and
// anything about an account that is not staff are all false.
export const wouldLowerStaff = (existingRole, nextRole) => staffRank(existingRole) > staffRank(nextRole)

// Maps a callable request's `req.auth` ({ uid, token }) to claims. Returns null
// when nobody is signed in. A token with no custom claims yields a null role,
// a null tenantId and an empty clientJobIds array.
export function claimsOf(auth) {
  if (!auth) return null
  const token = auth.token ?? {}
  return {
    uid: auth.uid,
    role: token.role ?? null,
    tenantId: token.tenantId ?? null,
    clientJobIds: Array.isArray(token.clientJobIds) ? token.clientJobIds : [],
  }
}

// Fills the claims from the users/{uid} document, but only where the claims
// value is null or empty and the document value is valid (a role must be one of
// VALID_ROLES). Existing claims always win. The tenant is then cleaned for the
// role as the claims sync and push clean it (tenantForRole): a builder keeps qbs
// or vision and otherwise has none, and every other role is p2-core, so a builder
// whose document names p2-core gets no tenant, as the rules give them nothing
// scoped. Returns a new object; the inputs are never modified. This is the same
// fallback the Firestore rules use for tokens that were minted before claims
// were synced.
export function mergeUserDoc(claims, userDoc) {
  if (!claims) return null
  const merged = { ...claims }
  if (!userDoc || typeof userDoc !== 'object') return merged

  if (!claims.role && VALID_ROLES.includes(userDoc.role)) {
    merged.role = userDoc.role
  }
  if (!claims.tenantId && typeof userDoc.tenantId === 'string' && userDoc.tenantId) {
    merged.tenantId = userDoc.tenantId
  }
  merged.tenantId = tenantForRole(merged.role, merged.tenantId)
  const hasJobs = Array.isArray(claims.clientJobIds) && claims.clientJobIds.length > 0
  if (!hasJobs && Array.isArray(userDoc.clientJobIds)) {
    merged.clientJobIds = userDoc.clientJobIds.filter((id) => typeof id === 'string' && id !== '')
  }
  return merged
}
