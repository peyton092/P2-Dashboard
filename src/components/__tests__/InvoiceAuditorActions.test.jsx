import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The invoice auditor saves a new supplier invoice and changes the status of one. Each of
// those tells the person how it ended, and the form closes only when its write went
// through. The checks the form makes before it writes stay on the form. Everything that
// would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], materials: [], scope: { role: 'owner' } },
  invoices: [],
  addSupplierInvoice: vi.fn(),
  updateSupplierInvoice: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({
  useSupplierInvoices: () => ({ invoices: mocks.invoices, loading: false }),
  addSupplierInvoice: mocks.addSupplierInvoice,
  updateSupplierInvoice: mocks.updateSupplierInvoice,
}))

import InvoiceAuditor from '../InvoiceAuditor'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

const INVOICE = {
  _docId: 'i1', vendor: 'Graybar', invoiceNum: 'INV-100', invoiceDate: '2026-10-01', jobId: 'QBS-003', total: 4000,
  status: 'pending-review', lineItems: [{ desc: 'Panel', qty: 1, unit: 'EA', unitPrice: 4000, extPrice: 4000 }], flags: [],
}

beforeEach(() => {
  for (const mock of [mocks.addSupplierInvoice, mocks.updateSupplierInvoice, mocks.toast]) mock.mockReset()
  mocks.data = { jobs: [{ id: 'QBS-003', name: 'Lee Residence' }], materials: [], scope: { role: 'owner' } }
  mocks.invoices = [INVOICE]
})

afterEach(cleanup)

const open = () => render(<ToastContext.Provider value={mocks.toast}><InvoiceAuditor /></ToastContext.Provider>)
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)
const press = (el) => act(async () => { fireEvent.click(el) })

// A real pointer moves over an option before it clicks, and the option ignores a click until then.
async function choose(trigger, optionName) {
  await act(async () => { fireEvent.mouseDown(trigger) })
  const option = await screen.findByRole('option', { name: optionName })
  await act(async () => { fireEvent.mouseMove(option) })
  await act(async () => { fireEvent.click(option) })
}

describe('saving a new invoice', () => {
  const start = async ({ vendor = 'Graybar', number = 'INV-200', line = 'Conduit' } = {}) => {
    open()
    fireEvent.click(screen.getAllByRole('button', { name: /New Invoice/ })[0])
    if (vendor) await choose(screen.getAllByRole('combobox').find((el) => /Select vendor/.test(el.textContent)), vendor)
    if (number) fireEvent.change(screen.getByPlaceholderText('INV-12345'), { target: { value: number } })
    if (line) fireEvent.change(screen.getByPlaceholderText('Item description…'), { target: { value: line } })
  }
  const save = () => screen.getByRole('button', { name: /^(Save Invoice|Saving…)$/ })

  it('writes the invoice, says it was saved, and returns to the list', async () => {
    await start()
    await press(save())

    expect(mocks.addSupplierInvoice).toHaveBeenCalledTimes(1)
    expect(mocks.addSupplierInvoice.mock.calls[0][0]).toMatchObject({ vendor: 'Graybar', invoiceNum: 'INV-200' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Invoice saved.' }])
    expect(screen.queryByPlaceholderText('INV-12345')).toBeNull()
  })

  it('reads Saving and takes no second press while the write is out', async () => {
    const write = deferred()
    mocks.addSupplierInvoice.mockReturnValue(write.promise)
    await start()
    await press(save())

    expect(save().textContent).toBe('Saving…')
    expect(save().disabled).toBe(true)
    expect(mocks.addSupplierInvoice).toHaveBeenCalledTimes(1)
    await act(async () => { write.resolve() })
  })

  it('keeps the form with what was typed, and says why, when the write is refused', async () => {
    mocks.addSupplierInvoice.mockRejectedValue(refused())
    await start()
    await press(save())

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not save the invoice. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(screen.getByPlaceholderText('INV-12345').value).toBe('INV-200')
    expect(save().disabled).toBe(false)
  })

  it('says what is missing on the form, and writes nothing, when the vendor or the number is left out', async () => {
    await start({ vendor: null })
    await press(save())

    expect(screen.getByText('Vendor, invoice #, and date are required.')).toBeTruthy()
    expect(mocks.addSupplierInvoice).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('says what is missing on the form, and writes nothing, when no line has a description', async () => {
    await start({ line: null })
    await press(save())

    expect(screen.getByText('Add at least one line item.')).toBeTruthy()
    expect(mocks.addSupplierInvoice).not.toHaveBeenCalled()
  })
})

describe('the status of an invoice', () => {
  const trigger = () => {
    open()
    fireEvent.click(screen.getByText('Graybar'))
    // The status list of the expanded invoice is the only one 36 units wide.
    return screen.getAllByRole('combobox').find((el) => el.className.includes('w-36'))
  }

  it('writes the status and says what it was set to', async () => {
    await choose(trigger(), 'Approved')

    expect(mocks.updateSupplierInvoice).toHaveBeenCalledWith('i1', { status: 'approved' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Status set to approved.' }])
  })

  it('says it could not change the status, with the reason, when the write is refused', async () => {
    mocks.updateSupplierInvoice.mockRejectedValue(refused())
    await choose(trigger(), 'Disputed')

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not change the status. Try again.',
      description: 'You do not have permission to do that.',
    }])
  })
})
