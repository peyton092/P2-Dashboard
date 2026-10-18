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
//  which import no Firebase code and are unit tested directly. The rule that a
//  first assignment never lowers an owner or internal account is wouldLowerStaff
//  in lib/roles.js.
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
import { claimsPatchFor, jobLinkChanges } from './lib/users-sync.js'
import { currentClaimRole } from './lib/auth-claims.js'
import { wouldLowerStaff } from './lib/roles.js'
import { BATCH_SIZE, JOB_ID_CHUNK, chunks } from './lib/batches.js'

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
// It works from the document as it is now. Events can be delivered late or out
// of order, so the event's own copy of the document may already be out of date,
// and acting on it could put an old role back. The document is read again and
// everything (claims, job links) follows that, so whichever event runs last
// leaves the latest state in place. Only the previous role, which decides
// whether to revoke, comes from the event.
//
// Everything it does is idempotent. A failed run is logged and not retried
// (a retry would repeat revokeRefreshTokens), and saving the document again runs
// it again: the claims are set again and every job the client lists is checked
// and linked if it is missing.
//
// A new document is a first assignment, and a first assignment never lowers
// anyone. Internal staff can create a users document for an owner whose claims
// were set by hand, and the account keeps its owner or internal role: the claims
// are left as they are (the jobs are still linked), and the log says so.
export const onUserWritten = onDocumentWritten({ document: 'users/{uid}', region }, async (event) => {
  const change = event.data
  if (!change) {
    console.warn('[onUserWritten] The event carried no data; nothing to sync.')
    return
  }
  const { uid } = event.params
  const before = change.before.exists ? change.before.data() : null

  const latest = await change.after.ref.get()
  const after = latest.exists ? latest.data() : null
  const patch = claimsPatchFor(before, after)

  // The two halves do not depend on each other, so one failing must not stop
  // the other (a failed claims write must not leave a removed client on a job).
  const results = await Promise.allSettled([syncClaims(uid, patch, before === null), syncJobs(uid, patch.jobIds)])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
})

// Sets the claims, then revokes refresh tokens when the patch says to (a changed
// or removed role). A users document with no Auth account behind it is not an
// error worth failing the event for: log it and move on. A new document leaves
// the claims of an owner or internal account alone when they would be lowered.
async function syncClaims(uid, patch, isNew) {
  const auth = getAuth()
  try {
    if (isNew && (await lowersStaff(uid, patch.claims))) return
    await auth.setCustomUserClaims(uid, patch.claims)
    if (patch.revoke) await auth.revokeRefreshTokens(uid)
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') throw e
    console.warn(`[onUserWritten] users/${uid} has no Auth account, so no claims were set.`)
  }
}

// Whether the account already has an owner or internal role that these claims
// would lower. A document with no role, or none that is valid, gives claims with a
// null role, and a document that is already gone gives none at all; both count as
// the lowest role. The account is read from Auth as it is now, and a failed read
// is thrown rather than guessed at.
async function lowersStaff(uid, claims) {
  const existing = await currentClaimRole(uid)
  const next = claims?.role ?? null
  if (!wouldLowerStaff(existing, next)) return false
  console.warn(
    `[onUserWritten] users/${uid} is new and says ${next ?? 'no role'}, but that account is already ${existing}, so its claims were left as they are.`,
  )
  return true
}

// A job as jobLinkChanges reads it, plus the reference to write to.
const jobOf = (doc) => {
  const data = doc.data() ?? {}
  return { ref: doc.ref, path: doc.ref.path, id: data.id, clientUids: data.clientUids }
}

// The jobs whose `id` field (like QBS-001, not the document id) is in ids.
async function jobsWithIds(ids) {
  const found = new Map()
  for (const part of chunks(ids, JOB_ID_CHUNK)) {
    const snap = await db.collection('jobs').where('id', 'in', part).get()
    for (const doc of snap.docs) found.set(doc.ref.path, jobOf(doc))
  }
  return [...found.values()]
}

// The jobs whose clientUids already list the user.
async function jobsListing(uid) {
  const snap = await db.collection('jobs').where('clientUids', 'array-contains', uid).get()
  return snap.docs.map(jobOf)
}

// Brings the jobs in line with the ids the user is meant to have: links the user
// to every one of those jobs that does not list them yet, and unlinks them from
// every job that lists them but is not one of those. With no ids (not a client,
// or the document is gone) that unlinks them everywhere.
async function syncJobs(uid, jobIds) {
  const wanted = await jobsWithIds(jobIds)
  const linked = await jobsListing(uid)
  const { add, remove } = jobLinkChanges(uid, jobIds, wanted, linked)

  const writes = [
    ...add.map((job) => [job.ref, FieldValue.arrayUnion(uid)]),
    ...remove.map((job) => [job.ref, FieldValue.arrayRemove(uid)]),
  ]
  for (const part of chunks(writes, BATCH_SIZE)) {
    const batch = db.batch()
    for (const [ref, change] of part) batch.update(ref, { clientUids: change })
    await batch.commit()
  }
}
