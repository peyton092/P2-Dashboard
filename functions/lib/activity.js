// The documents a privileged change writes next to the change itself: the
// notification people are alerted by, and the history line the Activity feed
// shows. Pure, so they are unit tested without Firestore.
//
// Both carry who did it (createdBy, createdByEmail) like every document the
// functions create. The actor is always built from the signed in caller (see
// actor.js), never from anything the caller sent.

import { FieldValue } from 'firebase-admin/firestore'

// type: success, warn, info or error (what push.js titles the alert by).
// scope: { tenantId, clientUids } of the job the alert is about, so the
// notification can be read by the builder tenant and the clients of that job.
export function notificationDoc({ type, msg, jobId, scope, actor }) {
  return {
    type,
    msg,
    jobId: jobId ?? null,
    tenantId: scope.tenantId,
    clientUids: [...scope.clientUids],
    createdBy: actor.uid,
    createdByEmail: actor.email,
    createdAt: FieldValue.serverTimestamp(),
    read: false,
  }
}

// The Activity feed reads type, summary, actor (as text) and jobId. type is
// change-order, inspection or job. extraId is only for change orders.
export function historyDoc({ type, action, summary, jobId, extraId, actor }) {
  return {
    type,
    action,
    summary,
    actor: actor.displayName,
    actorUid: actor.uid,
    actorEmail: actor.email,
    jobId: jobId ?? null,
    ...(extraId ? { extraId } : {}),
    createdBy: actor.uid,
    createdByEmail: actor.email,
    createdAt: FieldValue.serverTimestamp(),
  }
}
