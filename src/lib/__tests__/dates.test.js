import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  toLocalDateStr, monthKey, startOfLocalDay, parseDateStr, toDate,
  daysBetween, daysSince, fmtLongDate,
} from '../dates'

// Every rule in this file is about the zone the person is in. The machine that runs
// the tests is usually on UTC, where the local day and the UTC day are the same day
// and a wrong answer passes, so each test runs in three zones that the test sets
// itself by assigning process.env.TZ, which Node honours at once. Chicago is behind
// UTC, so its evening is already tomorrow in UTC. Auckland is ahead of UTC, so its
// morning is still yesterday in UTC. UTC is the control.
//
// The Dates are built from local parts (year, month, day, hour, minute) inside each
// test, after the zone is set, so a case reads the same in every zone. Month is
// counted from zero, as it is in the Date constructor.
const ZONES = [
  ['America/Chicago', 300],
  ['Pacific/Auckland', -780],
  ['UTC', 0],
]

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

const local = (parts) => new Date(...parts)

describe.each(ZONES)('in %s', (zone, offsetMinutes) => {
  inZone(zone)

  it('is in effect, so that these tests can tell a local day from a UTC day', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
    expect(local([2026, 9, 18, 12]).getTimezoneOffset()).toBe(offsetMinutes)
  })

  describe('toLocalDateStr', () => {
    it.each([
      ['a minute before midnight', [2026, 9, 18, 23, 59], '2026-10-18'],
      ['a minute after midnight', [2026, 9, 19, 0, 1], '2026-10-19'],
      ['half past eleven at night', [2026, 9, 18, 23, 30], '2026-10-18'],
      ['half past midnight', [2026, 9, 18, 0, 30], '2026-10-18'],
      ['noon', [2026, 9, 18, 12, 0], '2026-10-18'],
      ['a single digit month and day', [2026, 2, 5, 9, 0], '2026-03-05'],
      ['the last minute of the year', [2026, 11, 31, 23, 59], '2026-12-31'],
      ['the first minute of the year', [2027, 0, 1, 0, 0], '2027-01-01'],
    ])('names the local day at %s', (_when, parts, expected) => {
      expect(toLocalDateStr(local(parts))).toBe(expected)
    })

    it('reads the clock when it is given nothing', () => {
      vi.useFakeTimers()
      vi.setSystemTime(local([2026, 9, 18, 23, 30]))
      expect(toLocalDateStr()).toBe('2026-10-18')
    })
  })

  describe('monthKey', () => {
    it.each([
      ['the last evening of a month', [2026, 9, 31, 23, 30], '2026-10'],
      ['the first morning of a month', [2026, 10, 1, 0, 30], '2026-11'],
      ['a single digit month', [2026, 0, 15, 12, 0], '2026-01'],
      ['the last minute of the year', [2026, 11, 31, 23, 59], '2026-12'],
    ])('names the local month at %s', (_when, parts, expected) => {
      expect(monthKey(local(parts))).toBe(expected)
    })

    it('reads the clock when it is given nothing', () => {
      vi.useFakeTimers()
      vi.setSystemTime(local([2026, 9, 31, 23, 30]))
      expect(monthKey()).toBe('2026-10')
    })
  })

  describe('startOfLocalDay', () => {
    it('is local midnight of the same day', () => {
      const start = startOfLocalDay(local([2026, 9, 18, 23, 30]))
      expect(start.getTime()).toBe(local([2026, 9, 18, 0, 0]).getTime())
      expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0])
    })

    it('is a new Date and leaves the one it was given alone', () => {
      const given = local([2026, 9, 18, 23, 30])
      const before = given.getTime()
      const start = startOfLocalDay(given)
      expect(start).not.toBe(given)
      expect(given.getTime()).toBe(before)
    })

    it('reads the clock when it is given nothing', () => {
      vi.useFakeTimers()
      vi.setSystemTime(local([2026, 9, 18, 23, 30]))
      expect(startOfLocalDay().getTime()).toBe(local([2026, 9, 18]).getTime())
    })
  })

  describe('parseDateStr', () => {
    it.each([
      ['an ISO date', '2026-03-10', [2026, 2, 10]],
      ['a US date', '03/10/2026', [2026, 2, 10]],
      ['a US date without leading zeros', '3/9/2026', [2026, 2, 9]],
      ['the last day of the year, written as a US date', '12/31/2026', [2026, 11, 31]],
      ['a leap day', '2028-02-29', [2028, 1, 29]],
    ])('reads %s as local midnight', (_what, text, parts) => {
      const parsed = parseDateStr(text)
      expect(parsed).toBeInstanceOf(Date)
      expect(parsed.getTime()).toBe(local(parts).getTime())
      expect([parsed.getHours(), parsed.getMinutes()]).toEqual([0, 0])
    })

    it('reads the two spellings of one day as the same moment', () => {
      expect(parseDateStr('03/10/2026').getTime()).toBe(parseDateStr('2026-03-10').getTime())
    })

    it.each([
      ['an empty string', ''],
      ['null', null],
      ['undefined', undefined],
      ['words', 'tomorrow'],
      ['a month past twelve', '2026-13-01'],
      ['a day the month does not have', '2026-02-30'],
      ['a US date with a day the month does not have', '02/30/2026'],
      ['a US date with a month past twelve', '13/01/2026'],
      ['a leap day in a year that has none', '2027-02-29'],
      ['an ISO date without leading zeros', '2026-3-5'],
      ['a date with a time on it', '2026-03-10T14:00:00Z'],
      ['a number', 20260310],
      ['a Date', new Date(2026, 2, 10)],
    ])('gives null for %s', (_what, value) => {
      expect(parseDateStr(value)).toBeNull()
    })
  })

  describe('toDate', () => {
    it.each([
      ['an ISO day', '2026-10-18', [2026, 9, 18]],
      ['a US day', '10/18/2026', [2026, 9, 18]],
      ['a US day without leading zeros', '3/9/2026', [2026, 2, 9]],
      ['the first day of a month', '2026-11-01', [2026, 10, 1]],
    ])('reads %s as local midnight, the day the person saved', (_what, text, parts) => {
      expect(toDate(text).getTime()).toBe(local(parts).getTime())
    })

    it('names the saved day when the Date is written out in the zone of the person', () => {
      const shown = (text) => toDate(text).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      expect(shown('2026-10-18')).toBe('Oct 18, 2026')
      expect(shown('10/18/2026')).toBe('Oct 18, 2026')
      expect(shown('2026-03-01')).toBe('Mar 1, 2026')
    })

    it('reads a moment as the moment it names', () => {
      const moment = local([2026, 9, 18, 21, 30])
      expect(toDate(moment)).toBe(moment)
      expect(toDate(moment.getTime()).getTime()).toBe(moment.getTime())
      expect(toDate(moment.toISOString()).getTime()).toBe(moment.getTime())
      expect(toDate('2026-10-18T21:30:00-05:00').getTime()).toBe(Date.parse('2026-10-19T02:30:00Z'))
      expect(toDate({ toDate: () => moment }).getTime()).toBe(moment.getTime())
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
      ['zero, which is a field that was never filled in', 0],
      ['words', 'not a date'],
      ['an invalid Date', new Date(NaN)],
      ['a Timestamp that cannot be read', { toDate: () => new Date(NaN) }],
      ['an object that is not a date', {}],
    ])('gives null for %s', (_what, value) => {
      expect(toDate(value)).toBeNull()
    })
  })

  describe('daysBetween', () => {
    it.each([
      ['two times on one day', [2026, 9, 18, 0, 5], [2026, 9, 18, 23, 55], 0],
      ['two minutes across midnight', [2026, 9, 18, 23, 59], [2026, 9, 19, 0, 1], 1],
      ['a week', [2026, 9, 11, 15, 0], [2026, 9, 18, 9, 0], 7],
      ['a week backwards', [2026, 9, 18, 9, 0], [2026, 9, 11, 15, 0], -7],
      ['noon to noon across daylight saving starting in Chicago', [2026, 2, 7, 12, 0], [2026, 2, 9, 12, 0], 2],
      ['noon to noon across daylight saving ending in Chicago', [2026, 9, 31, 12, 0], [2026, 10, 2, 12, 0], 2],
      ['noon to noon across daylight saving starting in Auckland', [2026, 8, 26, 12, 0], [2026, 8, 28, 12, 0], 2],
      ['a year end', [2026, 11, 30, 23, 0], [2027, 0, 2, 1, 0], 3],
    ])('counts calendar days across %s', (_what, from, to, expected) => {
      expect(daysBetween(local(from), local(to))).toBe(expected)
    })

    it('reads date strings as local days', () => {
      expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
      expect(daysBetween('03/07/2026', '2026-03-09')).toBe(2)
      expect(daysBetween(local([2026, 9, 18, 20, 0]), '2026-10-19')).toBe(1)
    })

    it.each([
      ['an empty first day', '', new Date(2026, 9, 18)],
      ['a first day that is not a date', 'soon', new Date(2026, 9, 18)],
      ['no second day', new Date(2026, 9, 18), undefined],
      ['an invalid Date', new Date(NaN), new Date(2026, 9, 18)],
    ])('gives null for %s', (_what, a, b) => {
      expect(daysBetween(a, b)).toBeNull()
    })
  })

  describe('daysSince', () => {
    const now = () => local([2026, 9, 18, 20, 0])

    it('counts the whole days that have passed', () => {
      expect(daysSince(local([2026, 9, 15, 12, 0]), now())).toBe(3)
      expect(daysSince(local([2026, 9, 18, 8, 0]), now())).toBe(0)
      expect(daysSince(local([2026, 9, 11, 21, 0]), now())).toBe(6)
    })

    it('counts a date from the start of its local day, whatever the hour is now', () => {
      expect(daysSince('2026-10-15', now())).toBe(3)
      expect(daysSince('10/15/2026', now())).toBe(3)
      expect(daysSince('2026-10-15', local([2026, 9, 18, 0, 5]))).toBe(3)
      expect(daysSince('2026-10-15', local([2026, 9, 18, 23, 55]))).toBe(3)
      expect(daysSince('2026-10-15', local([2026, 9, 19, 0, 5]))).toBe(4)
    })

    it('does not count the hour that daylight saving adds or takes away', () => {
      expect(daysSince('2026-03-07', local([2026, 2, 9, 0, 30]))).toBe(2)
      expect(daysSince('2026-09-26', local([2026, 8, 28, 0, 30]))).toBe(2)
      expect(daysSince('2026-10-30', local([2026, 10, 1, 23, 30]))).toBe(2)
    })

    it('reads a Firestore Timestamp, a number of milliseconds and a time on an ISO string', () => {
      const moment = local([2026, 9, 14, 9, 0])
      expect(daysSince({ toDate: () => moment }, now())).toBe(4)
      expect(daysSince(moment.getTime(), now())).toBe(4)
      expect(daysSince(moment.toISOString(), now())).toBe(4)
    })

    it('is negative for a day to come', () => {
      expect(daysSince(local([2026, 9, 25, 20, 0]), now())).toBe(-7)
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
      ['zero, which is a field that was never filled in', 0],
      ['words', 'not a date'],
      ['an invalid Date', new Date(NaN)],
      ['a Timestamp that cannot be read', { toDate: () => new Date(NaN) }],
      ['an object that is not a date', {}],
    ])('gives null for %s', (_what, value) => {
      expect(daysSince(value, now())).toBeNull()
    })

    it('reads the clock when it is given no second argument', () => {
      vi.useFakeTimers()
      vi.setSystemTime(now())
      expect(daysSince('2026-10-15')).toBe(3)
    })
  })

  describe('fmtLongDate', () => {
    it('writes the weekday, the month by name, the day and the year', () => {
      expect(fmtLongDate(local([2026, 9, 18, 23, 30]))).toBe('Sunday, October 18, 2026')
      expect(fmtLongDate(local([2026, 0, 1, 0, 30]))).toBe('Thursday, January 1, 2026')
    })

    it('reads the clock when it is given nothing', () => {
      vi.useFakeTimers()
      vi.setSystemTime(local([2026, 9, 18, 23, 30]))
      expect(fmtLongDate()).toBe('Sunday, October 18, 2026')
    })
  })
})
