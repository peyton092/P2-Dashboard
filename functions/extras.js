// ============================================================================
//  Change orders
//
//    sendExtraToBuilder  Staff only. Sends a change order to the builder for
//                        approval (a draft, or one revised after a rejection).
//    approveExtra        Approves a change order that is waiting for a decision.
//    rejectExtra         Asks for a revision of one, with a note saying what.
//
//  approveExtra and rejectExtra take an optional expectedTotal, the total the
//  person was shown. When it is sent and the stored total (total, else amount,
//  else 0) is another, the call is refused before anything is written, so nobody
//  decides a change order at a total they never saw.
//
//  Approving and rejecting are open to whoever may act on the change order:
//  staff, the builder whose tenant owns it, and the clients linked to its job
//  (canActOnExtra). The browser no longer writes any of this itself. Each call
//  changes the change order and writes the notification and the history line in
//  one transaction, so a change order is never decided twice and never changes
//  without a record of who did it.
//
//  The rules (what each action changes, what is refused, the wording) live in
//  lib/extras.js, which imports no Firestore and is unit tested directly.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from './lib/admin.js'
import { requireAuth, requireStaff } from './lib/authz.js'
import { region } from './lib/config.js'
import { actorOf } from './lib/actor.js'
import { cleanDocId } from './lib/doc-id.js'
import { historyDoc, notificationDoc } from './lib/activity.js'
import { canActOnExtra, scopeForJob } from './lib/scope.js'
import {
  NOTE_REQUIRED, TOTAL_CHANGED, cleanRevisionNote, extraActivity, extraState, extraTransition, totalChanged,
} from './lib/extras.js'

export { extraState, extraTransition }

const EXTRA_GONE = 'That change order no longer exists.'
const JOB_GONE = 'That job no longer exists.'
const NOT_YOURS = 'You can only act on change orders for your own projects.'

// ── The three callables ───────────────────────────────────────────────────────
// data: { extraId, note?, expectedTotal? }. The guard runs first, before anything
// is read. Each returns { ok: true }.

export const sendExtraToBuilder = onCall({ region, cors: true }, async (req) => {
  const claims = await requireStaff(req)
  return applyAction(req, claims, 'send')
})

export const approveExtra = onCall({ region, cors: true }, async (req) => {
  const claims = await requireAuth(req)
  return applyAction(req, claims, 'approve')
})

// The note is required: it is what the builder or client wants revised.
export const rejectExtra = onCall({ region, cors: true }, async (req) => {
  const claims = await requireAuth(req)
  return applyAction(req, claims, 'reject')
})

// Reads the change order, checks the caller may act on it, that the action applies
// to its state and, for an approval or a revision request, that its total is the
// one the caller was shown, then writes the change, the notification and the
// history line together. All of it happens inside one transaction, so two people
// deciding at once cannot both succeed. A refusal throws before anything is written.
async function applyAction(req, claims, action) {
  const extraId = cleanDocId(req.data?.extraId)
  if (extraId === null) throw new HttpsError('invalid-argument', 'Choose a change order.')

  // A revision with no note can never succeed, so it is refused before any read.
  const note = req.data?.note
  if (action === 'reject' && cleanRevisionNote(note) === null) {
    throw new HttpsError('invalid-argument', NOTE_REQUIRED)
  }

  const actor = await actorOf(req)
  const ref = db.collection('extras').doc(extraId)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', EXTRA_GONE)
    const extra = snap.data()

    const { scoped, stamp } = await scopeOf(tx, extra, action)
    if (!canActOnExtra(claims, scoped)) throw new HttpsError('permission-denied', NOT_YOURS)

    const patch = extraTransition(extra, action, actor, note)
    if (action !== 'send' && totalChanged(extra, req.data?.expectedTotal)) {
      throw new HttpsError('failed-precondition', TOTAL_CHANGED)
    }
    const activity = extraActivity(extra, action, actor, note)
    const jobId = typeof extra.job === 'string' && extra.job !== '' ? extra.job : null

    tx.update(ref, { ...patch, ...stamp })
    tx.set(
      db.collection('notifications').doc(),
      notificationDoc({ type: activity.type, msg: activity.msg, jobId, scope: scopeForJob(scoped), actor }),
    )
    tx.set(
      db.collection('history').doc(),
      historyDoc({
        type: 'change-order',
        action: activity.action,
        summary: activity.summary,
        jobId,
        extraId,
        actor,
      }),
    )
  })

  return { ok: true }
}

// The extra as the access check should see it, and the scope to write onto it.
//
// A change order carries the tenantId and clientUids of its job once it has been
// stamped. One written before that has neither, so its job (found by the job's
// own id, like QBS-003) says who may act on it. Its scope is then written onto
// the change order along with the change, so it is stamped from then on. An
// already stamped change order is used as it is and nothing is added to it.
//
// The exception is a draft that is being sent. A draft is not meant to carry a scope
// (the stamping triggers delete one), so a scope it does carry is not trusted: whatever
// it holds, the scope comes from the job, as it does for a change order that was never
// stamped, and the update that sends the draft writes it over the carried one. A draft
// that is approved or sent back for revision is refused whatever scope it carries.
async function scopeOf(tx, extra, action) {
  const draftBeingSent = action === 'send' && extraState(extra) === 'draft'
  const stamped = !draftBeingSent
    && typeof extra.tenantId === 'string' && extra.tenantId !== '' && Array.isArray(extra.clientUids)
  if (stamped) return { scoped: extra, stamp: {} }

  if (typeof extra.job !== 'string' || extra.job === '') throw new HttpsError('not-found', JOB_GONE)
  const found = await tx.get(db.collection('jobs').where('id', '==', extra.job).limit(1))
  if (found.empty) throw new HttpsError('not-found', JOB_GONE)

  const scope = scopeForJob(found.docs[0].data())
  return { scoped: { ...extra, ...scope }, stamp: scope }
}
