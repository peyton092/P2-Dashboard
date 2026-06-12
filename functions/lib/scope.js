// Pure scope helpers shared by the portal-mutation callables in
// functions/index.js. Lives in its own module so it has zero firebase-admin
// dependencies and can be unit-tested without spinning up a Firestore
// emulator. The Firestore read that resolves the user doc is left to the
// callable wrapper; this module just shapes inputs into outputs.

// Build the caller's verified scope object from the auth principal + the
// caller's users/{uid} doc data. The caller is responsible for loading
// `userData` from Firestore; that keeps this function pure (no I/O) and
// makes the ownership logic trivially testable.
//
// Returned shape:
//   { uid, email, displayName, role, tenantId, clientJobIds, isStaff }
export function buildCallerScope({ auth, userData }) {
  const u = userData || {}
  const role = auth?.token?.role || u.role || null
  return {
    uid:           auth?.uid || null,
    email:         auth?.token?.email || u.email || null,
    displayName:   u.name || u.displayName || null,
    role,
    tenantId:      u.tenantId || null,
    clientJobIds:  Array.isArray(u.clientJobIds) ? u.clientJobIds : [],
    isStaff:       role === 'owner' || role === 'internal',
  }
}

// Server-side mirror of firestore.rules's ownsRecord(). Same semantics —
// staff bypass, tenant-id match, or caller uid in clientUids — minus the
// legacy "no scope fields" branch (server-side we always have a doc to
// inspect, so the escape hatch is unnecessary).
export function ownsRecordOnServer(scope, docData) {
  if (!scope) return false
  if (scope.isStaff) return true
  if (docData?.tenantId && scope.tenantId && docData.tenantId === scope.tenantId) return true
  if (Array.isArray(docData?.clientUids) && docData.clientUids.includes(scope.uid)) return true
  return false
}

// Build the actor stamp from the verified principal — closes audit M-3
// (the client used to supply `actor` as a display string, which was
// spoofable within an authenticated session).
export function actorStamp(scope) {
  return {
    actor:      scope?.displayName || scope?.email || 'User',
    actorUid:   scope?.uid || null,
    actorRole:  scope?.role || null,
    actorEmail: scope?.email || null,
  }
}
