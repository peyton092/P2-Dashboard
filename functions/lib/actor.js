// Who is making a privileged call, as the documents it writes record them:
//   { uid, email, displayName }
//
// Everything comes from the signed in caller. Nothing is read from the request's
// data, so a caller cannot approve, reject or record an inspection as someone
// else. The display name is the one in the caller's users/{uid} document, the
// record of who the person is, which is read once on every call. The name on the
// sign in token, then the email, stand in when the document has none.

import { db } from './admin.js'

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

// auth is req.auth ({ uid, token }). userDoc is the caller's users document, or
// nothing when there is none. The name falls back from the document to the
// token, then to the email, then to 'Unknown user'.
export function buildActor(auth, userDoc) {
  const token = auth?.token ?? {}
  const email = text(token.email)
  return {
    uid: auth.uid,
    email,
    displayName: text(userDoc?.displayName) ?? text(token.name) ?? email ?? 'Unknown user',
  }
}

// The actor for a request that has already passed a guard (so req.auth exists).
// Reads users/{uid} once.
export async function actorOf(req) {
  const snap = await db.doc(`users/${req.auth.uid}`).get()
  return buildActor(req.auth, snap.exists ? snap.data() : null)
}
