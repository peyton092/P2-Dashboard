// Pure push notification targeting. Nothing here imports Firebase.
//
// Devices register under fcm_tokens/{token} with the uid that was signed in at
// the time. A notification reaches a device only when its user is in scope:
//   - staff (owner or internal): every notification
//   - builder: when notif.tenantId is the builder's tenantId
//   - client: when the client's uid is in notif.clientUids, or notif.jobId is
//     one of the client's clientJobIds
// A notification with none of tenantId, clientUids or jobId therefore reaches
// staff devices only.

import { isStaff } from './roles.js'

const nonEmptyString = (value) => typeof value === 'string' && value !== ''

function inScope(notif, uid, user) {
  if (isStaff(user)) return true
  if (user.role === 'builder') {
    return nonEmptyString(notif.tenantId) && notif.tenantId === user.tenantId
  }
  if (user.role === 'client') {
    if (Array.isArray(notif.clientUids) && notif.clientUids.includes(uid)) return true
    return (
      nonEmptyString(notif.jobId) &&
      Array.isArray(user.clientJobIds) &&
      user.clientJobIds.includes(notif.jobId)
    )
  }
  return false
}

// tokenDocs: [{ token, uid }]
// usersById: { [uid]: { role, tenantId, clientJobIds } }
// Returns the unique tokens to notify, in input order. A token with no uid, or
// whose uid has no entry in usersById, is skipped.
export function targetTokens(notif, tokenDocs, usersById) {
  const scope = notif ?? {}
  const users = usersById ?? {}
  const seen = new Set()
  const tokens = []

  for (const entry of tokenDocs ?? []) {
    const token = entry?.token
    const uid = entry?.uid
    if (!nonEmptyString(token) || !nonEmptyString(uid)) continue
    if (!Object.hasOwn(users, uid) || !users[uid]) continue
    if (seen.has(token)) continue
    if (!inScope(scope, uid, users[uid])) continue
    seen.add(token)
    tokens.push(token)
  }
  return tokens
}

// Turns a Firestore QuerySnapshot of fcm_tokens (or anything shaped like one:
// `docs`, each with an `id` and a `data()`) into [{ token, uid }]. The token is
// the document id. uid is null for devices registered before anyone signed in.
export function groupTokens(tokenSnap) {
  const docs = tokenSnap?.docs ?? []
  return docs.map((doc) => ({ token: doc.id, uid: doc.data()?.uid ?? null }))
}
