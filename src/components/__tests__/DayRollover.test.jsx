import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

// A tab left open overnight must move on to the next day by itself: the date in a
// header, the days since something and the days to go. These render two screens in
// Nashville's zone with fake timers, a minute before midnight, and let the minute pass.
// Everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({ data: { jobs: [], extras: [], loading: false } }))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({ updateJob: vi.fn() }))
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import Calendar from '../Calendar'
import WarRoom from '../WarRoom'

const originalZone = process.env.TZ

beforeEach(() => {
  // Half past eleven at night on the 18th in Nashville is half past four in the morning
  // on the 19th in UTC, which is the day a screen that reads UTC would show.
  process.env.TZ = 'America/Chicago'
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 30))
  mocks.data = { jobs: [], extras: [], loading: false }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const oneMinute = () => act(() => { vi.advanceTimersByTime(60_000) })

describe('Calendar', () => {
  // The marked day is the only day number on a colored background.
  const markedDay = () => [...document.querySelectorAll('span')]
    .filter((span) => /^\d{1,2}$/.test(span.textContent) && span.style.backgroundColor)
    .map((span) => span.textContent)

  it('marks the local day, and marks the next one when midnight passes', () => {
    render(<Calendar />)
    expect(markedDay()).toEqual(['18'])

    oneMinute()

    expect(markedDay()).toEqual(['19'])
  })
})

describe('War Room', () => {
  // Started on the 15th with no status change since, due on the 20th.
  const job = { id: 'QBS-001', name: 'Lee Residence', status: 'active', start: '2026-10-15', target: '2026-10-20' }

  it('moves the date, the days since the last update and the days to go on at midnight', () => {
    mocks.data = { jobs: [job], extras: [], loading: false }
    render(<WarRoom />)
    expect(screen.getByText('Sunday, October 18')).toBeTruthy()
    expect(screen.getAllByText('3d ago').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Due in 2d').length).toBeGreaterThan(0)

    oneMinute()

    expect(screen.getByText('Monday, October 19')).toBeTruthy()
    expect(screen.getAllByText('4d ago').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Due in 1d').length).toBeGreaterThan(0)
    expect(screen.queryByText('3d ago')).toBeNull()
  })
})
