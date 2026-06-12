import { describe, it, expect } from 'vitest'
import { normAddr, addrMatches, STREET_SUFFIX } from './address.js'

// ── normAddr ──────────────────────────────────────────────────────────────────

describe('normAddr', () => {
  it('lowercases and trims', () => {
    expect(normAddr('  123 Maple Street  ')).toBe('123 maple st')
  })

  it('folds the full word "Street" to "st"', () => {
    expect(normAddr('123 Maple Street')).toBe('123 maple st')
  })

  it('leaves the already-abbreviated form unchanged', () => {
    expect(normAddr('123 Maple St')).toBe('123 maple st')
  })

  it.each([
    ['Drive',     'dr'],
    ['Avenue',    'ave'],
    ['Road',      'rd'],
    ['Lane',      'ln'],
    ['Boulevard', 'blvd'],
    ['Court',     'ct'],
    ['Circle',    'cir'],
    ['Place',     'pl'],
    ['Terrace',   'ter'],
    ['Parkway',   'pkwy'],
    ['Cove',      'cv'],
    ['Trail',     'trl'],
    ['Highway',   'hwy'],
    ['Crossing',  'xing'],
  ])('folds full "%s" to "%s"', (full, abbrev) => {
    expect(normAddr(`123 Foo ${full}`)).toBe(`123 foo ${abbrev}`)
  })

  it('strips periods, commas, and hash marks', () => {
    expect(normAddr('123 Maple St., Apt #4, Nashville, TN'))
      .toBe('123 maple st apt 4 nashville tn')
  })

  it('collapses runs of whitespace', () => {
    expect(normAddr('123   Maple    St')).toBe('123 maple st')
  })

  it('returns "" for null / undefined / empty', () => {
    expect(normAddr(null)).toBe('')
    expect(normAddr(undefined)).toBe('')
    expect(normAddr('')).toBe('')
    expect(normAddr('   ')).toBe('')
  })

  it('coerces non-strings via String() rather than throwing', () => {
    expect(normAddr(42)).toBe('42')
    // String({}) -> '[object Object]'; the actual normalized form is not
    // meaningful — we just need it to not throw and remain a string.
    expect(typeof normAddr({ no: 'string' })).toBe('string')
  })

  it('handles double abbreviations and multi-word suffixes correctly', () => {
    // "ST" should also fold (case-insensitive)
    expect(normAddr('123 MAPLE ST')).toBe('123 maple st')
    // "Way" is its own canonical form (already short)
    expect(normAddr('500 Sunset Way')).toBe('500 sunset way')
  })

  it('STREET_SUFFIX maps every full word to its abbreviation idempotently', () => {
    // A round-trip property: every value in the map is also a key that maps
    // to itself. This pins the "applying normAddr twice is a no-op for the
    // suffix word" guarantee.
    for (const abbrev of new Set(Object.values(STREET_SUFFIX))) {
      expect(STREET_SUFFIX[abbrev]).toBe(abbrev)
    }
  })
})

// ── addrMatches: the cross-tenant safety contract (audit S-12) ────────────────

describe('addrMatches — exact + full-prefix containment', () => {
  it('matches exact normalized equality', () => {
    expect(addrMatches('123 Maple Street', '123 Maple St')).toBe(true)
  })

  it('matches when one is a full-prefix of the other (apartment suffix)', () => {
    expect(addrMatches('123 Maple St', '123 Maple St Apt 4')).toBe(true)
    expect(addrMatches('123 Maple St Apt 4', '123 Maple St')).toBe(true)
  })

  it('matches across full-word vs abbreviated suffix', () => {
    expect(addrMatches('500 Sunset Drive', '500 Sunset Dr.')).toBe(true)
    expect(addrMatches('500 Sunset Drive Suite 200', '500 Sunset Dr.')).toBe(true)
  })

  it('matches across hash/comma noise', () => {
    expect(addrMatches('100 Main St, #2', '100 Main St 2')).toBe(true)
  })
})

describe('addrMatches — the S-12 anti-match contract', () => {
  // These are the cross-tenant leakage scenarios the strict matcher closed.
  // If any of these starts returning true again, photos would leak between
  // tenants — the test failures are the alarm.

  it('does NOT match different street types ("100 Main St" vs "100 Main Ave")', () => {
    expect(addrMatches('100 Main St', '100 Main Ave')).toBe(false)
  })

  it('does NOT match different street numbers on the same street', () => {
    expect(addrMatches('100 Main St', '200 Main St')).toBe(false)
  })

  it('does NOT match same number on different streets', () => {
    expect(addrMatches('123 Maple St', '123 Oak St')).toBe(false)
  })

  it('does NOT collide two unparseable / empty addresses on ""', () => {
    // Both normalize to "" — would match if we allowed empty equality.
    expect(addrMatches('', '')).toBe(false)
    expect(addrMatches(null, null)).toBe(false)
    expect(addrMatches('   ', '.')).toBe(false)
  })

  it('does NOT match a partial prefix that stops mid-word', () => {
    // "100 Mai" is NOT a full-prefix of "100 Main St" — prefix matching must
    // be at a word boundary (the `b + ' '` / `a + ' '` check).
    expect(addrMatches('100 Mai', '100 Main St')).toBe(false)
    expect(addrMatches('100 Main S', '100 Main St')).toBe(false)
  })

  it('does NOT match a missing-number CC address against a real job', () => {
    // CompanyCam occasionally has projects without a street number; those
    // shouldn't blanket-match every job on the same street.
    expect(addrMatches('Maple St', '100 Maple St')).toBe(false)
    expect(addrMatches('100 Maple St', 'Maple St')).toBe(false)
  })
})

describe('addrMatches — defensive inputs', () => {
  it('returns false when either side is empty', () => {
    expect(addrMatches('', '100 Main St')).toBe(false)
    expect(addrMatches('100 Main St', '')).toBe(false)
    expect(addrMatches(null, '100 Main St')).toBe(false)
    expect(addrMatches('100 Main St', undefined)).toBe(false)
  })

  it('handles trailing/leading whitespace gracefully', () => {
    expect(addrMatches('  100 Main St  ', '100 Main St')).toBe(true)
  })
})
