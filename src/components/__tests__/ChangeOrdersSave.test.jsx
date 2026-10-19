import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { axe } from '@/test/axe'
import { openSettled, initialFocusLanded } from '@/test/dialog'

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
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import ChangeOrders from '../ChangeOrders'

const JOB = { id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', pm: 'Blake Neblett' }
const LINE = { desc: 'Backflow preventer', qty: 1, unit: 'EA', unitPrice: 4000, extPrice: 4000 }
const saved = (over) => ({
  _docId: 'x1', coNumber: 'CO-2026-001', id: undefined, job: 'QBS-003', date: '2026-10-01', status: 'Draft',
  lineItems: [LINE], markupPct: 15, notes: '', amount: 4600, total: 4600, desc: 'CO-2026-001: Backflow preventer', ...over,
})

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

beforeEach(() => {
  for (const mock of [mocks.addDoc, mocks.updateDoc, mocks.sendExtraToBuilder, mocks.toast]) mock.mockReset()
  mocks.addDoc.mockResolvedValue({ id: 'new1' })
  mocks.updateDoc.mockResolvedValue(undefined)
  mocks.sendExtraToBuilder.mockResolvedValue({ ok: true })
  mocks.data = { jobs: [JOB], extras: [], loading: false }
})

const originalZone = process.env.TZ

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const open = () => render(<ToastContext.Provider value={mocks.toast}><ChangeOrders /></ToastContext.Provider>)
const openSaved = (over) => {
  mocks.data.extras = [saved(over)]
  open()
  fireEvent.click(screen.getAllByTitle('Edit or resend')[0])
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

  it('dates a new change order with the local day, in the evening when UTC is already tomorrow', async () => {
    // Half past nine at night on the 18th in Nashville is half past two in the morning
    // on the 19th in UTC. Only the clock is faked, so the screen can still wait for its list.
    process.env.TZ = 'America/Chicago'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 18, 21, 30))

    await startNew()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1))

    expect(mocks.addDoc.mock.calls[0][1].date).toBe('2026-10-18')
  })

  it('describes the change order with its number, a colon and the first line, and no dash', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1))
    const { desc } = mocks.addDoc.mock.calls[0][1]
    expect(desc).toMatch(/^CO-\d{4}-001: Backflow preventer$/)
    expect(desc).not.toMatch(/[\u2010-\u2015\u2212]/)
  })

  it('writes the same description when an existing change order is saved', async () => {
    openSaved()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1))
    expect(mocks.updateDoc.mock.calls[0][1].desc).toBe('CO-2026-001: Backflow preventer')
  })

  it('Save Draft does not send, and leaves the form for the list', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
    expect(mocks.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Change order saved.' }]])
  })

  it('Send to Builder saves the draft first and then sends it by the id the save returned', async () => {
    await startNew()
    fireEvent.click(send())
    await waitFor(() => expect(mocks.sendExtraToBuilder).toHaveBeenCalledTimes(1))
    expect(mocks.sendExtraToBuilder).toHaveBeenCalledWith('new1')
    expect(mocks.addDoc.mock.calls[0][1].status).toBe('Draft')
    expect(mocks.addDoc.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendExtraToBuilder.mock.invocationCallOrder[0])
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
    // One toast for the whole of it: the draft was saved on the way, and nothing is said
    // about that until it is known whether the send worked.
    expect(mocks.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Change order sent to the builder.' }]])
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
    for (const status of ['Draft', 'Sent to Builder', 'Rejected']) {
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

// The list of change orders, drawn as a table and as cards, with one that can be edited and
// one that is approved.
describe('the list of change orders', () => {
  it('has no accessibility violations', async () => {
    mocks.data.extras = [saved(), saved({ _docId: 'x2', coNumber: 'CO-2026-002', status: 'Approved' })]
    const { container } = open()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('names each action of a row after the change order it acts on', () => {
    mocks.data.extras = [saved()]
    open()
    expect(screen.getAllByRole('button', { name: 'Download PDF of CO-2026-001' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Edit CO-2026-001' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('combobox', { name: 'Filter by job' })).toBeTruthy()
  })

  it('names the actions of a change order with neither a number nor an id in words', () => {
    mocks.data.extras = [saved({ coNumber: undefined, id: undefined })]
    open()
    expect(screen.getAllByRole('button', { name: 'Download PDF of this change order' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Edit this change order' }).length).toBeGreaterThan(0)
  })
})

describe('an approved change order is read only', () => {
  const HINT = 'Approved change orders cannot be edited.'
  const REFUSAL = 'This change order is approved. Raise a new change order for any additional work.'

  it.each([['Approved'], ['approved']])('turns the edit action off for a change order with status %s, and says why', (status) => {
    mocks.data.extras = [saved({ status })]
    open()
    // The list is drawn twice, as a table and as cards; both have the action.
    const actions = screen.getAllByTitle(HINT)
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(action.disabled).toBe(true)
      fireEvent.click(action)
    }
    expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull()
    expect(screen.queryByTitle('Edit or resend')).toBeNull()
  })

  it.each([['Draft'], ['Sent to Builder'], ['Rejected'], ['pending']])('keeps the edit action on for a change order with status %s', (status) => {
    mocks.data.extras = [saved({ status })]
    open()
    expect(screen.queryByTitle(HINT)).toBeNull()
    const actions = screen.getAllByTitle('Edit or resend')
    expect(actions.length).toBeGreaterThan(0)
    expect(actions[0].disabled).toBe(false)
    fireEvent.click(actions[0])
    expect(screen.getByPlaceholderText('Describe the work…')).toBeTruthy()
  })

  it('refuses a save of a change order approved while its form was open, and writes nothing', async () => {
    openSaved({ status: 'Sent to Builder' })
    // The builder approves it now: the live data says Approved, the form still holds
    // the copy it was opened from. Typing draws the form again with the live data.
    mocks.data = { ...mocks.data, extras: [saved({ status: 'Approved' })] }
    fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Backflow preventer, larger' } })
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'error', title: REFUSAL })
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.addDoc).not.toHaveBeenCalled()
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
    // The form stays open, and the buttons are not left switched off.
    expect(screen.getByPlaceholderText('Describe the work…').value).toBe('Backflow preventer, larger')
    expect(saveDraft().disabled).toBe(false)
  })

  it('refuses to send one approved while its form was open, and writes nothing', async () => {
    openSaved({ status: 'Sent to Builder' })
    mocks.data = { ...mocks.data, extras: [saved({ status: 'approved' })] }
    fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Backflow preventer, larger' } })
    fireEvent.click(send())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'error', title: REFUSAL })
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
  })

  it('still saves a change order that is not approved after the live data changed in other ways', async () => {
    openSaved({ status: 'Sent to Builder' })
    mocks.data = { ...mocks.data, extras: [saved({ status: 'Rejected', rejectNotes: 'Use the 200A panel' })] }
    fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Backflow preventer, revised' } })
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Change order saved.' })
  })

  it('does not refuse a new change order, which is not in the live list yet', async () => {
    mocks.data.extras = [saved({ _docId: 'other', status: 'Approved' })]
    await startNew()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Change order saved.' })
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
      title: 'Could not save the change order. Try again.',
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
      title: 'Saved, but not sent. Try Send to Builder again.',
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
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'error', title: 'Saved, but not sent. Try Send to Builder again.' })
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
    expect(mocks.toast.mock.calls.map(([opts]) => opts.tone)).toEqual(['error', 'success'])
    expect(mocks.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Change order sent to the builder.' })
  })

  it('reads Sending and takes no second press while the draft is saved and sent', async () => {
    let finish
    mocks.sendExtraToBuilder.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    await startNew()
    fireEvent.click(send())

    await waitFor(() => expect(mocks.sendExtraToBuilder).toHaveBeenCalledTimes(1))
    expect(send().textContent).toContain('Sending…')
    expect(send().disabled).toBe(true)
    expect(saveDraft().disabled).toBe(true)
    fireEvent.click(send())
    expect(mocks.sendExtraToBuilder).toHaveBeenCalledTimes(1)

    await act(async () => { finish({ ok: true }) })
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
  })

  it('keeps the form and the reason when a plain save of a draft is refused, and can save again', async () => {
    mocks.updateDoc.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'))
    openSaved()
    fireEvent.click(saveDraft())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0]).toEqual({
      tone: 'error',
      title: 'Could not save the change order. Try again.',
      description: 'Missing or insufficient permissions.',
    })
    expect(screen.getByPlaceholderText('Describe the work…')).toBeTruthy()

    fireEvent.click(saveDraft())
    await waitFor(() => expect(screen.queryByPlaceholderText('Describe the work…')).toBeNull())
    expect(mocks.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Change order saved.' })
  })
})

// Taking a line off a change order is asked about, because the price on it goes with it.
// The line is a local change to the form and nothing is written until the form is saved,
// so the question closes as soon as it is answered.
describe('removing a line item', () => {
  async function twoLines() {
    await startNew()
    fireEvent.click(screen.getByRole('button', { name: /Add Line/ }))
    fireEvent.change(screen.getAllByPlaceholderText('Describe the work…')[1], { target: { value: 'Disconnect switch' } })
  }
  const ask = async (name) => {
    const dialog = await screen.findByRole('dialog', { name })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    return dialog
  }
  const lines = () => screen.getAllByPlaceholderText('Describe the work…').map((input) => input.value)
  const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  it('offers a remove button on each line once there are two, and names the line', async () => {
    await startNew()
    expect(screen.queryByRole('button', { name: /^Remove line/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Add Line/ }))
    expect(screen.getAllByRole('button', { name: /^Remove line/ }).map((el) => el.getAttribute('aria-label')))
      .toEqual(['Remove line 1', 'Remove line 2'])
  })

  it('asks first, names the line and its words, and takes nothing off until it is confirmed', async () => {
    await twoLines()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    const dialog = await ask('Remove line 2?')

    expect(within(dialog).getByText('Disconnect switch is taken off this change order. Nothing is saved until you save the change order.')).toBeTruthy()
    expect(lines()).toEqual(['Backflow preventer', 'Disconnect switch'])
  })

  it('takes the line off and closes at once when it is confirmed, and writes nothing', async () => {
    await twoLines()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    const dialog = await ask('Remove line 2?')

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove line' })) })

    expect(lines()).toEqual(['Backflow preventer'])
    await gone()
    expect(mocks.addDoc).not.toHaveBeenCalled()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Remove line/ })).toBeNull()
  })

  // Enter pressed twice on the confirm button, or two presses in the same turn: the popup is
  // still on the screen and focused while it closes. The second used to take off the line that
  // had moved up into the place of the first.
  it('takes off the one line, and not the next, when the confirm button is pressed twice in the same turn', async () => {
    await twoLines()
    fireEvent.click(screen.getByRole('button', { name: /Add Line/ }))
    fireEvent.change(screen.getAllByPlaceholderText('Describe the work…')[2], { target: { value: 'Test cock' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    const dialog = await ask('Remove line 2?')
    const confirm = within(dialog).getByRole('button', { name: 'Remove line' })

    await act(async () => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })

    expect(lines()).toEqual(['Backflow preventer', 'Test cock'])
    await gone()
  })

  // The whole form is checked, with its two lines: every box and list on it has a name, and
  // so has every column of the line table.
  it('has no accessibility violations on the whole form, or in the question', async () => {
    await twoLines()
    expect(await axe(document.body)).toHaveNoViolations()

    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    const dialog = await openSettled('Remove line 2?')
    await initialFocusLanded()
    expect(await axe(dialog)).toHaveNoViolations()
  })

  it('keeps the line when it is cancelled', async () => {
    await twoLines()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    const dialog = await ask('Remove line 2?')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(lines()).toEqual(['Backflow preventer', 'Disconnect switch'])
  })

  it('says it is a line with no words when the line has none', async () => {
    await startNew()
    fireEvent.click(screen.getByRole('button', { name: /Add Line/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    const dialog = await ask('Remove line 2?')

    expect(within(dialog).getByText('This line is taken off this change order. Nothing is saved until you save the change order.')).toBeTruthy()
  })

  it('paints the confirm button as destructive', async () => {
    await twoLines()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }))
    const dialog = await ask('Remove line 1?')
    expect(within(dialog).getByRole('button', { name: 'Remove line' }).classList.contains('text-destructive')).toBe(true)
  })
})
