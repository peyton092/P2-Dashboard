import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { BUSINESS_TIME_ZONE, businessDay } from '../lib/business-time.js'

// The server names a day for people to read, such as the day an inspection was recorded,
// and the calendar a person looks at is the one in Middle Tennessee, which is Central
// time. The UTC day turns over at 7 pm there in summer and 6 pm in winter. Every case
// gives an instant in UTC and the day it is in Central time, so the offset in force (five
// hours behind UTC in daylight time, six in standard time) is part of what is checked.

afterEach(() => {
  mock.timers.reset()
})

const day = (instant) => businessDay(new Date(instant))

describe('BUSINESS_TIME_ZONE', () => {
  it('is Central time, where the company is', () => {
    assert.equal(BUSINESS_TIME_ZONE, 'America/Chicago')
  })
})

describe('businessDay', () => {
  it('writes the day as YYYY-MM-DD with the month and the day padded', () => {
    assert.equal(day('2026-03-05T18:00:00Z'), '2026-03-05')
    assert.equal(day('2026-11-30T18:00:00Z'), '2026-11-30')
    assert.match(day('2026-07-04T12:00:00Z'), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('names the day before in the evening, when UTC is already tomorrow', () => {
    // 7:05 pm on the 18th in daylight time is five past midnight on the 19th in UTC.
    assert.equal(day('2026-10-19T00:05:00Z'), '2026-10-18')
    assert.equal(day('2026-10-18T23:59:59Z'), '2026-10-18')
  })

  it('turns the day over at midnight in daylight time, five hours behind UTC', () => {
    assert.equal(day('2026-10-19T04:59:59Z'), '2026-10-18')
    assert.equal(day('2026-10-19T05:00:00Z'), '2026-10-19')
    assert.equal(day('2026-10-19T05:00:01Z'), '2026-10-19')
  })

  it('turns the day over at midnight in standard time, six hours behind UTC', () => {
    assert.equal(day('2026-01-06T05:59:59Z'), '2026-01-05')
    assert.equal(day('2026-01-06T06:00:00Z'), '2026-01-06')
  })

  it('keeps the day in the morning, when UTC has the same day', () => {
    assert.equal(day('2026-10-18T05:00:00Z'), '2026-10-18')
    assert.equal(day('2026-10-18T14:30:00Z'), '2026-10-18')
    assert.equal(day('2026-01-05T11:00:00Z'), '2026-01-05')
  })

  // Daylight time starts on Sunday, March 8, 2026, at 2 am: the clocks jump to 3 am.
  describe('across the start of daylight saving time', () => {
    it('is still Saturday until midnight in standard time, and Sunday after it', () => {
      assert.equal(day('2026-03-08T05:59:59Z'), '2026-03-07')
      assert.equal(day('2026-03-08T06:00:00Z'), '2026-03-08')
    })

    it('turns Sunday into Monday an hour earlier in UTC, because the clocks moved', () => {
      assert.equal(day('2026-03-09T04:59:59Z'), '2026-03-08')
      assert.equal(day('2026-03-09T05:00:00Z'), '2026-03-09')
      // Six hours behind would still call this Sunday.
      assert.equal(day('2026-03-09T05:30:00Z'), '2026-03-09')
    })

    it('has no day of its own for the hour that does not exist', () => {
      assert.equal(day('2026-03-08T07:59:59Z'), '2026-03-08')
      assert.equal(day('2026-03-08T08:00:00Z'), '2026-03-08')
    })
  })

  // Daylight time ends on Sunday, November 1, 2026, at 2 am: the clocks go back to 1 am,
  // so that Sunday has 25 hours.
  describe('across the end of daylight saving time', () => {
    it('turns Saturday into Sunday at midnight in daylight time', () => {
      assert.equal(day('2026-11-01T04:59:59Z'), '2026-10-31')
      assert.equal(day('2026-11-01T05:00:00Z'), '2026-11-01')
    })

    it('stays Sunday for the repeated hour', () => {
      assert.equal(day('2026-11-01T05:59:59Z'), '2026-11-01')
      assert.equal(day('2026-11-01T06:00:00Z'), '2026-11-01')
      assert.equal(day('2026-11-01T06:59:59Z'), '2026-11-01')
    })

    it('turns Sunday into Monday an hour later in UTC, because the clocks moved back', () => {
      // Five hours behind would call 05:30 Monday already.
      assert.equal(day('2026-11-02T05:30:00Z'), '2026-11-01')
      assert.equal(day('2026-11-02T05:59:59Z'), '2026-11-01')
      assert.equal(day('2026-11-02T06:00:00Z'), '2026-11-02')
    })
  })

  it('crosses the end of a year and a leap day in Central time', () => {
    assert.equal(day('2027-01-01T05:59:59Z'), '2026-12-31')
    assert.equal(day('2027-01-01T06:00:00Z'), '2027-01-01')
    assert.equal(day('2028-03-01T05:59:59Z'), '2028-02-29')
    assert.equal(day('2028-03-01T06:00:00Z'), '2028-03-01')
  })

  it('gives the same answer whatever zone the machine is in', () => {
    const original = process.env.TZ
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'America/Chicago']) {
        process.env.TZ = zone
        assert.equal(day('2026-10-19T00:05:00Z'), '2026-10-18', zone)
        assert.equal(day('2026-10-19T05:00:00Z'), '2026-10-19', zone)
        assert.equal(day('2026-11-02T05:30:00Z'), '2026-11-01', zone)
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('reads the clock when it is given nothing', () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T00:30:00Z') })
    assert.equal(businessDay(), '2026-10-18')
    mock.timers.reset()
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T05:30:00Z') })
    assert.equal(businessDay(), '2026-10-19')
  })
})
