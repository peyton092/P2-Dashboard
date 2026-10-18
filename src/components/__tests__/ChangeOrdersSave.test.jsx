import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The Change Orders screen saves a change order as a draft and, for Send to
// Builder, asks the sendExtraToBuilder Cloud Function to send it. The function
// sets the status, the send times, the notification and the history entry, so
// the screen writes none of them. Everything that would reach Firebase is
// replaced.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], extras: [], loading: false },
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  sendExtraToBuilder: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ db: {}, auth: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('firebase/firestore', () => ({
  addDoc: mocks.addDoc,
  updateDoc: mocks.updateDoc,
  doc: (_db, ...path) => ({ path: path.join('/') }),
  collection: (_db, ...path) => ({ path: path.join('/') }),
  serverTimestamp: () => 'SERVER_TIME',
}))
vi.mock('../../hooks/useFirestore', () => ({
  withAuthor: (data) => ({ ...data, createdBy: 'u1', createdByEmail: 'pat@p2em.com' }),
  sendExtraToBuilder: mocks.sendExtraToBuilder,
}))

import ChangeOrders from '../ChangeOrders'

const JOB = { id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', pm: 'Blake Neblett' }
const LINE = { desc: 'Backflow preventer', qty: 1, unit: 'EA', unitPrice: 4000, extPrice: 4000 }
const saved = (over) => ({
  _docId: 'x1', coNumber: 'CO-2026-001', id: undefined, job: 'QBS-003', date: '2026-10-01', status: 'Draft',
  lineItems: [LINE], markupPct: 15, notes: '', amount: 4600, total: 4600, desc: 'CO-2026-001 — Backflow preventer', ...over,
})

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const mock of [mocks.addDoc, mocks.updateDoc, mocks.sendExtraToBuilder, mocks.toast]) mock.mockReset()
  mocks.addDoc.mockResolvedValue({ id: 'new1' })
  mocks.updateDoc.mockResolvedValue(undefined)
  mocks.sendExtraToBuilder.mockResolvedValue({ ok: true })
  mocks.data = { jobs: [JOB], extras: [], loading: false }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const open = () => render(<ToastContext.Provider value={mocks.toast}><ChangeOrders /></ToastContext.Provider>)
const openSaved = (over) => {
  mocks.data.extras = [saved(over)]
  open()
  fireEvent.click(screen.getAllByTitle('Edit / re-send')[0])
}
const send = () => screen.getByRole('button', { name: /Send to Builder|Sending/ })
const saveDraft = () => screen.getByRole('button', { name: /Save Draft/ })

// A brand new change order: pick the job, describe one line.
async function startNew() {
  open()
  fireEvent.click(screen.getAllByRole('button', { name: /New CO/ })[0])
  fireEvent.click(screen.getAllByRole('combobox')[0])
  fireEvent.click(await screen.findByRole('option', { name: /QBS-003/ }))
  fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Backflow preventer' } })
}

describe('saving a change order', () => {
  it('writes the fields of a new change order as a draft, with no qbs flag and no send time', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1))
    const data = mocks.addDoc.mock.calls[0][1]
    expect(data.status).toBe('Draft')
    expect(data.job).toBe('QBS-003')
    expect(data.createdBy).toBe('u1')
    expect(data.createdByEmail).toBe('pat@p2em.com')
    expect('qbs' in data).toBe(false)
    expect('sentAt' in data).toBe(false)
    expect('qbsSentAt' in data).toBe(false)
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
  })

  it('Save Draft does not send, and leaves the form for the list', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('Send to Builder saves the draft first and then sends it by the id the save returned', async () => {
    await startNew()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.sendExtraToBuilder).toHaveBeenCalledTimes(1))
    expect(mocks.sendExtraToBuilder).toHaveBeenCalledWith('new1')
    expect(mocks.addDoc.mock.calls[0][1].status).toBe('Draft')
    expect(mocks.addDoc.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendExtraToBuilder.mock.invocationCallOrder[0])
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('sends an existing change order by its document id after updating it, writing no status', async () => {
    openSaved()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.sendExtraToBuilder).toHaveBeenCalledWith('x1'))
    expect(mocks.addDoc).not.toHaveBeenCalled()
    const [ref, data] = mocks.updateDoc.mock.calls[0]
    expect(ref.path).toBe('extras/x1')
    for (const key of ['status', 'qbs', 'sentAt', 'qbsSentAt']) expect(key in data, key).toBe(false)
  })

  it('re-sends one the builder sent back for revision', async () => {
    openSaved({ status: 'Rejected', rejectNotes: 'Use the 200A panel' })
    fireEvent.click(send())
    await waitFor(() => expect(mocks.sendExtraToBuilder).toHaveBeenCalledWith('x1'))
  })

  it('never writes a status over an existing one, so a save cannot undo a decision', async () => {
    for (const status of ['Draft', 'Sent to Builder', 'Approved', 'Rejected']) {
      openSaved({ status })
      fireEvent.click(saveDraft())
      await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1))
      expect('status' in mocks.updateDoc.mock.calls[0][1], status).toBe(false)
      cleanup()
      mocks.updateDoc.mockClear()
    }
  })

  it('gives a change order that has no status a draft status when it is saved', async () => {
    openSaved({ status: undefined })
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1))
    expect(mocks.updateDoc.mock.calls[0][1].status).toBe('Draft')
  })

  it('shows the status as it is, and cannot be changed from the form', () => {
    openSaved({ status: 'Sent to Builder' })
    // The form has three lists: the job, the status and the unit of the first line.
    const [job, status] = screen.getAllByRole('combobox')
    expect(job.disabled).toBe(false)
    expect(status.disabled).toBe(true)
    expect(screen.getByText('Set when the change order is sent, approved or rejected.')).toBeTruthy()
  })
})

describe('when a save or a send fails', () => {
  it('says so, and sends nothing, when the draft could not be saved', async () => {
    mocks.addDoc.mockRejectedValue(new Error('Missing or insufficient permissions.'))
    await startNew()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not save the change order',
      description: 'Missing or insufficient permissions.',
    })
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Describe the work…')).toBeTruthy()
  })

  it('says the draft was saved but not sent, with the reason, and keeps the form open', async () => {
    mocks.sendExtraToBuilder.mockRejectedValue(sdkError('failed-precondition', 'This change order is already approved.'))
    await startNew()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Saved, but not sent',
      description: 'This change order is already approved.',
    })
    expect(screen.getByPlaceholderText('Describe the work…')).toBeTruthy()
    expect(send().disabled).toBe(false)
  })

  it('shows a plain message when no reply came back, not the bare code', async () => {
    mocks.sendExtraToBuilder.mockRejectedValue(sdkError('internal', 'internal'))
    await startNew()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0].description).toBe('Try Send to Builder again.')
  })

  it('sends the saved draft again instead of adding a second change order', async () => {
    mocks.sendExtraToBuilder.mockRejectedValueOnce(sdkError('internal', 'internal'))
    await startNew()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))

    fireEvent.click(send())
    await waitFor(() => expect(mocks.sendExtraToBuilder).toHaveBeenCalledTimes(2))
    expect(mocks.sendExtraToBuilder).toHaveBeenLastCalledWith('new1')
    expect(mocks.addDoc).toHaveBeenCalledTimes(1)
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1)
    expect(mocks.updateDoc.mock.calls[0][0].path).toBe('extras/new1')
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
  })
})
