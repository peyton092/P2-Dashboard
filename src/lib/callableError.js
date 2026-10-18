// What a person reads when a Cloud Function call fails.
//
// The functions write their errors for people (HttpsError messages such as "This
// change order has already been decided."), so those are shown as they are. When
// no reply reaches the browser, or the reply has a status but no message, the
// Functions SDK uses the code ("internal") or the status name ("INTERNAL",
// "NOT_FOUND") as the message, which says nothing, so that gets the fallback.
// "functions/not-found", "NOT_FOUND" and "Not-Found" all name the same status.
const statusName = (text) => String(text).toLowerCase().replace(/^functions\//, '').replace(/_/g, '-')

export function callableMessage(err, fallback) {
  const bareCode = typeof err?.code === 'string' && statusName(err.message) === statusName(err.code)
  return err?.message && !bareCode ? err.message : fallback
}
