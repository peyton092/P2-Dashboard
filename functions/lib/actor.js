// Who is making a privileged call, as the documents it writes record them:
//   { uid, email, displayName }
//
// Everything comes from the signed in caller. Nothing is read from the request's
// data, so a caller cannot approve, reject or record an inspection as someone
// else. The display name is the name on the sign in token; only a token without
// one (an account that was never given a name) costs a read of users/{uid}.

import { db } from './admin.js'

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

// auth is req.auth ({ uid, token }). userDoc is the caller's users document, or
// nothing when it was not needed. The name falls back from the token to the
// document, then to the email, then to 'Unknown user'.
export function buildActor(auth, userDoc) {
  const token = auth?.token ?? {}
  const email = text(token.email)
  return {
    uid: auth.uid,
    email,
    displayName: text(token.name) ?? text(userDoc?.displayName) ?? email ?? 'Unknown user',
  }
}

// The actor for a request that has already passed a guard (so req.auth exists).
export async function actorOf(req) {
  if (text(req.auth.token?.name)) return buildActor(req.auth)
  const snap = await db.doc(`users/${req.auth.uid}`).get()
  return buildActor(req.auth, snap.exists ? snap.data() : null)
}
