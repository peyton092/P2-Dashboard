// What a person reads when a write or a Cloud Function call fails.
//
// The functions write their errors for people (HttpsError messages such as "This
// change order has already been decided."), so those are shown as they are. When
// no reply reaches the browser, or the reply has a status but no message, the
// Functions SDK uses the code ("internal") or the status name ("INTERNAL",
// "NOT_FOUND") as the message, which says nothing, so that gets the fallback.
// "functions/not-found", "NOT_FOUND" and "Not-Found" all name the same status.
//
// A Firestore error carries a bare code ("permission-denied") and a message written for
// developers ("Missing or insufficient permissions.", "No document to update: jobs/abc"),
// which is not shown. A few codes have a plain sentence of their own, below, and every
// other error that carries a code, such as a sign in or storage one, gets the fallback.
//
// An error with no code at all is not the SDK's. This app threw it, in words meant for the
// person, and it is shown as it is.
const statusName = (text) => String(text).toLowerCase().replace(/^functions\//, '').replace(/_/g, '-')

const SERVER_UNREACHABLE = 'Could not reach the server. Try again.'
const FIRESTORE_SENTENCES = {
  'permission-denied': 'You do not have permission to do that.',
  'unauthenticated': 'Sign in again and try once more.',
  'unavailable': SERVER_UNREACHABLE,
  'deadline-exceeded': SERVER_UNREACHABLE,
  'not-found': 'That record is no longer there.',
  'already-exists': 'That record already exists.',
  'failed-precondition': 'That cannot be done right now. Refresh the page and try again.',
  'resource-exhausted': 'Too many requests right now. Wait a moment and try again.',
}

export function callableMessage(err, fallback) {
  const code = typeof err?.code === 'string' ? err.code : null
  if (code !== null && !code.startsWith('functions/')) return FIRESTORE_SENTENCES[statusName(code)] ?? fallback
  const bareCode = code !== null && statusName(err.message) === statusName(code)
  return err?.message && !bareCode ? err.message : fallback
}
