import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fmtJobDate } from '../jobs'
import { fmtSubDate, daysUntilDate, subInsuranceState, subLicenseState } from '../subs'
import { fmtMatDate, matDaysUntilNeeded, matIsOverdue, matIsBlocking } from '../materials'
import { buildBriefingItems } from '../briefing'

// A day that a form saved is a bare date such as 2026-10-18, and the Date constructor
// reads that as midnight UTC. In Nashville that is the evening before, so a screen that
// shows it through the constructor names the day before, and a count of the days to go
// is right only because rounding up hides the hours. East of UTC the same reading is
// the afternoon of the day itself, and the count is a day too many. Every function here
// takes a saved day and must treat it as the day on the calendar where the person is.
// Each case runs in three zones that the test sets itself by assigning process.env.TZ,
// which Node honours at once: Chicago is behind UTC, Auckland is ahead of it, and UTC
// is the control, where a wrong reading passes.
const ZONES = ['America/Chicago', 'Pacific/Auckland', 'UTC']

const originalZone = process.env.TZ

function inZone(zone) {
  beforeEach(() => {
    process.env.TZ = zone
  })
  afterEach(() => {
    vi.useRealTimers()
    if (originalZone === undefined) delete process.env.TZ
    else process.env.TZ = originalZone
  })
}

// The clock, set to a local time on October 18, 2026 once the zone is in effect.
const at = (hour, minute = 0) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, hour, minute))
}

// Early morning, midday, evening and the last minute of the day.
const HOURS = [[0, 30], [8, 0], [12, 0], [18, 30], [23, 59]]

describe.each(ZONES)('in %s', (zone) => {
  inZone(zone)

  describe('the day a saved date shows', () => {
    it.each([
      ['a job date', fmtJobDate, 'Oct 18, 2026'],
      ['a subcontractor date', fmtSubDate, 'Oct 18, 2026'],
      ['a material date', fmtMatDate, 'Oct 18'],
    ])('names the day that was saved in %s, written either way', (_what, format, expected) => {
      expect(format('2026-10-18')).toBe(expected)
      expect(format('10/18/2026')).toBe(expected)
    })

    it('gives no day for a date that is empty, and the same placeholder for every empty subcontractor date', () => {
      for (const empty of ['', undefined, null]) {
        expect(fmtJobDate(empty)).toBeNull()
        expect(fmtMatDate(empty)).toBeNull()
        expect(fmtSubDate(empty)).toBe(fmtSubDate(''))
      }
      expect(fmtSubDate('')).not.toBe('')
    })

    it.each([
      ['a job date', fmtJobDate],
      ['a subcontractor date', fmtSubDate],
      ['a material date', fmtMatDate],
    ])('hands back text that is not a date, in %s', (_what, format) => {
      expect(format('next week')).toBe('next week')
    })
  })

  describe.each(HOURS)('at %i:%i on the 18th', (hour, minute) => {
    beforeEach(() => at(hour, minute))

    it('counts the calendar days to a subcontractor expiry', () => {
      expect(daysUntilDate('2026-10-18')).toBe(0)
      expect(daysUntilDate('2026-10-19')).toBe(1)
      expect(daysUntilDate('2026-10-17')).toBe(-1)
      expect(daysUntilDate('10/20/2026')).toBe(2)
      expect(daysUntilDate('2026-12-17')).toBe(60)
    })

    it('sorts insurance and licenses into the right band on both sides of each limit', () => {
      const insurance = (insExp) => subInsuranceState({ insExp })
      expect(insurance('2026-10-17')).toBe('expired')
      expect(insurance('2026-10-18')).toBe('expiring-30')
      expect(insurance('2026-11-16')).toBe('expiring-30')
      expect(insurance('2026-11-17')).toBe('expiring-60')
      expect(insurance('2026-12-16')).toBe('expiring-60')
      expect(insurance('2026-12-17')).toBe('valid')
      expect(insurance('')).toBe('unknown')

      const license = (licExp) => subLicenseState({ licExp })
      expect(license('2026-10-17')).toBe('expired')
      expect(license('2026-12-16')).toBe('expiring-60')
      expect(license('2026-12-17')).toBe('valid')
    })

    it('counts the calendar days to the day a material is needed, and when that is late or close', () => {
      const needed = (dateNeeded) => ({ dateNeeded, status: 'Ordered' })
      expect(matDaysUntilNeeded(needed('2026-10-18'))).toBe(0)
      expect(matDaysUntilNeeded(needed('2026-10-20'))).toBe(2)
      expect(matDaysUntilNeeded(needed('2026-10-17'))).toBe(-1)
      expect(matDaysUntilNeeded({})).toBeNull()
      expect(matDaysUntilNeeded(needed('soon'))).toBeNull()

      expect(matIsOverdue(needed('2026-10-17'))).toBe(true)
      expect(matIsOverdue(needed('2026-10-18'))).toBe(false)
      expect(matIsBlocking(needed('2026-10-25'))).toBe(true)
      expect(matIsBlocking(needed('2026-10-26'))).toBe(false)
    })
  })
})

describe.each(ZONES)('the briefing in %s', (zone) => {
  inZone(zone)

  const briefOf = (date) => buildBriefingItems({
    jobs: [], materials: [], subs: [],
    extras: [{ _docId: 'x1', id: 'CO-1', job: 'QBS-001', status: 'pending', date }],
  }).find((item) => item.category === 'co')

  // Dated the 11th: six days old on the evening of the 17th, which is a warning, and
  // seven only from the start of the 18th, which is critical. Read as midnight UTC it
  // is a day older than it is for part of the day in Chicago and a day younger east of UTC.
  it.each([[8, 0], [18, 0], [23, 30]])('ages a change order from the start of the day it is dated, at %i:%i on the 17th', (hour, minute) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 17, hour, minute))
    const item = briefOf('2026-10-11')
    expect(item.age).toBe(6)
    expect(item.severity).toBe('warning')
  })

  it('turns critical at the start of the seventh day', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 18, 0, 30))
    const item = briefOf('2026-10-11')
    expect(item.age).toBe(7)
    expect(item.severity).toBe('critical')
  })
})
