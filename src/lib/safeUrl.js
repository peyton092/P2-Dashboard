// Returns the normalized href when `u` is an https URL without embedded
// credentials, otherwise null. Use before putting any stored URL into an
// href or src attribute.
export function safeHttpUrl(u) {
  if (typeof u !== 'string') return null
  let parsed
  try {
    parsed = new URL(u)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  return parsed.href
}
