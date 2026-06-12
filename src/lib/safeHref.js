// safeHref — sanitize a user-/database-supplied URL before binding it to an
// anchor's href. Firestore operational docs (job.paymentUrl, file.url, …) are
// writable by any signed-in user under the current rules, so a malicious value
// like `javascript:…` or `data:text/html,…` would execute on click. Allow only
// http(s), mailto, and tel; anything else collapses to undefined so React drops
// the attribute and the link becomes inert.
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i

export function safeHref(url) {
  if (typeof url !== 'string') return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined
  // Protocol-relative (//host) and root-relative (/path) links are safe.
  if (trimmed.startsWith('//') || trimmed.startsWith('/')) return trimmed
  return SAFE_SCHEME.test(trimmed) ? trimmed : undefined
}
