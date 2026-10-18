// ============================================================================
//  Scope stamping
//
//    onJobWritten     Fires on every write to jobs/{id}. When the job's tenantId or
//                     its clientUids changed, gives the job's change orders,
//                     submissions and notifications the new scope.
//    onExtraWritten   Fire on every write to extras/{id} and submits/{id}. Give the
//    onSubmitWritten  document its job's scope when it does not carry it.
//    backfillScopes   Owner only. Stamps the scope onto everything that exists now
//                     and sets the sign in claims of every user, then returns
//                     what it did.
//
//  A job's scope is { tenantId, clientUids }. A change order, a submission and a
//  notification carry a copy of it, because the Firestore rules read the copy to
//  decide who may see the document. The job is where the scope comes from: a
//  change order names its job in `job`, and a submission or notification in
//  `jobId`, both holding the job's own id (like QBS-001) and not its document id.
//  A submission or notification with no jobId belongs to staff and has no scope to
//  carry, so it is left alone.
//
//  None of these can fire itself. A document is written only when it does not
//  carry its job's scope, and the write makes it carry it, so the trigger that the
//  write fires finds nothing to do.
//
//  The rules (what counts as a change, what has to be stamped again) live in
//  lib/scope-sync.js, which imports no Firebase code and is unit tested directly.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getAuth } from 'firebase-admin/auth'
import { db } from './lib/admin.js'
import { requireOwner } from './lib/authz.js'
import { region } from './lib/config.js'
import { currentClaimRole } from './lib/auth-claims.js'
import { wouldLowerStaff } from './lib/roles.js'
import { claimsPatchFor } from './lib/users-sync.js'
import { BATCH_SIZE, chunks } from './lib/batches.js'
import { clientLinks, needsRestamp, scopeChanged, scopePatchFor } from './lib/scope-sync.js'

export { needsRestamp, scopePatchFor }

// The collections whose documents carry their job's scope, and the field each one
// names its job in.
const SCOPED = [
  { collection: 'extras', field: 'job' },
  { collection: 'submits', field: 'jobId' },
  { collection: 'notifications', field: 'jobId' },
]

// The id of the job a document names, or null when it names none.
const jobIdOf = (doc, field) => (typeof doc?.[field] === 'string' && doc[field] !== '' ? doc[field] : null)

// Applies [ref, data] updates in batches kept well under the 500 writes Firestore
// allows in one.
async function commitUpdates(updates) {
  for (const part of chunks(updates, BATCH_SIZE)) {
    const batch = db.batch()
    for (const [ref, data] of part) batch.update(ref, data)
    await batch.commit()
  }
}

// ── onJobWritten ──────────────────────────────────────────────────────────────
// Fires on every create, update and delete of jobs/{id}. It acts only when the
// job's tenantId, or the set of uids in its clientUids, changed (clientUids moves
// whenever onUserWritten links or unlinks a client). Then every change order,
// submission and notification that names the job is given the job's scope, if it
// does not carry it already. A job that was deleted writes nothing: the documents
// that named it keep the scope they were last given.
//
// A new job that was written without a tenantId gets the legacy default, qbs,
// written onto itself once, instead of leaving it implied for ever. The write is
// to the job, so this runs again for it, finds the tenant set and the documents
// already stamped, and writes nothing.
//
// Like onUserWritten it works from the job as it is now. Events can arrive late or
// out of order, so the event's own copy may already be out of date, and stamping
// from it could put an older scope on the documents after a newer one. The job is
// read again and its current scope is what gets stamped; only the question of
// whether anything changed comes from the event.
//
// A failed run is logged and not retried. Saving the job again, or the backfill,
// runs it again.
export const onJobWritten = onDocumentWritten({ document: 'jobs/{id}', region }, async (event) => {
  const change = event.data
  if (!change) {
    console.warn('[onJobWritten] The event carried no data; nothing to stamp.')
    return
  }
  if (!change.after.exists) return

  const ref = change.after.ref
  const before = change.before.exists ? change.before.data() : null
  // Most writes to a job (a permit, an inspection, a status) change nothing here, and
  // cost nothing: the job is not even read again. A new job always counts as a change.
  if (!scopeChanged(before, change.after.data())) return

  const latest = await ref.get()
  if (!latest.exists) return
  const job = latest.data()

  // The two do not depend on each other, so one failing must not stop the other.
  const results = await Promise.allSettled([
    before === null ? stampOwnTenant(ref, job) : null,
    stampDependents(ref.path, job),
  ])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
})

// Writes the legacy default tenant onto a job that has none.
async function stampOwnTenant(ref, job) {
  if (typeof job.tenantId === 'string' && job.tenantId !== '') return
  await ref.update({ tenantId: scopePatchFor(job).tenantId })
}

// Gives every document that names the job the job's scope, in batches, leaving
// out the ones that already carry it.
async function stampDependents(path, job) {
  if (typeof job.id !== 'string' || job.id === '') {
    console.warn(`[onJobWritten] ${path} has no id, so nothing that names it was stamped.`)
    return
  }
  const found = await Promise.all(
    SCOPED.map(({ collection, field }) => db.collection(collection).where(field, '==', job.id).get()),
  )
  const stale = found.flatMap((snap) => snap.docs).filter((doc) => needsRestamp(doc.data(), job))
  await commitUpdates(stale.map((doc) => [doc.ref, scopePatchFor(job)]))
}

// ── onExtraWritten and onSubmitWritten ────────────────────────────────────────
// Fire on every create, update and delete of extras/{id} and submits/{id}. The
// browser creates a submission with no scope, and a change order written before
// scopes existed has none, so whenever one is written the job it names is looked
// up by its id and the document is given the job's tenantId and clientUids if it
// does not carry them. A document that already carries its job's scope produces no
// write, so the update this makes does not stamp anything again. A document whose
// job cannot be found is logged and left as it is, and so is one that names no
// job. A deleted document writes nothing.
//
// The document, the job and the write are one transaction. A change to the job
// while this runs (a client linked, say) therefore cannot be overwritten by the
// scope this read before it. All the reads come first, as Firestore requires.
export const onExtraWritten = onDocumentWritten({ document: 'extras/{id}', region }, (event) =>
  stampFromJob('onExtraWritten', event, 'job'),
)

export const onSubmitWritten = onDocumentWritten({ document: 'submits/{id}', region }, (event) =>
  stampFromJob('onSubmitWritten', event, 'jobId'),
)

async function stampFromJob(name, event, field) {
  const change = event.data
  if (!change) {
    console.warn(`[${name}] The event carried no data; nothing to stamp.`)
    return
  }
  if (!change.after.exists) return
  if (jobIdOf(change.after.data(), field) === null) return

  const ref = change.after.ref
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const doc = snap.data()
    const jobId = jobIdOf(doc, field)
    if (jobId === null) return

    const found = await tx.get(db.collection('jobs').where('id', '==', jobId).limit(1))
    if (found.empty) {
      console.warn(`[${name}] ${ref.path} names job ${jobId}, which was not found, so it was left as it is.`)
      return
    }
    const job = found.docs[0].data()
    if (needsRestamp(doc, job)) tx.update(ref, scopePatchFor(job))
  })
}

// What the owner reads when the run stops. Whatever went wrong is logged in full.
const BACKFILL_FAILED = 'The backfill stopped before it finished. It is safe to run again.'

// ── backfillScopes ────────────────────────────────────────────────────────────
// Owner only; the guard runs before anything is read. Reads whole collections, which
// is fine for a tool the owner runs when scopes first go in or after an import, and
// writes in batches. It goes in this order, and each step is counted:
//   users          Sets the Auth claims of every users document with a valid role,
//                  as onUserWritten sets them for a new one (so nobody is signed
//                  out). Like onUserWritten it will not lower an owner or internal
//                  account, and it skips a users document with no Auth account.
//   jobs           Sets every job's tenantId (its own, or qbs when it has none) and
//                  its clientUids to exactly the clients whose users document lists
//                  the job, so a stale link goes. Every job is written, even one
//                  that was already right, so the count shows the run covered them.
//   extras,        Gives every change order (job), submission and notification
//   submits,       (jobId) the scope of the job it names. One that names no job, or
//   notifications  a job that does not exist, is left alone.
// Returns { ok: true, users, jobs, extras, submits, notifications, skipped }, where
// skipped is how many of those documents were left alone for want of a job.
//
// Every step can be repeated. If one fails the run stops and says so, and running
// it again carries on.
export const backfillScopes = onCall({ region, cors: true, timeoutSeconds: 540 }, async (req) => {
  const caller = await requireOwner(req)
  let result
  try {
    result = await runBackfill()
  } catch (e) {
    console.error('[backfillScopes] The backfill stopped before it finished:', e)
    throw new HttpsError('internal', BACKFILL_FAILED)
  }
  console.log(`[backfillScopes] ${caller.uid} ran the backfill: ${JSON.stringify(result)}`)
  return result
})

async function runBackfill() {
  const users = (await db.collection('users').get()).docs.map((doc) => ({ uid: doc.id, data: doc.data() }))
  const claimed = await setClaims(users)

  // The scope each job ends up with, by the job's own id. The documents that name
  // a job take it from here, so they get the same clientUids the job just did.
  const links = clientLinks(users)
  const scopes = new Map()
  const jobWrites = []
  for (const doc of (await db.collection('jobs').get()).docs) {
    const job = doc.data()
    const scope = { tenantId: scopePatchFor(job).tenantId, clientUids: [...(links.get(job.id) ?? [])] }
    if (typeof job.id === 'string' && job.id !== '') scopes.set(job.id, scope)
    jobWrites.push([doc.ref, scope])
  }
  await commitUpdates(jobWrites)

  const stamped = {}
  let skipped = 0
  for (const { collection, field } of SCOPED) {
    const writes = []
    for (const doc of (await db.collection(collection).get()).docs) {
      const scope = scopes.get(jobIdOf(doc.data(), field))
      if (scope) writes.push([doc.ref, { tenantId: scope.tenantId, clientUids: [...scope.clientUids] }])
      else skipped += 1
    }
    await commitUpdates(writes)
    stamped[collection] = writes.length
  }

  return {
    ok: true,
    users: claimed,
    jobs: jobWrites.length,
    extras: stamped.extras,
    submits: stamped.submits,
    notifications: stamped.notifications,
    skipped,
  }
}

// Sets the claims of every user with a valid role, the way a first assignment does
// (claimsPatchFor with no previous document, so no refresh tokens are revoked).
// Returns how many users had their claims set.
async function setClaims(users) {
  const auth = getAuth()
  let set = 0
  for (const { uid, data } of users) {
    const { claims } = claimsPatchFor(null, data)
    if (!claims || claims.role === null) continue
    try {
      const existing = await currentClaimRole(uid)
      if (wouldLowerStaff(existing, claims.role)) {
        console.warn(
          `[backfillScopes] users/${uid} says ${claims.role}, but that account is already ${existing}, so its claims were left as they are.`,
        )
        continue
      }
      await auth.setCustomUserClaims(uid, claims)
      set += 1
    } catch (e) {
      if (e?.code !== 'auth/user-not-found') throw e
      console.warn(`[backfillScopes] users/${uid} has no Auth account, so no claims were set.`)
    }
  }
  return set
}
