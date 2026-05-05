import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'

function writeLog(message, stack, source) {
  const userEmail = auth?.currentUser?.email || 'anonymous'
  addDoc(collection(db, 'error_logs'), {
    message: String(message).slice(0, 1000),
    stack: String(stack || '').slice(0, 3000),
    source: source || 'unknown',
    userEmail,
    url: window.location.href,
    timestamp: serverTimestamp(),
  }).catch(() => {})
}

export function initErrorLogger() {
  window.addEventListener('error', (e) => {
    writeLog(e.message, e.error?.stack, e.filename || 'window.error')
  })

  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason
    const message = err?.message || String(err)
    const stack = err?.stack || ''
    writeLog(message, stack, 'unhandledrejection')
  })
}
