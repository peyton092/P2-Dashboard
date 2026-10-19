import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { axe } from '@/test/axe'

// A status told by its color alone is lost on anyone who cannot tell the colors apart, and
// on a screen reader. The calendar says whether an inspection passed or failed in words,
// and the War Room says in words what each inspection mark means, a pending one included.
// Everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({ data: { jobs: [], extras: [], loading: false } }))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({ updateJob: vi.fn() }))
// The chip in every page header asks this hook for the connection; the real one starts Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import Calendar from '../Calendar'
import WarRoom from '../WarRoom'

beforeEach(() => {
  // Noon on the 18th of October, so the calendar opens on October.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the calendar', () => {
  const JOB = {
    id: 'QBS-003',
    name: 'Lee Residence',
    status: 'active',
    target: '2026-10-28',
    insp: {
      electrical: { roughIn: 'failed', roughInDate: '2026-10-06' },
      plumbing: { roughIn: 'passed', roughInDate: '2026-10-08', final: 'passed', finalDate: '2026-10-20' },
    },
  }

  it('says in words whether each inspection passed or failed', () => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
    render(<Calendar />)

    expect(screen.getByRole('button', { name: 'Failed QBS-003 electrical rough in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Passed QBS-003 plumbing rough in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Passed QBS-003 plumbing final' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Target Lee Residence' })).toBeTruthy()
  })

  // The date on a phase is the day its result was recorded, and a phase set back to scheduled
  // or pending keeps it. That day says nothing about the phase any more, so the calendar shows
  // it only while the phase still passed or failed, and never calls a scheduled one passed.
  it('shows an inspection on its day only while its result stands', () => {
    mocks.data = {
      jobs: [{
        id: 'QBS-003',
        name: 'Lee Residence',
        status: 'active',
        insp: {
          electrical: { roughIn: 'scheduled', roughInDate: '2026-10-06' },
          plumbing: { roughIn: 'pending', roughInDate: '2026-10-07', final: 'blocked', finalDate: '2026-10-09' },
          hvac: { roughIn: 'failed', roughInDate: '2026-10-12', final: 'n/a', finalDate: '2026-10-14' },
        },
      }],
      extras: [],
      loading: false,
    }
    render(<Calendar />)

    expect(screen.queryByRole('button', { name: /electrical/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /plumbing/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /hvac final/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Failed QBS-003 hvac rough in' })).toBeTruthy()
    expect(screen.getByText('1 event this month')).toBeTruthy()
  })

  it('marks today as the current date', () => {
    render(<Calendar />)
    expect([...document.querySelectorAll('[aria-current="date"]')].map((day) => day.textContent)).toEqual(['18'])
  })

  it('has no accessibility violations', async () => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
    const { container } = render(<Calendar />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('the inspection marks of the War Room', () => {
  const JOB = {
    id: 'QBS-007',
    name: 'Hillsboro Pike',
    status: 'active',
    start: '2026-10-01',
    target: '2026-11-20',
    insp: {
      electrical: { roughIn: 'pending' },
      plumbing: { roughIn: 'passed' },
      hvac: { roughIn: 'passed', final: 'failed' },
    },
  }

  beforeEach(() => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
  })

  // The board is drawn twice, as a table and as cards, and a job this far behind is in the
  // Top Priority panel as well, so each mark is there more than once.
  it('say what each mark means in words', () => {
    render(<WarRoom />)

    for (const words of ['Electrical rough in pending', 'Plumbing rough in passed', 'HVAC final failed']) {
      expect(screen.getAllByText(words).length, words).toBeGreaterThanOrEqual(2)
    }
  })

  it('show a pending inspection as Pending, and not by its gray alone', () => {
    render(<WarRoom />)

    for (const words of screen.getAllByText('Electrical rough in pending')) {
      expect(within(words.parentElement).getByText('Pending')).toBeTruthy()
    }
  })
})
