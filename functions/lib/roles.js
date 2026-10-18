// Pure role logic shared by the Cloud Functions. Nothing here imports Firebase,
// so it can be unit tested without initializing the Admin SDK. The request
// guards that need Firestore live in authz.js.
//
// "claims" below is the plain object produced by claimsOf():
//   { uid, role, tenantId, clientJobIds }

// Roles are exactly these four. Staff means owner or internal.
export const VALID_ROLES = Object.freeze(['owner', 'internal', 'builder', 'client'])

export const isStaff = (claims) => claims?.role === 'owner' || claims?.role === 'internal'

export const isOwner = (claims) => claims?.role === 'owner'

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
// VALID_ROLES). Existing claims always win. Returns a new object; the inputs
// are never modified. This is the same fallback the Firestore rules use for
// tokens that were minted before claims were synced.
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
  const hasJobs = Array.isArray(claims.clientJobIds) && claims.clientJobIds.length > 0
  if (!hasJobs && Array.isArray(userDoc.clientJobIds)) {
    merged.clientJobIds = userDoc.clientJobIds.filter((id) => typeof id === 'string' && id !== '')
  }
  return merged
}
