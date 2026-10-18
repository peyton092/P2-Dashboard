// ============================================================================
//  User accounts
//
//    createUser     Owner only. Creates the Firebase Auth account and its
//                   users/{uid} document. The password is random and never
//                   leaves this function; the browser then asks Firebase to
//                   email the person a link to choose their own.
//    onUserWritten  Keeps Auth custom claims (role, tenantId, clientJobIds) and
//                   the clientUids of the jobs a client may see in step with
//                   the users/{uid} document, so a role is changed by editing
//                   that document and nowhere else.
//
//  The rules for both live in lib/users-validate.js and lib/users-sync.js,
//  which import no Firebase code and are unit tested directly.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { db } from './lib/admin.js'
import { requireOwner } from './lib/authz.js'
import { region } from './lib/config.js'
import { validateNewUser } from './lib/users-validate.js'
import { claimsPatchFor } from './lib/users-sync.js'

export { validateNewUser }

const CREATE_FAILED = 'Could not create the account. Try again.'

// ── createUser ────────────────────────────────────────────────────────────────
// data: { email, displayName?, role, tenantId?, clientJobIds? }  (see
// validateNewUser). Returns { uid }.
//
// The account is created in three steps: the Auth user, its claims, then its
// users document. If a later step fails the earlier ones are undone, so the
// owner can simply try again instead of finding an account that exists but has
// no role.
export const createUser = onCall({ region, cors: true }, async (req) => {
  const caller = await requireOwner(req)

  const checked = validateNewUser(req.data)
  if (!checked.ok) throw new HttpsError('invalid-argument', checked.message)
  const { email, displayName, role, tenantId, clientJobIds } = checked.value

  const auth = getAuth()

  let uid
  try {
    const record = await auth.createUser({
      email,
      displayName,
      // Nobody ever sees this. The person sets their own through the reset email.
      password: randomBytes(32).toString('hex'),
      emailVerified: false,
    })
    uid = record.uid
  } catch (e) {
    if (e?.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with that email already exists.')
    }
    console.error('[createUser] Auth could not create the account:', e)
    throw new HttpsError('internal', CREATE_FAILED)
  }

  let documentAttempted = false
  try {
    await auth.setCustomUserClaims(uid, { role, tenantId, clientJobIds })
    documentAttempted = true
    await db.doc(`users/${uid}`).set({
      email,
      displayName,
      role,
      tenantId,
      ...(role === 'client' ? { clientJobIds, clientName: displayName } : {}),
      createdBy: caller.uid,
      createdByEmail: req.auth.token?.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    console.error(`[createUser] Could not finish setting up ${uid}; undoing it:`, e)
    await undoCreate(auth, uid, documentAttempted)
    throw new HttpsError('internal', CREATE_FAILED)
  }

  return { uid }
})

// Best effort. Whatever fails here is logged and swallowed so that the failure
// that made us undo the account is the one the caller hears about.
async function undoCreate(auth, uid, documentAttempted) {
  if (documentAttempted) {
    try {
      await db.doc(`users/${uid}`).delete()
    } catch (e) {
      console.error(`[createUser] Could not delete users/${uid} while undoing it:`, e)
    }
  }
  try {
    await auth.deleteUser(uid)
  } catch (e) {
    console.error(`[createUser] Could not delete Auth user ${uid} while undoing it:`, e)
  }
}

// ── onUserWritten ─────────────────────────────────────────────────────────────
// Fires on every create, update and delete of users/{uid} (not of the
// termsAcceptances subcollection beneath it). Editing the document is how a
// role, a tenant or a client's jobs change; this applies the change to the
// claims in the user's ID token and to the jobs' clientUids that the Firestore
// rules read.
//
// Everything it does is idempotent. A failed run is logged and not retried.
// Saving the document again sets the claims again, but a client is linked to
// jobs only when their list of job ids changes, so anything else (a job created
// after its client, say) is put right by the owner backfill, which recomputes
// every job's clientUids from the users documents.
export const onUserWritten = onDocumentWritten({ document: 'users/{uid}', region }, async (event) => {
  const change = event.data
  if (!change) {
    console.warn('[onUserWritten] The event carried no data; nothing to sync.')
    return
  }
  const { uid } = event.params
  const before = change.before.exists ? change.before.data() : null
  const after = change.after.exists ? change.after.data() : null
  const patch = claimsPatchFor(before, after)

  // The two halves do not depend on each other, so one failing must not stop
  // the other (a failed claims write must not leave a removed client on a job).
  const results = await Promise.allSettled([
    syncClaims(uid, patch),
    syncJobs(uid, patch, after === null),
  ])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
})

// Sets the claims, then revokes refresh tokens when the patch says to (a changed
// or removed role). A users document with no Auth account behind it is not an
// error worth failing the event for: log it and move on.
async function syncClaims(uid, patch) {
  const auth = getAuth()
  try {
    await auth.setCustomUserClaims(uid, patch.claims)
    if (patch.revoke) await auth.revokeRefreshTokens(uid)
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') throw e
    console.warn(`[onUserWritten] users/${uid} has no Auth account, so no claims were set.`)
  }
}

// Job ids are looked up ten at a time with an `in` filter, and written in
// batches kept well under the 500 writes Firestore allows in one.
const JOB_ID_CHUNK = 10
const BATCH_SIZE = 400

const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

// A job's `id` field (like QBS-001) is not its document id, so jobs are found by
// querying it.
async function jobsWithIds(ids) {
  const refs = new Map()
  for (const part of chunks(ids, JOB_ID_CHUNK)) {
    const snap = await db.collection('jobs').where('id', 'in', part).get()
    for (const doc of snap.docs) refs.set(doc.ref.path, doc.ref)
  }
  return refs
}

// Adds the user to the clientUids of the jobs they gained and removes them from
// the jobs they lost. When the document was deleted it also removes them from
// every job that still lists them, whatever the old document said.
async function syncJobs(uid, patch, deleted) {
  const adds = await jobsWithIds(patch.addJobIds)
  const removes = await jobsWithIds(patch.removeJobIds)
  if (deleted) {
    const snap = await db.collection('jobs').where('clientUids', 'array-contains', uid).get()
    for (const doc of snap.docs) removes.set(doc.ref.path, doc.ref)
  }

  const writes = [
    ...[...adds.values()].map((ref) => [ref, FieldValue.arrayUnion(uid)]),
    ...[...removes.values()].map((ref) => [ref, FieldValue.arrayRemove(uid)]),
  ]
  for (const part of chunks(writes, BATCH_SIZE)) {
    const batch = db.batch()
    for (const [ref, change] of part) batch.update(ref, { clientUids: change })
    await batch.commit()
  }
}
