import { describe, it, expect } from 'vitest'
import { scoreJob, classifyRisk, daysSince, hasFailedInspection, isBillingReady, isHvacStartupBlocked } from './scoring'

const ago = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

describe('daysSince', () => {
  it('returns null for empty input', () => {
    expect(daysSince(null)).toBeNull()
    expect(daysSince(undefined)).toBeNull()
    expect(daysSince('')).toBeNull()
  })
  it('returns null for invalid date strings', () => {
    expect(daysSince('not-a-date')).toBeNull()
  })
  it('counts whole days backwards', () => {
    expect(daysSince(ago(0))).toBe(0)
    expect(daysSince(ago(5))).toBeGreaterThanOrEqual(4)
    expect(daysSince(ago(5))).toBeLessThanOrEqual(5)
  })
  it('handles Firestore Timestamp-like { toDate }', () => {
    const t = { toDate: () => new Date(ago(2)) }
    const d = daysSince(t)
    expect(d).toBeGreaterThanOrEqual(1)
    expect(d).toBeLessThanOrEqual(2)
  })
})

describe('hasFailedInspection', () => {
  it('returns false when no insp', () => {
    expect(hasFailedInspection({})).toBe(false)
    expect(hasFailedInspection({ insp: null })).toBe(false)
  })
  it('returns true when any trade/phase failed', () => {
    expect(hasFailedInspection({ insp: { electrical: { final: 'failed' } } })).toBe(true)
    expect(hasFailedInspection({ insp: { hvac: { roughIn: 'failed' } } })).toBe(true)
  })
  it('returns false when none failed', () => {
    expect(hasFailedInspection({ insp: { electrical: { final: 'passed' } } })).toBe(false)
  })
})

describe('isBillingReady', () => {
  it('returns false if already invoiced or paid', () => {
    expect(isBillingReady({ billingStatus: 'invoiced' })).toBe(false)
    expect(isBillingReady({ billingStatus: 'paid' })).toBe(false)
  })
  it('returns true if any trade rough-in passed', () => {
    expect(isBillingReady({ insp: { plumbing: { roughIn: 'passed' } } })).toBe(true)
  })
  it('returns true if any trade final passed', () => {
    expect(isBillingReady({ insp: { hvac: { final: 'passed' } } })).toBe(true)
  })
  it('returns false if nothing passed', () => {
    expect(isBillingReady({ insp: { electrical: { roughIn: 'pending' } } })).toBe(false)
  })
})

describe('isHvacStartupBlocked', () => {
  it('returns false for non-HVAC jobs', () => {
    expect(isHvacStartupBlocked({ type: 'Residential Full Rewire', insp: {} })).toBe(false)
  })
  it('returns true when HVAC rough-in passed but no E service release', () => {
    expect(isHvacStartupBlocked({
      type: 'HVAC + Electrical Upgrade',
      insp: { hvac: { roughIn: 'passed' } },
    })).toBe(true)
  })
  it('returns false when E service release is obtained', () => {
    expect(isHvacStartupBlocked({
      type: 'HVAC + Electrical Upgrade',
      insp: { hvac: { roughIn: 'passed' } },
      eServiceRelease: 'obtained',
    })).toBe(false)
  })
})

describe('classifyRisk', () => {
  it('returns null for complete jobs', () => {
    expect(classifyRisk({ status: 'complete' })).toBeNull()
    expect(classifyRisk({ status: 'completed' })).toBeNull()
  })
  it('returns critical for failed inspection', () => {
    expect(classifyRisk({ insp: { electrical: { final: 'failed' } } }))
      .toEqual({ level: 'critical', reason: 'Failed inspection — rework required' })
  })
  it('returns critical when stalled >= 7 days', () => {
    const r = classifyRisk({ lastStatusChange: ago(10) })
    expect(r?.level).toBe('critical')
  })
  it('returns warning at >= 3 days stale', () => {
    const r = classifyRisk({ lastStatusChange: ago(4) })
    expect(r?.level).toBe('warning')
  })
  it('returns null when fresh and clean', () => {
    expect(classifyRisk({ lastStatusChange: ago(0), insp: {} })).toBeNull()
  })
})

describe('scoreJob', () => {
  it('returns 0 for complete jobs', () => {
    expect(scoreJob({ status: 'complete' })).toBe(0)
  })
  it('adds top priority for failed inspection', () => {
    const s = scoreJob({ status: 'active', insp: { hvac: { final: 'failed' } } })
    expect(s).toBeGreaterThanOrEqual(80)
  })
  it('caps at 100', () => {
    const s = scoreJob({
      status: 'needs-action',
      insp: { hvac: { roughIn: 'passed', final: 'failed' } },
      lastStatusChange: ago(30),
      progress: 80,
      type: 'HVAC + Electrical Upgrade',
    })
    expect(s).toBeLessThanOrEqual(100)
  })
})
