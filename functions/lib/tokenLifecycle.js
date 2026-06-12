// Token-lifecycle helpers shared by the CompanyCam / QuickBooks Cloud
// Function wrappers in functions/index.js. The actual HTTP refresh + Firestore
// I/O live in the wrappers; this module just decides "should we refresh now?"
// and "what should we write back after a successful refresh?".
//
// Pure. No firebase-admin imports — unit-tested directly.

// Default skew: a token that expires within 60 seconds is treated as stale so
// we refresh BEFORE making the API call rather than racing the boundary.
export const DEFAULT_TOKEN_SKEW_MS = 60_000

// True if the stored token has an `expires_at` that's within `skewMs` of `now`
// (or already past it). A missing `expires_at` is interpreted as "long-lived,
// no known expiry" → never stale by time alone.
//
// Caller is responsible for the higher-level "can we even refresh?" question —
// e.g., a stale token with no refresh_token is still the best one we have.
export function isTokenStale(tokens, now, skewMs = DEFAULT_TOKEN_SKEW_MS) {
  if (!tokens || typeof tokens !== 'object') return false
  const expiresAt = tokens.expires_at
  if (expiresAt == null) return false // long-lived
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return false
  return expiresAt - now <= skewMs
}

// Build the Firestore merge payload to persist a successful token refresh.
// Preserves the prior refresh_token when the refresh response doesn't return a
// new one (some OAuth providers rotate, others reuse). When the response has
// no `expires_in`, we clear `expires_at` to null — i.e. treat the new token as
// long-lived, matching the upstream provider's signal.
export function buildRefreshedTokenDoc(existing, fresh, now) {
  const e = existing || {}
  const f = fresh || {}
  return {
    access_token:  f.access_token,
    refresh_token: f.refresh_token || e.refresh_token,
    expires_at:    typeof f.expires_in === 'number' && f.expires_in > 0
      ? now + f.expires_in * 1000
      : null,
  }
}
