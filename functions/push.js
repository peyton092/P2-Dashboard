// ============================================================================
//  Push notifications
//  Fan out a push to every registered device whenever a notification doc is
//  created. Devices register via src/lib/push.js → fcm_tokens/{token}. This
//  ties into existing app events (CO approvals, inspection results, billing)
//  that already write to the notifications collection.
// ============================================================================

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { db } from './lib/admin.js'
import { region } from './lib/config.js'

const NOTIF_TITLE = {
  error:   'P2 — Action needed',
  warn:    'P2 — Heads up',
  success: 'P2 — Update',
  info:    'P2 Field Control',
}

export const onNotificationCreated = onDocumentCreated({ document: 'notifications/{id}', region }, async (event) => {
  const data = event.data?.data() || {}
  const body = data.msg || 'New activity on your projects.'

  const tokensSnap = await db.collection('fcm_tokens').get()
  const tokens = tokensSnap.docs.map(d => d.id).filter(Boolean)
  if (tokens.length === 0) return

  const res = await getMessaging().sendEachForMulticast({
    notification: { title: NOTIF_TITLE[data.type] || NOTIF_TITLE.info, body },
    tokens,
  })

  // Prune tokens the FCM backend reports as permanently invalid.
  const dead = []
  res.responses.forEach((r, i) => {
    const code = r.error?.code
    if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument')) {
      dead.push(tokens[i])
    }
  })
  await Promise.all(dead.map(t => db.collection('fcm_tokens').doc(t).delete()))
})
