/* Firebase Cloud Messaging service worker (web push, background messages).
   Service workers can't read Vite env vars, so the public Firebase config is
   inlined here (same values as src/firebase.js — safe to expose). */
/* global importScripts, firebase */

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyDm5I5iCbe3_0IZdtabw4WYTMW1YTaL9R4',
  authDomain: 'p2-dashboard.firebaseapp.com',
  projectId: 'p2-dashboard',
  storageBucket: 'p2-dashboard.firebasestorage.app',
  messagingSenderId: '666712594799',
  appId: '1:666712594799:web:48a3a87f6557fdd5e3b09a',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {}
  self.registration.showNotification(n.title || 'P2 Field Control', {
    body: n.body || '',
    icon: '/p2-mark.svg',
    badge: '/p2-mark.svg',
  })
})
