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
//  carry, so it is left alone. So is a draft change order (extraState in
//  lib/extras.js): it has not been sent, so only staff may see it, and it carries no
//  scope until sendExtraToBuilder stamps it from its job as it sends it.
//
//  One exception holds everywhere: a submission a builder created stays in the tenant it
//  carries when its job is in another. A builder stamps their own tenant on the
//  submissions they create and may name any job, so following the job would let them
//  put a submission in another tenant's portals. Whether that applies is read from the
//  users document of the person in its createdBy; every other submission, a client's or
//  staff's, or one whose creator is unknown, follows its job. A submission that stays in
//  its tenant and still lists clients (from a time it followed its job) has its
//  clientUids emptied, once: a builder creates a submission with none, and that is the
//  only write it gets.
//
//  None of these can fire itself. A document is written only when it does not
//  carry its job's scope, and the write makes it carry it (or, for a submission that
//  stays in its tenant, empties its clientUids), so the trigger that the write fires
//  finds nothing to do.
//
//  The rules (what counts as a change, what has to be stamped again) live in
//  lib/scope-sync.js, which imports no Firebase code and is unit tested directly.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './lib/admin.js'
import { requireOwner } from './lib/authz.js'
import { region } from './lib/config.js'
import { currentClaimRole } from './lib/auth-claims.js'
import { wouldLowerStaff } from './lib/roles.js'
import { nonEmptyString } from './lib/scope.js'
import { claimsPatchFor } from './lib/users-sync.js'
import { BATCH_SIZE, chunks } from './lib/batches.js'
import { extraState } from './lib/extras.js'
import {
  clientLinks, creatorDecides, creatorOf, jobIdOf, listsClients, needsRestamp, scopeChanged, scopePatchFor, staysInTenant,
} from './lib/scope-sync.js'

export { needsRestamp, scopePatchFor }

// The collections whose documents carry their job's scope, and the field each one
// names its job in.
const SCOPED = [
  { collection: 'extras', field: 'job' },
  { collection: 'submits', field: 'jobId' },
  { collection: 'notifications', field: 'jobId' },
]

// A change order that has not been sent. It is never stamped.
const isDraft = (collection, data) => collection === 'extras' && extraState(data) === 'draft'

// Applies [ref, data] updates in batches kept well under the 500 writes Firestore
// allows in one. The first batch that fails stops the rest and is thrown, unless
// onFailure is given: then it is called with the error and the updates of that batch,
// and the batches after it still go.
async function commitUpdates(updates, onFailure) {
  for (const part of chunks(updates, BATCH_SIZE)) {
    try {
      const batch = db.batch()
      for (const [ref, data] of part) batch.update(ref, data)
      await batch.commit()
    } catch (e) {
      if (!onFailure) throw e
      onFailure(e, part)
    }
  }
}

// ── onJobWritten ──────────────────────────────────────────────────────────────
// Fires on every create, update and delete of jobs/{id}. It acts only when the
// job's tenantId, or the set of uids in its clientUids, changed (clientUids moves
// whenever onUserWritten links or unlinks a client). Then every change order,
// submission and notification that names the job is given the job's scope, if it
// does not carry it already, except a draft change order, which is left as it is.
// A job that was deleted writes nothing: the documents that named it keep the
// scope they were last given.
//
// A submission a builder created that carries another tenant than the job is left where
// it is and logged once (see staysInTenant), and has its clientUids emptied when it
// lists any. Its creator's role is read from their users document, once per pass for
// each creator, and only for a submission whose tenant differs from the job's. Every
// other submission, change order and notification follows the job.
//
// A new job that was written without a tenantId gets the legacy default, qbs,
// written onto itself once, instead of leaving it implied for ever. That is one
// transaction that reads the job and writes only if it still has no tenant, so a
// tenant set in the meantime is not overwritten. The write is to the job, so this
// runs again for it, finds the tenant set and the documents already stamped, and
// writes nothing.
//
// Like onUserWritten it works from the job as it is now. Events can arrive late or
// out of order, so the event's own copy may already be out of date, and stamping
// from it could put an older scope on the documents after a newer one. The job is
// read again and its current scope is what gets stamped; only the question of
// whether anything changed comes from the event.
//
// The job can move again while its documents are being stamped, and the event for
// that move may already have run and found them half done. So when the documents
// are stamped the job is read once more, and if its scope is no longer the one
// just stamped they are stamped again with the new one. That happens once at most:
// a job that keeps moving is covered by the event for each move.
//
// A batch that cannot be committed is logged, with the job and the error, and the
// batches after it still go. A document deleted between the read and the commit
// makes Firestore refuse its whole batch, and that batch stays as it was until the
// job's scope next changes or the backfill is run (a change order or a submission
// is also put right the next time it is written, by onExtraWritten and
// onSubmitWritten). Once everything has been tried the event fails with the first
// error, and every half that failed is logged before that.
//
// A failed run is not retried. Saving the job again, or the backfill, runs it again.
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

  // The two halves do not depend on each other, so one failing must not stop the other.
  const halves = [
    ['its tenant', before === null ? stampOwnTenant(ref) : null],
    ['its documents', stampDependents(ref, job)],
  ]
  const results = await Promise.allSettled(halves.map(([, work]) => work))
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[onJobWritten] Stamping ${halves[i][0]} for ${ref.path} failed:`, result.reason)
    }
  })
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
})

// Writes the legacy default tenant onto a job that has none. The job is read inside
// the transaction and written only if it still has none, so a tenant that was set
// since the job was last read is left as it is.
async function stampOwnTenant(ref) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const job = snap.data()
    if (nonEmptyString(job.tenantId)) return
    tx.update(ref, { tenantId: scopePatchFor(job).tenantId })
  })
}

// Gives every document that names the job the job's scope, then looks at the job once
// more and, if its scope moved while that was going on, gives them the newer one. Every
// failed batch is collected, and the first is thrown when both passes are done. A
// builder's submission left in its tenant is logged once, whichever pass found it.
async function stampDependents(ref, job) {
  if (!nonEmptyString(job.id)) {
    console.warn(`[onJobWritten] ${ref.path} has no id, so nothing that names it was stamped.`)
    return
  }
  const failures = []
  const kept = new Set()
  await stampPass(ref.path, job, failures, kept)

  const again = await ref.get()
  if (again.exists && needsRestamp(scopePatchFor(job), again.data())) {
    await stampPass(ref.path, again.data(), failures, kept)
  }
  if (failures.length > 0) throw failures[0]
}

// One pass: the documents that name the job and do not carry its scope are stamped, in
// batches, except a draft change order, which is skipped, and a submission a builder
// created in another tenant, which is logged and has its clientUids emptied when it
// lists any, once for the whole event (by the paths in kept, so a second pass writes
// nothing to it). A batch that fails is logged and added to failures, and the rest go on.
async function stampPass(path, job, failures, kept) {
  if (!nonEmptyString(job.id)) return
  const found = await Promise.all(
    SCOPED.map(({ collection, field }) => db.collection(collection).where(field, '==', job.id).get()),
  )
  // The role of each creator this pass has had to look up, each read once.
  const roles = new Map()
  const roleOf = (uid) => {
    if (!roles.has(uid)) roles.set(uid, db.doc(`users/${uid}`).get().then(roleIn))
    return roles.get(uid)
  }
  const updates = []
  for (const [i, snap] of found.entries()) {
    for (const doc of snap.docs) {
      const data = doc.data()
      if (isDraft(SCOPED[i].collection, data)) continue
      if (!needsRestamp(data, job)) continue
      if (SCOPED[i].collection === 'submits' && creatorDecides(data, job)
        && staysInTenant(data, job, await roleOf(creatorOf(data)))) {
        if (!kept.has(doc.ref.path)) {
          kept.add(doc.ref.path)
          const empty = listsClients(data)
          console.warn(keptInTenant('onJobWritten', doc.ref.path, data, job.id, job, empty))
          if (empty) updates.push([doc.ref, { clientUids: [] }])
        }
        continue
      }
      updates.push([doc.ref, scopePatchFor(job)])
    }
  }
  await commitUpdates(
    updates,
    (error, part) => {
      console.error(`[onJobWritten] ${part.length} of the documents for ${path} could not be stamped, and the rest went on:`, error)
      failures.push(error)
    },
  )
}

// ── onExtraWritten and onSubmitWritten ────────────────────────────────────────
// Fire on every create, update and delete of extras/{id} and submits/{id}. A client
// creates a submission with no tenant, and a change order written before scopes
// existed has none, so whenever one is written the job it names is looked up by its
// id and the document is given the job's tenantId and clientUids if it does not
// carry them. A document that already carries its job's scope produces no write, so
// the update this makes does not stamp anything again. A document whose job cannot
// be found is logged and left as it is, and so is one that names no job. A draft
// change order, as the transaction reads it, is left as it is too. A deleted
// document writes nothing.
//
// A submission a builder created that carries another tenant than its job keeps its
// tenant and is logged (see staysInTenant): the rules cannot see which tenant the job a
// builder names is in. When it lists clients its clientUids are emptied, which is the
// only write it gets, so the run that write fires finds nothing to do. Its creator is
// read inside the transaction, after the submission and the job, and only when its
// tenant differs from the job's. Every other submission follows its job. A change order
// is written by staff, who may point it at any job, so it always takes its job's scope.
//
// The document, the job and the write are one transaction. A change to the job
// while this runs (a client linked, say) therefore cannot be overwritten by the
// scope this read before it. All the reads come first, as Firestore requires.
export const onExtraWritten = onDocumentWritten({ document: 'extras/{id}', region }, (event) =>
  stampFromJob('onExtraWritten', event, 'job', { skipDrafts: true }),
)

export const onSubmitWritten = onDocumentWritten({ document: 'submits/{id}', region }, (event) =>
  stampFromJob('onSubmitWritten', event, 'jobId', { pinBuilders: true }),
)

// The role in a users document snapshot, or null when there is none.
const roleIn = (snap) => (snap.exists ? (snap.data()?.role ?? null) : null)

// The line logged when a builder's submission is left in its tenant rather than moved
// to its job's, and says so when its clientUids are emptied too.
const keptInTenant = (name, path, doc, jobId, job, emptied = false) =>
  `[${name}] ${path} was created by a builder and carries tenant ${doc.tenantId}, but its job ${jobId} is in tenant ${scopePatchFor(job).tenantId}, so it was ${emptied ? 'left in its tenant with its clientUids emptied' : 'left as it is'}.`

async function stampFromJob(name, event, field, { pinBuilders = false, skipDrafts = false } = {}) {
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
    if (skipDrafts && extraState(doc) === 'draft') return
    const jobId = jobIdOf(doc, field)
    if (jobId === null) return

    const found = await tx.get(db.collection('jobs').where('id', '==', jobId).limit(1))
    if (found.empty) {
      console.warn(`[${name}] ${ref.path} names job ${jobId}, which was not found, so it was left as it is.`)
      return
    }
    const job = found.docs[0].data()
    if (!needsRestamp(doc, job)) return
    if (pinBuilders && creatorDecides(doc, job)) {
      const creator = await tx.get(db.collection('users').doc(creatorOf(doc)))
      if (staysInTenant(doc, job, roleIn(creator))) {
        const empty = listsClients(doc)
        console.warn(keptInTenant(name, ref.path, doc, jobId, job, empty))
        if (empty) tx.update(ref, { clientUids: [] })
        return
      }
    }
    tx.update(ref, scopePatchFor(job))
  })
}

// What the owner reads when the run stops. Whatever went wrong is logged in full.
const BACKFILL_FAILED = 'The backfill stopped before it finished. It is safe to run again.'

// ── backfillScopes ────────────────────────────────────────────────────────────
// Owner only; the guard runs before anything is read. Reads whole collections, which
// is fine for a tool the owner runs when scopes first go in or after an import, and
// writes in batches. It goes in this order, and each step is counted:
//   users          Sets the Auth claims of every user with a valid role, as
//                  onUserWritten sets them for a new one (so nobody is signed out).
//                  The users are visited one at a time and a long run can take a
//                  while, so each user's document is read again when their turn
//                  comes: a role changed since the scan is never put back, and a
//                  document that is gone, or no longer has a valid role, is left
//                  alone and logged. Like onUserWritten it will not lower an owner
//                  or internal account, and it skips a user with no Auth account.
//   jobs           Sets every job's tenantId (its own, or qbs when it has none) and
//                  its clientUids to exactly the clients whose users document lists
//                  the job, so a stale link goes. The links come from a scan of the
//                  users taken after the claims are done and just before the jobs
//                  are written. Every job is written, even one that was already
//                  right, so the count shows the run covered them.
//   extras,        Gives every change order (job), submission and notification
//   submits,       (jobId) the scope of the job it names. One that names no job, or
//   notifications  a job that does not exist, is left alone, and so is a submission a
//                  builder created that carries a tenant other than its job's, which
//                  is logged (its creator's role comes from the users scan below) and,
//                  when it lists clients, has its clientUids emptied and is counted
//                  with the submissions written. A draft change order is never
//                  stamped: one that carries a tenantId or clientUids has both
//                  deleted in one update, and one that carries neither is left alone.
// Returns { ok: true, users, jobs, extras, submits, notifications, skipped,
// draftsCleared }, where skipped is how many of those documents were left alone and
// draftsCleared how many drafts had their scope deleted.
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
  // Whom to visit. Only the ids come from this scan: the claims of each user are worked
  // out from their document as it is when their turn comes (see setClaims).
  const uids = (await db.collection('users').get()).docs.map((doc) => doc.id)
  const claimed = await setClaims(uids)

  // The job links come from the users as they are after that, read just before the jobs
  // are written, and not from the scan above: a client added, removed or demoted while the
  // claims were being set is linked or unlinked as they stand now. The jobs are read first
  // so that this scan is the last read before the writes.
  const jobDocs = (await db.collection('jobs').get()).docs
  const users = (await db.collection('users').get()).docs.map((doc) => ({ uid: doc.id, data: doc.data() }))

  // The scope each job ends up with, by the job's own id. The documents that name a job
  // take it from here, so they get the same clientUids the job just did.
  const links = clientLinks(users)
  const roles = new Map(users.map(({ uid, data }) => [uid, data?.role ?? null]))
  const scopes = new Map()
  const jobWrites = []
  for (const doc of jobDocs) {
    const job = doc.data()
    const scope = { tenantId: scopePatchFor(job).tenantId, clientUids: [...(links.get(job.id) ?? [])] }
    if (nonEmptyString(job.id)) scopes.set(job.id, scope)
    jobWrites.push([doc.ref, scope])
  }
  await commitUpdates(jobWrites)

  const stamped = {}
  let skipped = 0
  let draftsCleared = 0
  for (const { collection, field } of SCOPED) {
    const writes = []
    let stamps = 0
    for (const doc of (await db.collection(collection).get()).docs) {
      const data = doc.data()
      const jobId = jobIdOf(data, field)
      const scope = scopes.get(jobId)
      if (isDraft(collection, data)) {
        if ('tenantId' in data || 'clientUids' in data) {
          writes.push([doc.ref, { tenantId: FieldValue.delete(), clientUids: FieldValue.delete() }])
          draftsCleared += 1
        } else {
          skipped += 1
        }
      } else if (!scope) {
        skipped += 1
      } else if (collection === 'submits' && staysInTenant(data, scope, roles.get(creatorOf(data)) ?? null)) {
        const empty = listsClients(data)
        console.warn(keptInTenant('backfillScopes', doc.ref.path, data, jobId, scope, empty))
        if (empty) {
          writes.push([doc.ref, { clientUids: [] }])
          stamps += 1
        } else {
          skipped += 1
        }
      } else {
        writes.push([doc.ref, { tenantId: scope.tenantId, clientUids: [...scope.clientUids] }])
        stamps += 1
      }
    }
    await commitUpdates(writes)
    stamped[collection] = stamps
  }

  return {
    ok: true,
    users: claimed,
    jobs: jobWrites.length,
    extras: stamped.extras,
    submits: stamped.submits,
    notifications: stamped.notifications,
    skipped,
    draftsCleared,
  }
}

// Sets the claims of every user with a valid role, the way a first assignment does
// (claimsPatchFor with no previous document, so no refresh tokens are revoked).
// Returns how many users had their claims set.
//
// The document of each user is read here, when their turn comes, and not taken from the
// scan that listed the users: the loop makes calls to Auth one user at a time and can
// take a while, and a role changed since the scan (internal staff demoted to a client, a
// client made staff) must not be put back. A document that is gone, or that no longer
// has a valid role, gets no claims and is logged. What this does not cover is a change in
// the moment between that read and the write below, the same small window onUserWritten
// has between two of its own runs.
async function setClaims(uids) {
  const auth = getAuth()
  let set = 0
  for (const uid of uids) {
    try {
      const snap = await db.doc(`users/${uid}`).get()
      if (!snap.exists) {
        console.warn(`[backfillScopes] users/${uid} is gone, so no claims were set.`)
        continue
      }
      const { claims } = claimsPatchFor(null, snap.data())
      if (!claims || claims.role === null) {
        console.warn(`[backfillScopes] users/${uid} has no valid role, so no claims were set.`)
        continue
      }
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
