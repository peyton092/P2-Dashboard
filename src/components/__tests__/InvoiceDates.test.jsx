import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// An invoice date is a bare day, 10/01/2026 in the seed and 2026-10-01 from a form, and
// the Date constructor reads either spelling written as year, month, day as midnight
// UTC, which in Nashville is the evening before. Read that way, an invoice dated the 1st
// lands in the month before, an invoice ages from the evening before it was dated, and
// the last 30 days start a day late for part of every evening. The dollars of the month
// and the aging of what is owed hang on these, so each case runs in three zones that the
// test sets itself by assigning process.env.TZ, which Node honours at once: Chicago is
// behind UTC, Auckland is ahead of it, and UTC is the control, where a wrong reading
// passes. The clock is pinned to a local time in each zone. Everything that would reach
// Firebase is replaced.
const mocks = vi.hoisted(() => ({ data: { jobs: [], extras: [], loading: false } }))

vi.mock('../../firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  onSnapshot: () => () => {},
}))
vi.mock('../../hooks/useFirestore', () => ({ updateJob: vi.fn() }))
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import BillingQueue from '../BillingQueue'
import CommandCenter from '../CommandCenter'

const ZONES = ['America/Chicago', 'Pacific/Auckland', 'UTC']

const originalZone = process.env.TZ

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

// The clock at a local time, once the zone is in effect.
function at(zone, parts) {
  process.env.TZ = zone
  vi.setSystemTime(new Date(...parts))
}

// An invoiced job that is owed $1,000.
const invoiced = (id, invoiceDate) => ({
  id, name: `Job ${id}`, status: 'active', billingStatus: 'invoiced', invoiceNum: id, invoiceDate, invoiceAmount: 1000, contractValue: 5000,
})

const showJobs = (jobs) => {
  mocks.data = { jobs, extras: [], loading: false }
}

// The cell of a strip of figures, by its label, as its label, figure and words.
const stat = (label) => {
  const cell = screen.getByText(label, { selector: 'span' }).closest('[data-slot="stat"]')
  const [name, figure, ...words] = [...cell.querySelectorAll('span')].map((span) => span.textContent)
  return { name, figure, words: words.join(' ') }
}

describe.each(ZONES)('the billing queue in %s', (zone) => {
  it('counts an invoice dated the 1st in its own month, written either way', () => {
    at(zone, [2026, 9, 1, 9, 0])
    showJobs([invoiced('J1', '10/01/2026'), invoiced('J2', '2026-10-01'), invoiced('J3', '09/30/2026')])
    render(<BillingQueue />)
    expect(stat('Invoiced This Month').words).toBe('2 invoices')
  })

  it('counts an invoice dated the last day of the month in that month, and the 1st of the next in the next', () => {
    at(zone, [2026, 9, 31, 23, 0])
    showJobs([invoiced('J1', '10/31/2026'), invoiced('J2', '11/01/2026'), invoiced('J3', '2026-11-01')])
    render(<BillingQueue />)
    expect(stat('Invoiced This Month').words).toBe('1 invoice')
  })

  // An invoice dated Sep 19 is 29 days old at any time on Oct 18, and one dated Sep 18
  // is 30 days old at midnight and ages from then. Read as midnight UTC, the first was
  // 30 days old from 7 pm in Chicago, and the second was not 30 days old until the
  // afternoon in Auckland.
  it.each([
    ['29 days old in the evening', [2026, 9, 18, 21, 30], '09/19/2026', '0'],
    ['29 days old just after midnight', [2026, 9, 18, 0, 30], '2026-09-19', '0'],
    ['30 days old at midnight', [2026, 9, 18, 0, 0], '09/18/2026', '1'],
    ['30 days old in the morning', [2026, 9, 18, 8, 0], '2026-09-18', '1'],
    ['30 days old in the evening', [2026, 9, 18, 21, 30], '09/18/2026', '1'],
    ['31 days old at midnight', [2026, 9, 18, 0, 0], '09/17/2026', '1'],
  ])('ages an invoice that is %s from the start of the day it is dated', (_what, parts, invoiceDate, aging) => {
    at(zone, parts)
    showJobs([invoiced('J1', invoiceDate)])
    render(<BillingQueue />)
    expect(stat('Aging 30+').figure).toBe(aging)
  })

  // The Date constructor moves a day the month does not have into the next month, so an
  // invoice dated September 31 would be counted as dated October 1.
  it('leaves out an invoice dated a day the month does not have, instead of moving it into the next month', () => {
    at(zone, [2026, 9, 18, 12, 0])
    showJobs([invoiced('J1', '09/31/2026'), invoiced('J2', '2026-09-31')])
    render(<BillingQueue />)
    expect(stat('Invoiced This Month').words).toBe('0 invoices')
    expect(stat('Aging 30+').figure).toBe('0')
  })

  it('ages an invoice that carries a time from that moment', () => {
    // 11 pm on Sep 18 in Chicago is 4 am on Sep 19 in UTC; it is 29 days and 22 hours old at 9 pm on Oct 18.
    at(zone, [2026, 9, 18, 21, 30])
    showJobs([invoiced('J1', new Date(2026, 8, 18, 23, 0).toISOString())])
    render(<BillingQueue />)
    expect(stat('Aging 30+').figure).toBe('0')
  })
})

describe.each(ZONES)('the Command Center in %s', (zone) => {
  const recentlyInvoiced = () => screen.getByText('Recently Invoiced').closest('li').querySelector('p:nth-child(2)').textContent

  // The last 30 days start at this time of day, 30 days back. An invoice dated that day
  // is on the right side of the line at midnight and on the other side from then on.
  it.each([
    ['30 days old at midnight', [2026, 9, 18, 0, 0], '09/18/2026', '1 item'],
    ['30 days old in the morning', [2026, 9, 18, 8, 0], '09/18/2026', '0 items'],
    ['29 days old in the evening', [2026, 9, 18, 21, 30], '09/19/2026', '1 item'],
    ['29 days old in the evening, written the other way', [2026, 9, 18, 21, 30], '2026-09-19', '1 item'],
    ['31 days old at midnight', [2026, 9, 18, 0, 0], '09/17/2026', '0 items'],
    ['31 days old at midnight, written the other way', [2026, 9, 18, 0, 0], '2026-09-17', '0 items'],
  ])('puts an invoice that is %s on the right side of the last 30 days', (_what, parts, invoiceDate, expected) => {
    at(zone, parts)
    showJobs([invoiced('J1', invoiceDate)])
    render(<CommandCenter />)
    expect(recentlyInvoiced()).toContain(expected)
  })

  it('leaves out an invoice dated a day the month does not have', () => {
    at(zone, [2026, 9, 18, 12, 0])
    showJobs([invoiced('J1', '09/31/2026'), invoiced('J2', '2026-09-31')])
    render(<CommandCenter />)
    expect(recentlyInvoiced()).toContain('0 items')
  })

  it('leaves out an invoice that is paid, however new it is', () => {
    at(zone, [2026, 9, 18, 12, 0])
    showJobs([{ ...invoiced('J1', '10/17/2026'), billingStatus: 'paid' }])
    render(<CommandCenter />)
    expect(recentlyInvoiced()).toContain('0 items')
  })
})
