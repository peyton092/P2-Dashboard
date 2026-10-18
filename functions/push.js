// ============================================================================
//  Push notifications
//  Fan out a push to the devices of the people a notification is for, whenever
//  a notification doc is created. Devices register via src/lib/push.js →
//  fcm_tokens/{token}, along with the uid that was signed in. This ties into
//  existing app events (CO approvals, inspection results, billing) that
//  already write to the notifications collection.
//
//  Who a notification is for is decided by lib/push-targets.js, from the
//  notification's tenantId, clientUids and jobId and the users document of each
//  device's owner: staff get every notification, a builder the ones that carry
//  their tenant, a client the ones that list them or name one of their jobs. A
//  builder's tenant is read as the claims sync reads it, so only qbs or vision
//  counts. A notification with none of those fields reaches staff only. A device
//  that recorded no uid, or whose uid has no users document, gets nothing.
// ============================================================================

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { db } from './lib/admin.js'
import { region } from './lib/config.js'
import { chunks } from './lib/batches.js'
import { groupTokens, targetTokens } from './lib/push-targets.js'
import { nonEmptyString } from './lib/scope.js'
import { tenantForRole } from './lib/users-validate.js'

// What a person reads on the lock screen carries no dashes, in a title or a body.
const NOTIF_TITLE = {
  error:   'P2 Field Control: action needed',
  warn:    'P2 Field Control: heads up',
  success: 'P2 Field Control: update',
  info:    'P2 Field Control',
}

// The users documents are read ten at a time, and FCM takes at most 500 tokens in
// one multicast.
const USER_CHUNK = 10
const MULTICAST_LIMIT = 500

// The users documents of these uids, as { [uid]: { role, tenantId, clientJobIds } }:
// the fields push-targets.js reads. The tenant is the one the claims sync gives the
// account (tenantForRole): a builder keeps qbs or vision and otherwise has none, so a
// builder whose document names any other tenant matches no tenant scoped push, as the
// rules show them nothing scoped. A uid whose document does not exist is left out,
// which leaves its devices out of the fan out. So is a uid that cannot name a
// document (not a string, empty, or holding a slash, which would point the path
// somewhere else), so that one odd token cannot stop everyone else's push.
async function loadUsers(uids) {
  const named = [...new Set(uids)].filter((uid) => nonEmptyString(uid) && !uid.includes('/'))
  const entries = []
  for (const part of chunks(named, USER_CHUNK)) {
    const snaps = await db.getAll(...part.map((uid) => db.collection('users').doc(uid)))
    for (const snap of snaps) {
      if (!snap.exists) continue
      const { role, tenantId, clientJobIds } = snap.data()
      entries.push([snap.id, { role, tenantId: tenantForRole(role, tenantId), clientJobIds }])
    }
  }
  return Object.fromEntries(entries)
}

// Reads the registered devices, then the users documents of the people they belong
// to as they are now, and sends to the devices of the people the notification is for,
// in multicasts of at most 500 tokens. Nothing is sent when no device is registered
// or none is in scope, and one line says so for the second case. A users read that
// fails fails the event with nothing sent, rather than guessing who may have the push.
// Tokens FCM reports as permanently invalid are deleted afterwards.
export const onNotificationCreated = onDocumentCreated({ document: 'notifications/{id}', region }, async (event) => {
  const data = event.data?.data() || {}
  const body = data.msg || 'New activity on your projects.'
  // A type that is not one of the four, including a name every object has, gets the plain title.
  const title = Object.hasOwn(NOTIF_TITLE, data.type) ? NOTIF_TITLE[data.type] : NOTIF_TITLE.info

  const devices = groupTokens(await db.collection('fcm_tokens').get())
  if (devices.length === 0) return

  const usersById = await loadUsers(devices.map((device) => device.uid))
  const tokens = targetTokens(data, devices, usersById)
  if (tokens.length === 0) {
    console.log(`[onNotificationCreated] No registered device is in scope for notifications/${event.params.id}, so no push was sent.`)
    return
  }

  // Prune tokens the FCM backend reports as permanently invalid.
  const dead = []
  for (const part of chunks(tokens, MULTICAST_LIMIT)) {
    const res = await getMessaging().sendEachForMulticast({ notification: { title, body }, tokens: part })
    res.responses.forEach((r, i) => {
      const code = r.error?.code
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument')) {
        dead.push(part[i])
      }
    })
  }
  await Promise.all(dead.map((t) => db.collection('fcm_tokens').doc(t).delete()))
})
