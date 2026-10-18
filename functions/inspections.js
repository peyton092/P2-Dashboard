// ============================================================================
//  Inspection results
//
//    passInspection  Staff only. Marks one phase of one trade's inspection on a
//                    job as passed, dated today.
//    failInspection  The same, as failed.
//
//  data: { jobDocId, trade, phase }, where jobDocId is the job's Firestore
//  document id, trade is electrical, plumbing or hvac, and phase is one the
//  trade has (electrical: roughIn, trim, final; plumbing and hvac: roughIn,
//  final). Each call sets insp.{trade}.{phase} and insp.{trade}.{phase}Date on
//  the job and writes the notification and the history line, in one transaction.
//  Both return { ok: true }.
//
//  The rules (which phases exist, the update, the wording) live in
//  lib/inspections.js, which imports no Firestore and is unit tested directly.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from './lib/admin.js'
import { requireStaff } from './lib/authz.js'
import { region } from './lib/config.js'
import { actorOf } from './lib/actor.js'
import { historyDoc, notificationDoc } from './lib/activity.js'
import { scopeForJob } from './lib/scope.js'
import { inspectionActivity, inspectionPatch, validateInspection } from './lib/inspections.js'

const JOB_GONE = 'That job no longer exists.'

export const passInspection = onCall({ region, cors: true }, async (req) => {
  await requireStaff(req)
  return recordInspection(req, 'passed')
})

export const failInspection = onCall({ region, cors: true }, async (req) => {
  await requireStaff(req)
  return recordInspection(req, 'failed')
})

async function recordInspection(req, result) {
  const checked = validateInspection(req.data)
  if (!checked.ok) throw new HttpsError('invalid-argument', checked.message)
  const { jobDocId, trade, phase } = checked.value

  const actor = await actorOf(req)
  const ref = db.collection('jobs').doc(jobDocId)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', JOB_GONE)
    const job = snap.data()

    const activity = inspectionActivity(job, trade, phase, result)
    const jobId = typeof job.id === 'string' && job.id !== '' ? job.id : null

    tx.update(ref, inspectionPatch(trade, phase, result))
    tx.set(
      db.collection('notifications').doc(),
      notificationDoc({ type: activity.type, msg: activity.msg, jobId, scope: scopeForJob(job), actor }),
    )
    tx.set(
      db.collection('history').doc(),
      historyDoc({ type: 'inspection', action: activity.action, summary: activity.summary, jobId, actor }),
    )
  })

  return { ok: true }
}
