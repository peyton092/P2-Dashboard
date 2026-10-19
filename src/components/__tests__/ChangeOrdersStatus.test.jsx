import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { hexToRgb } from '@/lib/tokens'
import { toneText } from '@/lib/status'

// The Change Orders screen shows each change order's status in the words and
// tone of src/lib/status.js, whatever the casing it was stored with. Everything
// that would reach Firebase is replaced, as in the save tests.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], extras: [], loading: false },
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
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
const saved = (over) => ({
  _docId: 'x1', coNumber: 'CO-2026-001', job: 'QBS-003', date: '2026-10-01', status: 'Draft',
  lineItems: [LINE], markupPct: 15, notes: '', amount: 4600, total: 4600, desc: 'CO-2026-001: Backflow preventer', ...over,
})

// The words of a pill are in the text color of its tone (see toneText).
const rgb = (tone) => `rgb(${hexToRgb(toneText(tone)).join(', ')})`
const open = () => render(<ToastContext.Provider value={mocks.toast}><ChangeOrders /></ToastContext.Provider>)

beforeEach(() => { mocks.data = { jobs: [JOB], extras: [], loading: false } })
afterEach(cleanup)

// A status pill is a span that carries its own color; a filter chip is a button.
const pills = (words) => screen.queryAllByText(words).filter((element) => element.tagName === 'SPAN' && element.style.color)

// The words in the status control of the form that is open.
function formStatus() {
  const field = screen.getByText('Status').parentElement
  return within(field).getByRole('combobox').querySelector('[data-slot="select-value"]').textContent
}

describe('the status pill of a change order', () => {
  it.each([
    ['Draft', 'Draft', 'mute'],
    ['Sent to Builder', 'Sent to builder', 'info'],
    ['Approved', 'Approved', 'success'],
    ['Rejected', 'Rejected', 'critical'],
    ['pending', 'Sent to builder', 'info'],
    ['approved', 'Approved', 'success'],
    ['rejected', 'Rejected', 'critical'],
  ])('shows status %s as %s in the %s tone', (status, words, tone) => {
    mocks.data.extras = [saved({ status })]
    open()
    const found = pills(words)
    expect(found.length, `a pill that reads ${words}`).toBeGreaterThan(0)
    for (const pill of found) expect(pill.style.color).toBe(rgb(tone))
  })

  it('shows a change order with no status as a draft', () => {
    mocks.data.extras = [saved({ status: undefined })]
    open()
    expect(pills('Draft').length).toBeGreaterThan(0)
  })

  it('writes the status of one being edited in the same words', () => {
    mocks.data.extras = [saved({ status: 'Sent to Builder' })]
    open()
    fireEvent.click(screen.getAllByTitle('Edit or resend')[0])
    expect(formStatus()).toBe('Sent to builder')
  })

  // The list pill, the PDF and statusOnSave all call a change order with no status
  // a draft, so its form must too, and not read it as waiting for the builder.
  it('writes a change order with no status as Draft in its form, as the list does', () => {
    mocks.data.extras = [saved({ status: undefined })]
    open()
    expect(pills('Draft').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByTitle('Edit or resend')[0])
    expect(formStatus()).toBe('Draft')
  })
})
