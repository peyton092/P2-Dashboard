import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The form saves a new change order with the day it is today, as 2026-10-18, and the
// card on a phone shows it on a Dated pill. The pill has to name the day that was
// saved, at every hour of the day. A bare date handed to the Date constructor means
// midnight UTC, which in Nashville is the evening before, so a pill that reads the
// saved text that way names the day before from midnight to midnight, and a person
// reads their own change order as dated yesterday. Everything that would reach
// Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], extras: [], loading: false },
  addDoc: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('firebase/firestore', () => ({
  addDoc: mocks.addDoc,
  updateDoc: vi.fn(),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  collection: (_db, ...path) => ({ path: path.join('/') }),
  serverTimestamp: () => 'SERVER_TIME',
}))
vi.mock('../../hooks/useFirestore', () => ({
  withAuthor: (data) => data,
  sendExtraToBuilder: vi.fn(),
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import ChangeOrders from '../ChangeOrders'

const JOB = { id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', pm: 'Blake Neblett' }
const LINE = { desc: 'Backflow preventer', qty: 1, unit: 'EA', unitPrice: 4000, extPrice: 4000 }
const stored = (date) => ({
  _docId: 'x1', coNumber: 'CO-2026-001', job: 'QBS-003', date, status: 'Draft',
  lineItems: [LINE], markupPct: 15, notes: '', amount: 4600, total: 4600, desc: 'CO-2026-001: Backflow preventer',
})

const originalZone = process.env.TZ

beforeEach(() => {
  mocks.addDoc.mockReset().mockResolvedValue({ id: 'new1' })
  mocks.data = { jobs: [JOB], extras: [], loading: false }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const open = () => render(<ToastContext.Provider value={mocks.toast}><ChangeOrders /></ToastContext.Provider>)

// A brand new change order, saved as a draft; what the form wrote is what addDoc got.
async function saveNewChangeOrder() {
  open()
  fireEvent.click(screen.getAllByRole('button', { name: /New CO/ })[0])
  fireEvent.click(screen.getAllByRole('combobox')[0])
  fireEvent.click(await screen.findByRole('option', { name: /QBS-003/ }))
  fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Backflow preventer' } })
  fireEvent.click(screen.getByRole('button', { name: /Save Draft/ }))
  await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1))
  return mocks.addDoc.mock.calls[0][1].date
}

describe('the Dated pill on the card of a change order', () => {
  // Oct 18, 2026 is in daylight time, so in Nashville UTC is already the 19th from
  // 7 pm. Every hour is here, because a pill that is wrong is wrong all day.
  it.each([
    ['just after midnight', [0, 15]],
    ['early in the morning', [6, 0]],
    ['at noon', [12, 0]],
    ['late in the afternoon', [17, 45]],
    ['in the evening, when UTC has turned to the next day', [19, 30]],
    ['at half past nine at night', [21, 30]],
    ['a minute before midnight', [23, 59]],
  ])('names the day the form saved, %s', async (_when, [hour, minute]) => {
    process.env.TZ = 'America/Chicago'
    // Only the clock is faked, so the screen can still wait for its list.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 18, hour, minute))

    const savedDay = await saveNewChangeOrder()
    expect(savedDay).toBe('2026-10-18')

    cleanup()
    mocks.data = { jobs: [JOB], extras: [stored(savedDay)], loading: false }
    open()

    expect(screen.getAllByText('Dated Oct 18, 2026').length).toBeGreaterThan(0)
    expect(screen.queryByText('Dated Oct 17, 2026')).toBeNull()
  })

  it.each([
    ['America/Chicago'],
    ['Pacific/Auckland'],
    ['UTC'],
  ])('names the day of a saved date, in %s', (zone) => {
    process.env.TZ = zone
    mocks.data = { jobs: [JOB], extras: [stored('2026-03-01')], loading: false }
    open()
    expect(screen.getAllByText('Dated Mar 1, 2026').length).toBeGreaterThan(0)
  })
})
