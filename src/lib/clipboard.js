// Browser clipboard with graceful fallback. Returns a promise that resolves
// to true on success or false on failure (no clipboard API, denied permission,
// or insecure context).
export async function copyText(text) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return false
  try {
    await navigator.clipboard.writeText(String(text ?? ''))
    return true
  } catch {
    return false
  }
}
