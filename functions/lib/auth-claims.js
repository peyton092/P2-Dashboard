// Reads the custom claims an Auth account has right now. The pure rules that use
// the answer live in roles.js (wouldLowerStaff).

import { getAuth } from 'firebase-admin/auth'

// The role in the account's custom claims: a string, or null when the claims have
// no role. An account that does not exist has no claims either, so that is null
// too. Any other failure is thrown, so a caller protecting a role does not
// guess one when it could not look.
export async function currentClaimRole(uid) {
  try {
    const record = await getAuth().getUser(uid)
    const role = record.customClaims?.role
    return typeof role === 'string' ? role : null
  } catch (e) {
    if (e?.code === 'auth/user-not-found') return null
    throw e
  }
}
