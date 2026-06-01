import { describe, it, expect } from 'vitest'
import {
  daysUntilDate, subInsuranceState, subLicenseState,
  subHasMissingDocs, subInsuranceExpired, subInsuranceExpiringSoon,
  subLicenseExpired, subComplianceVerdict, subMatchesFilter,
  subNextAction, fmtSubDate, subJobKey,
  SUB_FILTERS, TRADE_FILTERS,
} from './subs'

const inDays = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('daysUntilDate', () => {
  it('returns null for empty / invalid', () => {
    expect(daysUntilDate('')).toBeNull()
    expect(daysUntilDate('garbage')).toBeNull()
  })
  it('counts forward + backward', () => {
    expect(daysUntilDate(inDays(7))).toBeGreaterThanOrEqual(6)
    expect(daysUntilDate(inDays(-2))).toBeLessThanOrEqual(-1)
  })
})

describe('subInsuranceState / subLicenseState', () => {
  it('expired when past', () => {
    expect(subInsuranceState({ insExp: inDays(-1) })).toBe('expired')
    expect(subLicenseState({   licExp: inDays(-5) })).toBe('expired')
  })
  it('expiring-30 only for insurance', () => {
    expect(subInsuranceState({ insExp: inDays(15) })).toBe('expiring-30')
    // license has no 30 bucket — within 60 only
    expect(subLicenseState({ licExp: inDays(15) })).toBe('expiring-60')
  })
  it('valid when far out', () => {
    expect(subInsuranceState({ insExp: inDays(120) })).toBe('valid')
    expect(subLicenseState({   licExp: inDays(120) })).toBe('valid')
  })
  it('unknown when missing', () => {
    expect(subInsuranceState({})).toBe('unknown')
    expect(subLicenseState({})).toBe('unknown')
  })
})

describe('subComplianceVerdict', () => {
  it('do-not-assign when missing W-9', () => {
    expect(subComplianceVerdict({ w9: false }).label).toBe('Do not assign')
  })
  it('do-not-assign when insurance expired', () => {
    expect(subComplianceVerdict({ w9: true, insExp: inDays(-1), licExp: inDays(120) }).label)
      .toBe('Do not assign')
  })
  it('review-needed when expiring soon', () => {
    expect(subComplianceVerdict({ w9: true, insExp: inDays(20), licExp: inDays(120) }).label)
      .toBe('Compliance review needed')
  })
  it('review-needed when score < 80', () => {
    expect(subComplianceVerdict({ w9: true, insExp: inDays(120), licExp: inDays(120), score: 70 }).label)
      .toBe('Compliance review needed')
  })
  it('approved otherwise', () => {
    expect(subComplianceVerdict({ w9: true, insExp: inDays(180), licExp: inDays(180), score: 95 }).label)
      .toBe('Approved for work')
  })
})

describe('subMatchesFilter', () => {
  const good   = { w9: true, insExp: inDays(180), licExp: inDays(180), score: 95 }
  const blocked = { w9: false }
  const review = { w9: true, insExp: inDays(20), licExp: inDays(120) }

  it('all matches everything', () => {
    expect(subMatchesFilter(good, 'all')).toBe(true)
    expect(subMatchesFilter(blocked, 'all')).toBe(true)
  })
  it('approved matches only approved', () => {
    expect(subMatchesFilter(good, 'approved')).toBe(true)
    expect(subMatchesFilter(blocked, 'approved')).toBe(false)
  })
  it('blocked matches do-not-assign', () => {
    expect(subMatchesFilter(blocked, 'blocked')).toBe(true)
  })
  it('expiring-soon hits the 30-day insurance bucket', () => {
    expect(subMatchesFilter(review, 'expiring-soon')).toBe(true)
  })
  it('missing-docs gates on W-9', () => {
    expect(subMatchesFilter(blocked, 'missing-docs')).toBe(true)
    expect(subMatchesFilter(good,    'missing-docs')).toBe(false)
  })
})

describe('subNextAction', () => {
  it('always returns a string', () => {
    expect(typeof subNextAction({ w9: false })).toBe('string')
    expect(typeof subNextAction({ w9: true, insExp: inDays(180), licExp: inDays(180), score: 95 })).toBe('string')
  })
  it('flags missing W-9 first', () => {
    expect(subNextAction({ w9: false })).toMatch(/W-9/)
  })
  it('flags expired insurance', () => {
    expect(subNextAction({ w9: true, insExp: inDays(-1), licExp: inDays(180) }))
      .toMatch(/Insurance expired/)
  })
  it('flags expired license when insurance is fine', () => {
    expect(subNextAction({ w9: true, insExp: inDays(180), licExp: inDays(-1) }))
      .toMatch(/License expired/)
  })
  it('flags insurance expiring within 30 days', () => {
    expect(subNextAction({ w9: true, insExp: inDays(20), licExp: inDays(180) }))
      .toMatch(/30 days/)
  })
  it('flags insurance expiring within 60 days (not 30)', () => {
    expect(subNextAction({ w9: true, insExp: inDays(45), licExp: inDays(180) }))
      .toMatch(/expiring soon/)
  })
  it('flags low score when compliance is otherwise clean', () => {
    expect(subNextAction({ w9: true, insExp: inDays(180), licExp: inDays(180), score: 70 }))
      .toMatch(/Compliance review/)
  })
  it('returns the ready-to-assign copy when everything checks out', () => {
    expect(subNextAction({ w9: true, insExp: inDays(180), licExp: inDays(180), score: 95 }))
      .toMatch(/Ready to assign/)
  })
})

describe('fmtSubDate', () => {
  it('returns em-dash on empty', () => {
    expect(fmtSubDate('')).toBe('—')
    expect(fmtSubDate(null)).toBe('—')
  })
  it('formats valid dates', () => {
    expect(fmtSubDate('2025-05-15')).toMatch(/2025/)
  })
})

describe('subJobKey', () => {
  it('returns P2 In-House for the in-house sub', () => {
    expect(subJobKey({ id: 'p2', name: 'Anything' })).toBe('P2 In-House')
  })
  it('falls back to first word of the name', () => {
    expect(subJobKey({ id: 'tony', name: 'Tony Allgood' })).toBe('Tony')
  })
})

describe('helpers', () => {
  it('subHasMissingDocs flips on W-9 absence', () => {
    expect(subHasMissingDocs({ w9: false })).toBe(true)
    expect(subHasMissingDocs({ w9: true })).toBe(false)
  })
  it('subInsuranceExpired / subLicenseExpired align with state helpers', () => {
    expect(subInsuranceExpired({ insExp: inDays(-1) })).toBe(true)
    expect(subLicenseExpired({  licExp: inDays(-1) })).toBe(true)
  })
  it('subInsuranceExpiringSoon catches both 30 and 60 buckets', () => {
    expect(subInsuranceExpiringSoon({ insExp: inDays(15) })).toBe(true)
    expect(subInsuranceExpiringSoon({ insExp: inDays(45) })).toBe(true)
    expect(subInsuranceExpiringSoon({ insExp: inDays(180) })).toBe(false)
  })
})

describe('SUB_FILTERS / TRADE_FILTERS', () => {
  it('every entry has id + label', () => {
    SUB_FILTERS.forEach(f => {
      expect(typeof f.id).toBe('string')
      expect(typeof f.label).toBe('string')
    })
    TRADE_FILTERS.forEach(f => {
      expect(typeof f.id).toBe('string')
      expect(typeof f.label).toBe('string')
    })
  })
})
