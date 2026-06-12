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

// Manual error sink for caught exceptions inside handlers. Mirrors the
// auto-hook sinks so a handler-caught error lands in the same Firestore
// `error_logs` collection as an unhandled crash. Still logs to the console
// in dev so the existing debug workflow is preserved.
export function logError(source, err, extra) {
  const message = err?.message || String(err || extra || 'error')
  writeLog(extra ? `${message} — ${extra}` : message, err?.stack, source)
  if (import.meta.env?.DEV) {
    console.error(`[${source}]`, err, extra ?? '')
  }
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
