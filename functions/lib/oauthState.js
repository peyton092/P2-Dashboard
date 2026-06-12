// Pure OAuth-state helpers shared by qbAuth / qbCallback / ccAuth / ccCallback.
//
// The Firestore-backed OAuth flow stores one-time `state` nonces under a single
// config doc keyed by random hex. On callback we verify the nonce is present,
// not expired, and that the caller matches the user who initiated the flow —
// then we burn it so it can't be replayed.
//
// All security-relevant decisions (expiry math, replay-prevention, cross-user
// blocking) live here as pure functions so they can be unit-tested without
// firebase-admin / a Firestore emulator. The Cloud Functions wrappers in
// functions/index.js handle the I/O.

// Returns the list of state keys whose `createdAt` is older than `nowMs - ttlMs`.
// Caller is expected to map this list into a {key: FieldValue.delete()} update.
// `existingMap` is the doc data — { stateKey: { uid, createdAt: Timestamp } }.
// Robust against missing/odd shapes: rec without a Timestamp-like createdAt
// is treated as fresh (we don't have a basis to expire it).
export function findExpiredStateKeys(existingMap, nowMs, ttlMs) {
  if (!existingMap || typeof existingMap !== 'object') return []
  const cutoff = nowMs - ttlMs
  const expired = []
  for (const [key, rec] of Object.entries(existingMap)) {
    const ts = rec?.createdAt?.toMillis?.() ?? 0
    if (ts && ts < cutoff) expired.push(key)
  }
  return expired
}

// Verifies a presented OAuth `state` against the stored state map.
// Returns:
//   { ok: true }                                           — accept and burn
//   { ok: false, code: 'failed-precondition',
//                reason: 'not-found' | 'expired' }         — reject (burn if expired)
//   { ok: false, code: 'permission-denied',
//                reason: 'foreign-user' }                  — reject
//
// Throwing HttpsError is left to the caller; this helper just decides.
export function verifyOAuthState({ stateMap, state, callerUid, nowMs, ttlMs }) {
  const rec = stateMap?.[state]
  if (!rec) return { ok: false, code: 'failed-precondition', reason: 'not-found' }

  const createdMs = rec.createdAt?.toMillis?.() ?? 0
  if (createdMs === 0 || nowMs - createdMs > ttlMs) {
    return { ok: false, code: 'failed-precondition', reason: 'expired' }
  }

  // A state with no recorded uid (legacy) is allowed through; only block when
  // both sides know the uid and they disagree. Prevents CSRF where one user's
  // state is replayed in another user's session.
  if (rec.uid && callerUid && rec.uid !== callerUid) {
    return { ok: false, code: 'permission-denied', reason: 'foreign-user' }
  }

  return { ok: true }
}

// Human-readable message for each failure mode. Keeps the Cloud Functions
// wrappers from repeating the strings.
export const VERIFY_OAUTH_STATE_MESSAGES = {
  'not-found':    'OAuth state expired or invalid. Try connecting again.',
  'expired':      'OAuth state expired. Try connecting again.',
  'foreign-user': 'OAuth state belongs to a different user.',
}
