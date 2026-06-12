import { describe, it, expect } from 'vitest'
import {
  findExpiredStateKeys,
  verifyOAuthState,
  VERIFY_OAUTH_STATE_MESSAGES,
} from './oauthState.js'

// Mimic the Firestore Timestamp shape — only the `.toMillis()` method is read.
const ts = (ms) => ({ toMillis: () => ms })

const NOW    = 1_700_000_000_000
const TTL    = 10 * 60 * 1000 // matches STATE_TTL_MS in functions/index.js

// ── findExpiredStateKeys ──────────────────────────────────────────────────────

describe('findExpiredStateKeys', () => {
  it('returns keys whose createdAt is older than the cutoff', () => {
    const map = {
      fresh:   { uid: 'u1', createdAt: ts(NOW - 1_000) },
      stale:   { uid: 'u2', createdAt: ts(NOW - (TTL + 5_000)) },
      ancient: { uid: 'u3', createdAt: ts(NOW - (TTL * 100)) },
    }
    expect(findExpiredStateKeys(map, NOW, TTL).sort()).toEqual(['ancient', 'stale'])
  })

  it('returns an empty list when nothing is stale', () => {
    const map = {
      a: { createdAt: ts(NOW - 1_000) },
      b: { createdAt: ts(NOW - 5_000) },
    }
    expect(findExpiredStateKeys(map, NOW, TTL)).toEqual([])
  })

  it('returns an empty list for missing / non-object input', () => {
    expect(findExpiredStateKeys(null, NOW, TTL)).toEqual([])
    expect(findExpiredStateKeys(undefined, NOW, TTL)).toEqual([])
    expect(findExpiredStateKeys('not an object', NOW, TTL)).toEqual([])
  })

  it('does not expire records with no usable createdAt', () => {
    // Without a timestamp we have no basis to expire — better to keep than
    // accidentally drop something a hand-edited config doc left around.
    const map = {
      noTs:    { uid: 'u1' },
      junk:    { uid: 'u2', createdAt: { foo: 'bar' } },
      typeBad: { uid: 'u3', createdAt: 'string-not-a-ts' },
    }
    expect(findExpiredStateKeys(map, NOW, TTL)).toEqual([])
  })

  it('boundary: a record exactly at the cutoff is NOT expired', () => {
    const map = { edge: { createdAt: ts(NOW - TTL) } }
    expect(findExpiredStateKeys(map, NOW, TTL)).toEqual([])
  })

  it('boundary: a record one ms past the cutoff IS expired', () => {
    const map = { edge: { createdAt: ts(NOW - TTL - 1) } }
    expect(findExpiredStateKeys(map, NOW, TTL)).toEqual(['edge'])
  })
})

// ── verifyOAuthState ──────────────────────────────────────────────────────────

describe('verifyOAuthState', () => {
  const baseArgs = { state: 'abc123', callerUid: 'u1', nowMs: NOW, ttlMs: TTL }

  it('accepts a fresh, matching state', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { abc123: { uid: 'u1', createdAt: ts(NOW - 1_000) } },
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejects an unknown state as not-found (failed-precondition)', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { someoneElse: { uid: 'u1', createdAt: ts(NOW) } },
    })
    expect(result).toEqual({
      ok: false, code: 'failed-precondition', reason: 'not-found',
    })
  })

  it('rejects an expired state as expired (failed-precondition)', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { abc123: { uid: 'u1', createdAt: ts(NOW - (TTL + 1)) } },
    })
    expect(result).toEqual({
      ok: false, code: 'failed-precondition', reason: 'expired',
    })
  })

  it('rejects a state belonging to another user as foreign-user (permission-denied)', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      callerUid: 'u2',
      stateMap: { abc123: { uid: 'u1', createdAt: ts(NOW - 1_000) } },
    })
    expect(result).toEqual({
      ok: false, code: 'permission-denied', reason: 'foreign-user',
    })
  })

  it('accepts a state with no recorded uid (legacy / pre-tracking)', () => {
    // When the stored record has no uid (older flows didn't track it), we
    // accept it as long as it's fresh — there's nothing to compare against.
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { abc123: { createdAt: ts(NOW - 1_000) } },
    })
    expect(result).toEqual({ ok: true })
  })

  it('accepts when callerUid is missing (anonymous flow)', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      callerUid: null,
      stateMap: { abc123: { uid: 'u1', createdAt: ts(NOW - 1_000) } },
    })
    expect(result).toEqual({ ok: true })
  })

  it('treats a record with no createdAt as expired (no way to verify TTL)', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { abc123: { uid: 'u1' /* no createdAt */ } },
    })
    expect(result).toEqual({
      ok: false, code: 'failed-precondition', reason: 'expired',
    })
  })

  it('boundary: a state exactly at the TTL boundary is still valid', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { abc123: { uid: 'u1', createdAt: ts(NOW - TTL) } },
    })
    expect(result).toEqual({ ok: true })
  })

  it('boundary: one ms past the TTL boundary is expired', () => {
    const result = verifyOAuthState({
      ...baseArgs,
      stateMap: { abc123: { uid: 'u1', createdAt: ts(NOW - TTL - 1) } },
    })
    expect(result).toEqual({
      ok: false, code: 'failed-precondition', reason: 'expired',
    })
  })

  it('handles a null / undefined stateMap by reporting not-found', () => {
    expect(verifyOAuthState({ ...baseArgs, stateMap: null })
      .reason).toBe('not-found')
    expect(verifyOAuthState({ ...baseArgs, stateMap: undefined })
      .reason).toBe('not-found')
  })
})

// ── VERIFY_OAUTH_STATE_MESSAGES ──────────────────────────────────────────────

describe('VERIFY_OAUTH_STATE_MESSAGES', () => {
  it('covers every reason returned by verifyOAuthState', () => {
    // If a new reason ever ships from the helper, this catches the missing
    // message before the wrapper throws `HttpsError(undefined)`.
    expect(Object.keys(VERIFY_OAUTH_STATE_MESSAGES).sort())
      .toEqual(['expired', 'foreign-user', 'not-found'])
  })
  it('every message is a non-empty user-facing string', () => {
    Object.values(VERIFY_OAUTH_STATE_MESSAGES).forEach(msg => {
      expect(typeof msg).toBe('string')
      expect(msg.length).toBeGreaterThan(10)
    })
  })
})
