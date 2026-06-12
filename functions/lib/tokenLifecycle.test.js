import { describe, it, expect } from 'vitest'
import {
  isTokenStale,
  buildRefreshedTokenDoc,
  DEFAULT_TOKEN_SKEW_MS,
} from './tokenLifecycle.js'

const NOW = 1_700_000_000_000

// ── isTokenStale ──────────────────────────────────────────────────────────────

describe('isTokenStale', () => {
  it('returns false for a token whose expiry is well in the future', () => {
    expect(isTokenStale({ expires_at: NOW + 5 * 60_000 }, NOW)).toBe(false)
  })

  it('returns true for an already-expired token', () => {
    expect(isTokenStale({ expires_at: NOW - 1_000 }, NOW)).toBe(true)
  })

  it('returns true within the default 60-second skew window', () => {
    // Anything inside the skew is "about to expire" → refresh proactively.
    expect(isTokenStale({ expires_at: NOW + 30_000 }, NOW)).toBe(true)
    expect(isTokenStale({ expires_at: NOW + 59_999 }, NOW)).toBe(true)
  })

  it('boundary: a token expiring exactly at now + skew IS stale', () => {
    expect(isTokenStale({ expires_at: NOW + DEFAULT_TOKEN_SKEW_MS }, NOW)).toBe(true)
  })

  it('boundary: one ms past the skew window is NOT stale', () => {
    expect(isTokenStale({ expires_at: NOW + DEFAULT_TOKEN_SKEW_MS + 1 }, NOW)).toBe(false)
  })

  it('treats null/undefined expires_at as long-lived (never stale by time alone)', () => {
    expect(isTokenStale({ expires_at: null }, NOW)).toBe(false)
    expect(isTokenStale({ expires_at: undefined }, NOW)).toBe(false)
    expect(isTokenStale({}, NOW)).toBe(false)
  })

  it('ignores non-numeric expires_at rather than throwing', () => {
    // Defensive — a hand-edited doc with garbage in expires_at shouldn't
    // crash the sync; treat the token as long-lived and let the caller
    // decide on the refresh.
    expect(isTokenStale({ expires_at: 'soon' }, NOW)).toBe(false)
    expect(isTokenStale({ expires_at: NaN }, NOW)).toBe(false)
    expect(isTokenStale({ expires_at: Infinity }, NOW)).toBe(false)
  })

  it('returns false for missing / non-object input', () => {
    expect(isTokenStale(null, NOW)).toBe(false)
    expect(isTokenStale(undefined, NOW)).toBe(false)
    expect(isTokenStale('not an object', NOW)).toBe(false)
  })

  it('honors a custom skew window', () => {
    // A 5-minute skew window — token expiring in 4 minutes is stale.
    expect(isTokenStale({ expires_at: NOW + 4 * 60_000 }, NOW, 5 * 60_000)).toBe(true)
    expect(isTokenStale({ expires_at: NOW + 6 * 60_000 }, NOW, 5 * 60_000)).toBe(false)
  })
})

// ── buildRefreshedTokenDoc ────────────────────────────────────────────────────

describe('buildRefreshedTokenDoc', () => {
  it('uses the new access_token + expires_in from the refresh response', () => {
    const doc = buildRefreshedTokenDoc(
      { access_token: 'old', refresh_token: 'r-old', expires_at: NOW - 1 },
      { access_token: 'new', refresh_token: 'r-new', expires_in: 3600 },
      NOW,
    )
    expect(doc.access_token).toBe('new')
    expect(doc.refresh_token).toBe('r-new')
    expect(doc.expires_at).toBe(NOW + 3600 * 1000)
  })

  it('preserves the prior refresh_token when the response does not return one', () => {
    // Some OAuth providers (e.g. CompanyCam/Doorkeeper in the long-lived
    // configuration) return only an access_token. The existing refresh token
    // must survive the merge or we lose the ability to refresh again.
    const doc = buildRefreshedTokenDoc(
      { access_token: 'old', refresh_token: 'r-old' },
      { access_token: 'new', expires_in: 3600 },
      NOW,
    )
    expect(doc.refresh_token).toBe('r-old')
  })

  it("clears expires_at to null when the response has no expires_in (long-lived)", () => {
    const doc = buildRefreshedTokenDoc(
      { access_token: 'old', expires_at: NOW - 1 },
      { access_token: 'new' /* no expires_in */ },
      NOW,
    )
    expect(doc.expires_at).toBeNull()
  })

  it('treats expires_in === 0 as no expiry (long-lived)', () => {
    // Some providers return 0 to signal "indefinite" — accept that rather
    // than stamping `now + 0` which would mark the token instantly stale.
    const doc = buildRefreshedTokenDoc(
      { access_token: 'old' },
      { access_token: 'new', expires_in: 0 },
      NOW,
    )
    expect(doc.expires_at).toBeNull()
  })

  it('treats a non-numeric expires_in as no expiry', () => {
    const doc = buildRefreshedTokenDoc(
      { access_token: 'old' },
      { access_token: 'new', expires_in: 'forever' },
      NOW,
    )
    expect(doc.expires_at).toBeNull()
  })

  it('null-safe for missing existing / fresh objects', () => {
    expect(() => buildRefreshedTokenDoc(null, { access_token: 'new', expires_in: 60 }, NOW))
      .not.toThrow()
    expect(buildRefreshedTokenDoc(null, { access_token: 'new', expires_in: 60 }, NOW))
      .toEqual({ access_token: 'new', refresh_token: undefined, expires_at: NOW + 60_000 })
    expect(buildRefreshedTokenDoc({ refresh_token: 'old' }, null, NOW))
      .toEqual({ access_token: undefined, refresh_token: 'old', expires_at: null })
  })

  it('returns exactly the three fields the existing call site writes', () => {
    // Pins the doc shape so a future refactor doesn't accidentally drop or
    // add fields that would clobber other parts of the token document.
    const doc = buildRefreshedTokenDoc(
      { access_token: 'old', refresh_token: 'r-old', expires_at: 1 },
      { access_token: 'new', refresh_token: 'r-new', expires_in: 60 },
      NOW,
    )
    expect(Object.keys(doc).sort()).toEqual(['access_token', 'expires_at', 'refresh_token'])
  })
})
