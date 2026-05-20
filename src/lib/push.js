// Push notifications — web (FCM) + native (Capacitor).
//
// Web requires a VAPID public key (Firebase console → Project settings →
// Cloud Messaging → Web Push certificates) supplied as VITE_FCM_VAPID_KEY.
// Native (iOS/Android via Capacitor) requires FCM/APNs credentials configured
// in the Firebase console and the platform projects — see PUSH_SETUP.md.
//
// Device tokens are stored in Firestore `fcm_tokens/{token}`; the
// onNotificationCreated Cloud Function fans out to them.

import { getToken, onMessage } from 'firebase/messaging'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth, getMessagingIfSupported } from '../firebase'

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY || ''

async function saveToken(token, platform) {
  if (!token) return
  await setDoc(doc(db, 'fcm_tokens', token), {
    token,
    platform,
    uid:       auth.currentUser?.uid || null,
    email:     auth.currentUser?.email || null,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

// True when running inside a Capacitor native shell.
function isNative() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
}

async function enableNativePush() {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') throw new Error('Notification permission was denied.')

  return new Promise((resolve, reject) => {
    PushNotifications.addListener('registration', async (t) => {
      try { await saveToken(t.value, window.Capacitor.getPlatform()); resolve(t.value) }
      catch (e) { reject(e) }
    })
    PushNotifications.addListener('registrationError', (e) => reject(new Error(e?.error || 'Push registration failed.')))
    PushNotifications.register()
  })
}

async function enableWebPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('This browser does not support push notifications.')
  }
  if (!VAPID_KEY) throw new Error('Web push is not configured yet (missing VITE_FCM_VAPID_KEY).')

  const messaging = await getMessagingIfSupported()
  if (!messaging) throw new Error('Push messaging is unavailable in this browser.')

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notification permission was denied.')

  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg })
  await saveToken(token, 'web')

  // Foreground messages don't auto-display — show them manually.
  onMessage(messaging, (payload) => {
    const n = payload.notification || {}
    if (Notification.permission === 'granted') {
      new Notification(n.title || 'P2 Field Control', { body: n.body || '', icon: '/p2-mark.svg' })
    }
  })
  return token
}

// Request permission and register this device for push. Returns the token.
export async function enablePushNotifications() {
  return isNative() ? enableNativePush() : enableWebPush()
}
