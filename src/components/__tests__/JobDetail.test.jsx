import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { hexToRgb } from '@/lib/tokens'
import { toneText } from '@/lib/status'

// The job page reads every status it shows from src/lib/status.js: the job's
// own, its inspections by trade and phase, its billing and its change orders.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], extras: [], materials: [], dailyReports: [] },
  toast: vi.fn(),
}))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({ useJobFiles: () => ({ files: [], loading: false, error: null }) }))

import JobDetail from '../JobDetail'

// The words of a status are small, so they are in the text color of its tone (see toneText).
const rgb = (tone) => `rgb(${hexToRgb(toneText(tone)).join(', ')})`
const JOB = {
  id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', status: 'on-track', progress: 40,
  insp: {
    electrical: { roughIn: 'passed', trim: 'scheduled', final: 'pending-verification' },
    plumbing: { roughIn: 'failed', final: 'n/a' },
  },
}
const extra = (status, id) => ({ id, _docId: id, job: 'QBS-003', desc: `Change ${id}`, status, amount: 100 })

function show(job = JOB, extras = []) {
  mocks.data = { jobs: [job], extras, materials: [], dailyReports: [] }
  render(<ToastContext.Provider value={mocks.toast}><JobDetail jobId="QBS-003" onBack={() => {}} /></ToastContext.Provider>)
}

beforeEach(() => { mocks.data = { jobs: [], extras: [], materials: [], dailyReports: [] } })
afterEach(cleanup)

// The panel of one trade, found by its name.
const trade = (name) => screen.getByText(name).closest('div.rounded-xl')

describe('the inspections of a job', () => {
  it('names each phase in the words of the vocabulary', () => {
    show()
    const electrical = within(trade('electrical'))
    expect(['Rough in', 'Trim', 'Final'].every((phase) => electrical.getByText(phase))).toBe(true)
    expect(screen.queryByText(/Rough-In/)).toBeNull()
  })

  it.each([
    ['electrical', 'Passed', 'success'],
    ['electrical', 'Scheduled', 'warning'],
    ['electrical', 'Pending verification', 'mute'],
    ['plumbing', 'Failed', 'critical'],
    ['plumbing', 'N/A', 'neutral'],
  ])('shows the %s status %s in the %s tone', (name, words, tone) => {
    show()
    expect(within(trade(name)).getByText(words).style.color).toBe(rgb(tone))
  })

  it('shows a phase with no status as not started', () => {
    show({ ...JOB, insp: { hvac: { roughIn: undefined, final: 'passed' } } })
    expect(within(trade('hvac')).getByText('Not started')).toBeTruthy()
  })
})

describe('the status of a job', () => {
  it('reads the job status as words, not as the stored key', () => {
    show()
    expect(screen.getByText('On track')).toBeTruthy()
    expect(screen.queryByText('on-track')).toBeNull()
  })

  it.each([
    [undefined, 'Not invoiced'],
    ['not-invoiced', 'Not invoiced'],
    ['partial-pay', 'Partial pay'],
    ['hold', 'On hold'],
  ])('reads billing status %s as %s', (billingStatus, words) => {
    show({ ...JOB, billingStatus })
    expect(within(screen.getByText('Billing').parentElement.parentElement).getByText(words)).toBeTruthy()
  })
})

describe('the change orders of a job', () => {
  it.each([
    ['Draft', 'Draft', 'mute'],
    ['Sent to Builder', 'Sent to builder', 'info'],
    ['pending', 'Sent to builder', 'info'],
    ['Approved', 'Approved', 'success'],
    ['approved', 'Approved', 'success'],
    ['Rejected', 'Rejected', 'critical'],
  ])('shows status %s as %s in the %s tone', (status, words, tone) => {
    show(JOB, [extra(status, 'CO-001')])
    const row = screen.getByText('CO-001').parentElement
    expect(within(row).getByText(words).style.color).toBe(rgb(tone))
  })
})
