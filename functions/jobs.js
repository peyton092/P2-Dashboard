// ============================================================================
//  Jobs
//
//    createJob  Staff only. Creates a job and writes the notification and the
//               history line, in one transaction.
//
//  data: the job as the New Job form builds it. It needs an id like QBS-001, a
//  street address, a client and a tenant (p2-core, qbs or vision); a name is
//  optional, and the other fields are copied through when they are plain enough
//  (see lib/jobs.js). The id has to be new. The server sets clientUids to [] (the
//  clients are linked to the job by their own accounts), and createdBy,
//  createdByEmail and createdAt, whatever the caller sent. Returns
//  { ok: true, docId } with the new job's document id.
//
//  The rules (what is required, what is copied, the wording) live in lib/jobs.js,
//  which imports no Firestore and is unit tested directly.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './lib/admin.js'
import { requireStaff } from './lib/authz.js'
import { region } from './lib/config.js'
import { actorOf } from './lib/actor.js'
import { historyDoc, notificationDoc } from './lib/activity.js'
import { jobActivity, validateNewJob } from './lib/jobs.js'

export const createJob = onCall({ region, cors: true }, async (req) => {
  await requireStaff(req)

  const checked = validateNewJob(req.data)
  if (!checked.ok) throw new HttpsError('invalid-argument', checked.message)
  const { id, tenantId, fields } = checked.value

  const actor = await actorOf(req)
  const ref = db.collection('jobs').doc()

  await db.runTransaction(async (tx) => {
    const taken = await tx.get(db.collection('jobs').where('id', '==', id).limit(1))
    if (!taken.empty) throw new HttpsError('already-exists', 'A job with that ID already exists.')

    const job = {
      ...fields,
      id,
      tenantId,
      clientUids: [],
      createdBy: actor.uid,
      createdByEmail: actor.email,
      createdAt: FieldValue.serverTimestamp(),
    }
    const activity = jobActivity(job, actor)

    tx.set(ref, job)
    tx.set(
      db.collection('notifications').doc(),
      notificationDoc({ type: activity.type, msg: activity.msg, jobId: id, scope: { tenantId, clientUids: [] }, actor }),
    )
    tx.set(
      db.collection('history').doc(),
      historyDoc({ type: 'job', action: activity.action, summary: activity.summary, jobId: id, actor }),
    )
  })

  return { ok: true, docId: ref.id }
})
