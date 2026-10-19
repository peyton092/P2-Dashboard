import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The billing queue marks a job invoiced, puts it on hold and takes it off, and keeps an
// invoice number. Submitting an invoice is asked about first, because it tells the client
// the job is invoiced, and the question stays open under the Working button while the write
// is out. The number is saved when the person leaves the box. The box follows what is stored
// while nothing is typed in it, so leaving it never writes an old copy back over a newer one,
// and what is typed stays in it until it is saved, through the apply of the write to
// Firestore's cache, which changes the stored number at once, and through the rollback of a
// write the rules refuse, which changes it back, so it can be tried again.
const mocks = vi.hoisted(() => ({
  updateJob: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../hooks/useFirestore', () => ({ updateJob: mocks.updateJob }))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import { BillingActions, InvoiceNumberInput } from '../BillingQueue'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const JOB = { id: 'QBS-003', _docId: 'job3', billingStatus: 'not-invoiced' }

beforeEach(() => {
  mocks.updateJob.mockReset()
  mocks.toast.mockReset()
})

afterEach(cleanup)

const withToast = (ui) => <ToastContext.Provider value={mocks.toast}>{ui}</ToastContext.Provider>
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)
const press = (el) => act(async () => { fireEvent.click(el) })
// Base UI puts focus inside a dialog on the next animation frame after it mounts. A test
// that presses a button in it waits for that first, or the frame lands later on a slow
// machine, on top of what the test did.
const ask = async (name) => {
  const dialog = await screen.findByRole('dialog', { name })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
}
const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

describe('submitting an invoice', () => {
  const openIt = (job = JOB) => render(withToast(<BillingActions job={job} />))
  const submit = () => screen.getByRole('button', { name: /^(Submit invoice|…)$/ })

  it('asks first, says which job, and writes nothing until it is confirmed', async () => {
    openIt()
    fireEvent.click(submit())
    const dialog = await ask('Submit this invoice?')

    expect(within(dialog).getByText('QBS-003 is marked invoiced, and the client sees the invoice as submitted.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Submit invoice' }).classList.contains('bg-brand')).toBe(true)
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('writes the status once it is confirmed, and says so when the dialog has closed', async () => {
    openIt()
    fireEvent.click(submit())
    const dialog = await ask('Submit this invoice?')

    await press(within(dialog).getByRole('button', { name: 'Submit invoice' }))

    expect(mocks.updateJob).toHaveBeenCalledTimes(1)
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { billingStatus: 'invoiced' })
    await gone()
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'QBS-003 marked invoiced.' }])
  })

  it('stays open reading Working while the write is out, and closes when it is in', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    openIt()
    fireEvent.click(submit())
    const dialog = await ask('Submit this invoice?')

    await press(within(dialog).getByRole('button', { name: 'Submit invoice' }))

    expect(within(dialog).getByRole('button', { name: 'Working' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.toast).not.toHaveBeenCalled()

    await act(async () => { write.resolve() })
    await gone()
    expect(toastCalls()).toHaveLength(1)
  })

  // The write is applied on the screen at once, so the job turns invoiced while the server
  // is still confirming it. The question has to stay until the server has answered.
  it('stays on the screen reading Working when the job turns invoiced under it', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = openIt()
    fireEvent.click(submit())
    const dialog = await ask('Submit this invoice?')
    await press(within(dialog).getByRole('button', { name: 'Submit invoice' }))

    rerender(withToast(<BillingActions job={{ ...JOB, billingStatus: 'invoiced' }} />))

    expect(screen.getByText('Invoiced')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Working' })).toBeTruthy()

    await act(async () => { write.resolve() })
    await gone()
  })

  it('writes nothing when it is cancelled', async () => {
    openIt()
    fireEvent.click(submit())
    const dialog = await ask('Submit this invoice?')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('stays open under the error toast when the write is refused, so it can be tried again', async () => {
    mocks.updateJob.mockRejectedValueOnce(refused())
    openIt()
    fireEvent.click(submit())
    const dialog = await ask('Submit this invoice?')

    await press(within(dialog).getByRole('button', { name: 'Submit invoice' }))

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not submit the invoice. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(screen.getByRole('dialog')).toBeTruthy()

    await press(within(dialog).getByRole('button', { name: 'Submit invoice' }))
    expect(mocks.updateJob).toHaveBeenCalledTimes(2)
    await gone()
  })

  it('asks nothing, and writes nothing, for a job with no document', async () => {
    openIt({ id: 'QBS-009', billingStatus: 'not-invoiced' })
    fireEvent.click(submit())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('shows an invoiced job as Invoiced, with no button', () => {
    openIt({ ...JOB, billingStatus: 'invoiced' })
    expect(screen.getByText('Invoiced')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the billing hold', () => {
  it('puts a job on hold without asking, and says so', async () => {
    render(withToast(<BillingActions job={JOB} />))
    await press(screen.getByRole('button', { name: 'Hold' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { billingStatus: 'hold' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'QBS-003 put on billing hold.' }])
  })

  it('says it could not place the hold, with the reason, when the write is refused', async () => {
    mocks.updateJob.mockRejectedValue(refused())
    render(withToast(<BillingActions job={JOB} />))
    await press(screen.getByRole('button', { name: 'Hold' }))

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not place the hold. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(screen.getByRole('button', { name: 'Hold' }).disabled).toBe(false)
  })

  it('releases a hold back to not invoiced, and says so', async () => {
    render(withToast(<BillingActions job={{ ...JOB, billingStatus: 'hold' }} />))
    await press(screen.getByRole('button', { name: 'Release hold' }))

    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { billingStatus: 'not-invoiced' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Hold released on QBS-003.' }])
  })

  it('says it could not release the hold, with the reason, when the write is refused', async () => {
    mocks.updateJob.mockRejectedValue(refused())
    render(withToast(<BillingActions job={{ ...JOB, billingStatus: 'hold' }} />))
    await press(screen.getByRole('button', { name: 'Release hold' }))

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not release the hold. Try again.',
      description: 'You do not have permission to do that.',
    }])
  })

  it('switches only the hold button off while the hold is being written', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    render(withToast(<BillingActions job={JOB} />))
    await press(screen.getByRole('button', { name: 'Hold' }))

    expect(screen.getByRole('button', { name: '…', exact: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit invoice' }).disabled).toBe(false)
    await act(async () => { write.resolve() })
  })
})

describe('the invoice number', () => {
  const field = () => screen.getByPlaceholderText('Inv #')
  const view = (job) => withToast(<InvoiceNumberInput job={job} />)

  it('shows the stored number, and writes nothing while the person types', () => {
    render(withToast(<InvoiceNumberInput job={{ ...JOB, invoiceNum: 'INV-100' }} />))
    expect(field().value).toBe('INV-100')
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('saves the number when the person leaves the box, and says so', async () => {
    render(withToast(<InvoiceNumberInput job={JOB} />))
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    await act(async () => { fireEvent.blur(field()) })

    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { invoiceNum: 'INV-1001' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Invoice number saved.' }])
  })

  it('says saving from the moment the box is left until the server has answered, across the apply of the write', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    await act(async () => { fireEvent.blur(field()) })
    expect(screen.getByText('saving…')).toBeTruthy()

    // Firestore applies the write to its cache at once, so the stored number is the new one.
    rerender(view({ ...JOB, invoiceNum: 'INV-1001' }))
    expect(screen.getByText('saving…')).toBeTruthy()
    expect(field().value).toBe('INV-1001')

    await act(async () => { write.resolve() })
    expect(screen.queryByText('saving…')).toBeNull()
    expect(field().value).toBe('INV-1001')
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Invoice number saved.' }])
  })

  it('writes nothing when the person leaves the box without a change', () => {
    render(withToast(<InvoiceNumberInput job={{ ...JOB, invoiceNum: 'INV-100' }} />))
    fireEvent.focus(field())
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  const REFUSED_TOAST = {
    tone: 'error',
    title: 'Could not save the invoice number. Try again.',
    description: 'You do not have permission to do that.',
  }

  it('keeps what was typed, and says why, through the apply and the rollback of a refused write', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view({ ...JOB, invoiceNum: 'INV-100' }))
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    await act(async () => { fireEvent.blur(field()) })

    rerender(view({ ...JOB, invoiceNum: 'INV-1001' }))
    expect(field().value).toBe('INV-1001')
    expect(screen.getByText('saving…')).toBeTruthy()

    // The rules refuse it: the cache goes back, and then the write rejects.
    rerender(view({ ...JOB, invoiceNum: 'INV-100' }))
    await act(async () => { write.reject(refused()) })

    expect(toastCalls()).toEqual([REFUSED_TOAST])
    expect(field().value).toBe('INV-1001')
    expect(screen.queryByText('saving…')).toBeNull()
  })

  it('keeps what was typed when the refusal arrives before the rollback', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view({ ...JOB, invoiceNum: 'INV-100' }))
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, invoiceNum: 'INV-1001' }))

    await act(async () => { write.reject(refused()) })
    rerender(view({ ...JOB, invoiceNum: 'INV-100' }))

    expect(toastCalls()).toEqual([REFUSED_TOAST])
    expect(field().value).toBe('INV-1001')
    expect(screen.queryByText('saving…')).toBeNull()
  })

  it('writes what was kept again when the box is left again, and then shows what is stored', async () => {
    mocks.updateJob.mockRejectedValueOnce(refused()).mockResolvedValueOnce()
    const { rerender } = render(view({ ...JOB, invoiceNum: 'INV-100' }))
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, invoiceNum: 'INV-1001' }))
    rerender(view({ ...JOB, invoiceNum: 'INV-100' }))
    expect(field().value).toBe('INV-1001')

    fireEvent.focus(field())
    await act(async () => { fireEvent.blur(field()) })

    expect(mocks.updateJob).toHaveBeenCalledTimes(2)
    expect(mocks.updateJob).toHaveBeenLastCalledWith('job3', { invoiceNum: 'INV-1001' })
    expect(toastCalls().map((call) => call.tone)).toEqual(['error', 'success'])
    rerender(view({ ...JOB, invoiceNum: 'INV-1001' }))
    expect(field().value).toBe('INV-1001')
  })

  it('writes nothing more when the box is left again while the write is out, and still keeps the text if it is refused', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view({ ...JOB, invoiceNum: 'INV-100' }))
    fireEvent.change(field(), { target: { value: 'INV-1001' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, invoiceNum: 'INV-1001' }))

    fireEvent.focus(field())
    await act(async () => { fireEvent.blur(field()) })
    expect(mocks.updateJob).toHaveBeenCalledTimes(1)

    rerender(view({ ...JOB, invoiceNum: 'INV-100' }))
    await act(async () => { write.reject(refused()) })
    expect(field().value).toBe('INV-1001')
  })

  // Another person, or another screen, saved a number while this box was showing the old
  // one. The box follows what is stored, and leaving it without typing writes nothing, where
  // it used to write the old number back over the new one.
  it('follows the stored number when it changes elsewhere, and does not write the old one back', () => {
    const { rerender } = render(withToast(<InvoiceNumberInput job={{ ...JOB, invoiceNum: 'INV-100' }} />))
    rerender(withToast(<InvoiceNumberInput job={{ ...JOB, invoiceNum: 'INV-200' }} />))
    expect(field().value).toBe('INV-200')

    fireEvent.focus(field())
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('does not take away what is being typed when the stored number changes elsewhere', async () => {
    const { rerender } = render(view({ ...JOB, invoiceNum: 'INV-100' }))
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'INV-1001' } })

    rerender(view({ ...JOB, invoiceNum: 'INV-200' }))
    expect(field().value).toBe('INV-1001')

    await act(async () => { fireEvent.blur(field()) })
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { invoiceNum: 'INV-1001' })
  })

  it('writes nothing for a job with no document', () => {
    render(withToast(<InvoiceNumberInput job={{ id: 'QBS-009' }} />))
    fireEvent.change(field(), { target: { value: 'INV-1' } })
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })
})
