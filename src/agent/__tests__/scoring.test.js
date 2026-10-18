import { describe, it, expect, vi, afterEach } from 'vitest'
import { scoreJob, classifyRisk, daysSince } from '../scoring'

// scoring.js keeps no clock. A function that depends on the date takes the time as its
// last argument, and reads the clock only when it is not given one, at the call. A
// screen that has the time from useNow passes it, so a job gets staler as the days go by.
const NOW = new Date(2026, 9, 18, 9, 0)
const daysAgo = (days, from = NOW) => new Date(from.getFullYear(), from.getMonth(), from.getDate() - days, 9, 0)
const job = (over) => ({ id: 'QBS-001', status: 'active', progress: 0, ...over })

afterEach(() => {
  vi.useRealTimers()
})

describe('classifyRisk', () => {
  it.each([
    [1, null],
    [2, 'info'],
    [3, 'warning'],
    [6, 'warning'],
    [7, 'critical'],
    [30, 'critical'],
  ])('reads a job last changed %i days before the time it is given as %s', (days, level) => {
    const risk = classifyRisk(job({ lastStatusChange: daysAgo(days) }), NOW)
    expect(risk?.level ?? null).toBe(level)
  })

  it('says how many days a stalled job has stood', () => {
    expect(classifyRisk(job({ lastStatusChange: daysAgo(9) }), NOW).reason).toMatch(/\b9 days\b/)
  })

  it('counts from the start date when the job has never changed status, and from the day it starts', () => {
    expect(classifyRisk(job({ start: '2026-10-11' }), NOW)?.level).toBe('critical')
    expect(classifyRisk(job({ start: '2026-10-12' }), NOW)?.level).toBe('warning')
  })

  it('gets staler as the time it is given moves on', () => {
    const quiet = job({ lastStatusChange: daysAgo(1) })
    expect(classifyRisk(quiet, NOW)).toBeNull()
    expect(classifyRisk(quiet, daysAgo(-2, NOW))?.level).toBe('warning')
    expect(classifyRisk(quiet, daysAgo(-6, NOW))?.level).toBe('critical')
  })

  it('reads the clock at the call when it is given no time, and not when the file loaded', () => {
    vi.useFakeTimers()
    const stale = job({ lastStatusChange: new Date(2026, 9, 10, 9, 0) })

    vi.setSystemTime(new Date(2026, 9, 18, 9, 0))
    expect(classifyRisk(stale)?.level).toBe('critical')

    vi.setSystemTime(new Date(2026, 9, 11, 9, 0))
    expect(classifyRisk(stale)).toBeNull()
  })

  it('does not read a finished job as stale', () => {
    expect(classifyRisk(job({ status: 'complete', lastStatusChange: daysAgo(30) }), NOW)).toBeNull()
  })
})

describe('scoreJob', () => {
  it.each([
    [1, 0],
    [2, 10],
    [3, 20],
    [7, 35],
  ])('adds to the score of a job last changed %i days before the time it is given: %i', (days, score) => {
    expect(scoreJob(job({ lastStatusChange: daysAgo(days) }), [], NOW)).toBe(score)
  })

  it('reads the clock at the call when it is given no time', () => {
    vi.useFakeTimers()
    const stale = job({ lastStatusChange: new Date(2026, 9, 10, 9, 0) })

    vi.setSystemTime(new Date(2026, 9, 18, 9, 0))
    expect(scoreJob(stale)).toBe(35)

    vi.setSystemTime(new Date(2026, 9, 11, 9, 0))
    expect(scoreJob(stale)).toBe(0)
  })
})

describe('daysSince', () => {
  it('is the date library function, so the screens and the scoring count a day the same way', () => {
    expect(daysSince('2026-10-15', NOW)).toBe(3)
    expect(daysSince(daysAgo(5), NOW)).toBe(5)
    expect(daysSince(undefined, NOW)).toBeNull()
  })
})
