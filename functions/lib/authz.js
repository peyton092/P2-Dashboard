// Request guards for callable functions. These read the caller's identity from
// the request and, when the ID token carries no role, from the users document.
// The pure rules they rely on live in roles.js.

import { HttpsError } from 'firebase-functions/v2/https'
import { db } from './admin.js'
import { claimsOf, isStaff, isOwner, mergeUserDoc } from './roles.js'

// Requires a signed in caller and returns their claims:
//   { uid, role, tenantId, clientJobIds }
//
// The role comes from the custom claim first. Tokens minted before claims were
// synced have none, so only then is users/{uid} read (once) and merged in. That
// is the same fallback the Firestore rules use, and it keeps these callables
// working for existing users until their claims are backfilled. A failed read
// rejects the call rather than guessing a role.
export async function requireAuth(req) {
  if (!req?.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }
  const claims = claimsOf(req.auth)
  if (claims.role) return claims

  const snap = await db.doc(`users/${claims.uid}`).get()
  return mergeUserDoc(claims, snap.exists ? snap.data() : null)
}

// Requires an owner or internal staff caller. Returns their claims.
export async function requireStaff(req) {
  const claims = await requireAuth(req)
  if (!isStaff(claims)) {
    throw new HttpsError('permission-denied', 'Staff access required.')
  }
  return claims
}

// Requires an owner caller. Returns their claims.
export async function requireOwner(req) {
  const claims = await requireAuth(req)
  if (!isOwner(claims)) {
    throw new HttpsError('permission-denied', 'Owner access required.')
  }
  return claims
}
