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

// For code that handles an error itself, such as useMutation, and still wants it in the log
// that an unhandled one would have reached. It never throws and never shows anything, because
// it is the logger of last resort: a failure of the log is not worth an error of its own.
export function logError(error, source = 'unknown') {
  try {
    writeLog(error?.message || String(error), error?.stack, source)
  } catch {
    // Nothing is left to tell.
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
