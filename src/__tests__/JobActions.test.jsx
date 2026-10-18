import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// Creating a job and recording an inspection result go through Cloud Functions
// that check the caller is staff. This covers what the screens do around those
// calls: what they send, what they show when a call fails, and that a failed
// create leaves the form open. Importing App.jsx pulls in the whole app, so
// everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], subs: [] },
  createJob: vi.fn(),
  passInspection: vi.fn(),
  failInspection: vi.fn(),
  updateJob: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../firebase', () => ({
  auth: { currentUser: null },
  functions: {},
  db: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../hooks/useFirestore', async (importOriginal) => ({
  ...(await importOriginal()),
  createJob: mocks.createJob,
  passInspection: mocks.passInspection,
  failInspection: mocks.failInspection,
  updateJob: mocks.updateJob,
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import { JobStatus, PhaseRow } from '../App'

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

// Resolves or rejects when the test says so, to look at the screen in between.
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const mock of [mocks.createJob, mocks.passInspection, mocks.failInspection, mocks.updateJob, mocks.toast]) {
    mock.mockReset()
  }
  mocks.createJob.mockResolvedValue({ ok: true, docId: 'job9' })
  mocks.passInspection.mockResolvedValue({ ok: true })
  mocks.failInspection.mockResolvedValue({ ok: true })
  mocks.data = { jobs: [], subs: [] }
})

const originalZone = process.env.TZ

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const withToast = (ui) => <ToastContext.Provider value={mocks.toast}>{ui}</ToastContext.Provider>

describe('New job form', () => {
  const open = () => {
    render(withToast(<JobStatus />))
    fireEvent.click(screen.getByRole('button', { name: /New job/ }))
  }
  const type = (placeholder, value) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
  const fill = () => {
    type('QBS-045', 'QBS-045')
    type('123 Main St', '123 Main St')
    type('Client name', 'Dana Lee')
  }
  const create = () => screen.getByRole('button', { name: /^Create job$|^Creating/ })

  it('cannot be sent until the id, address and client are filled in', () => {
    open()
    expect(create().disabled).toBe(true)
    type('QBS-045', 'QBS-045')
    type('123 Main St', '123 Main St')
    expect(create().disabled).toBe(true)
    type('Client name', 'Dana Lee')
    expect(create().disabled).toBe(false)
  })

  it('calls createJob once with the job the form describes, tenant included', async () => {
    open()
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(mocks.createJob).toHaveBeenCalledTimes(1))
    const job = mocks.createJob.mock.calls[0][0]
    expect(job).toMatchObject({
      id: 'QBS-045',
      address: '123 Main St',
      client: 'Dana Lee',
      tenantId: 'qbs',
      status: 'active',
      billingStatus: 'not-invoiced',
      permits: { electrical: 'pending', plumbing: 'pending', hvac: 'pending' },
    })
    expect(job.insp.electrical).toEqual({ roughIn: 'pending', trim: 'blocked', final: 'blocked' })
    expect(job.insp.plumbing).toEqual({ roughIn: 'pending', final: 'blocked' })
    expect(job.subs).toEqual({ electrical: null, plumbing: null, hvac: null })
  })

  it('starts the job on the local day, in the evening when UTC is already tomorrow', async () => {
    // Half past nine at night on the 18th in Nashville is half past two in the morning
    // on the 19th in UTC. Only the clock is faked, so the screen can still wait for its call.
    process.env.TZ = 'America/Chicago'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 18, 21, 30))
    open()
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(mocks.createJob).toHaveBeenCalledTimes(1))

    expect(mocks.createJob.mock.calls[0][0].start).toBe('2026-10-18')
  })

  it('shows Creating while the call is out, and one call only', async () => {
    const pending = deferred()
    mocks.createJob.mockReturnValue(pending.promise)
    open()
    fill()
    fireEvent.click(create())
    expect(create().textContent).toBe('Creating…')
    expect(create().disabled).toBe(true)
    fireEvent.click(create())
    expect(mocks.createJob).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true })
    await waitFor(() => expect(screen.queryByPlaceholderText('QBS-045')).toBeNull())
  })

  it('closes the form and clears it once the job is created', async () => {
    open()
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(screen.queryByPlaceholderText('QBS-045')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /New job/ }))
    expect(screen.getByPlaceholderText('QBS-045').value).toBe('')
  })

  it('says the job was created, by its id', async () => {
    open()
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Job QBS-045 created.' })
  })

  it('keeps the form open with what was typed, and shows the message, when the function refuses', async () => {
    mocks.createJob.mockRejectedValue(sdkError('already-exists', 'A job with that ID already exists.'))
    open()
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not create the job. Try again.',
      description: 'A job with that ID already exists.',
    })
    expect(screen.getByPlaceholderText('QBS-045').value).toBe('QBS-045')
    expect(screen.getByPlaceholderText('123 Main St').value).toBe('123 Main St')
    expect(screen.getByPlaceholderText('Client name').value).toBe('Dana Lee')
    expect(create().textContent).toBe('Create job')
    expect(create().disabled).toBe(false)
  })

  it('shows a plain message when no reply came back, not the bare code', async () => {
    mocks.createJob.mockRejectedValue(sdkError('internal', 'internal'))
    open()
    fill()
    fireEvent.click(create())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'error', title: 'Could not create the job. Try again.' })
  })

  // The tenant decides who outside P2 sees the job, so it is chosen on the form, and
  // starts as the workspace chosen in the sidebar when that is a builder tenant.
  describe('the tenant', () => {
    const tenant = () => screen.getByRole('combobox', { name: 'Tenant' })
    // A real pointer moves over an option before it clicks, and the option ignores a click until then.
    async function choose(name) {
      await act(async () => { fireEvent.mouseDown(tenant()) })
      const option = await screen.findByRole('option', { name })
      await act(async () => { fireEvent.mouseMove(option) })
      await act(async () => { fireEvent.click(option) })
    }
    const sent = async () => {
      fireEvent.click(create())
      await waitFor(() => expect(mocks.createJob).toHaveBeenCalledTimes(1))
      return mocks.createJob.mock.calls[0][0].tenantId
    }

    it('offers the three tenants by name, with no dash in any of them', async () => {
      open()
      await act(async () => { fireEvent.mouseDown(tenant()) })
      const list = await screen.findByRole('listbox')
      const names = within(list).getAllByRole('option').map(option => option.textContent)
      expect(names).toEqual(['P2 internal', 'QBS', 'Vision'])
      for (const name of [...names, 'Tenant']) expect(name).not.toMatch(/[-\u2010-\u2015\u2212]/)
    })

    it('sends the tenant the person chose', async () => {
      open()
      fill()
      await choose('Vision')
      expect(tenant().textContent).toContain('Vision')
      expect(await sent()).toBe('vision')
    })

    it('sends p2-core when P2 internal is chosen', async () => {
      open()
      fill()
      await choose('P2 internal')
      expect(await sent()).toBe('p2-core')
    })

    it.each([
      ['vision', 'Vision', 'vision'],
      ['qbs', 'QBS', 'qbs'],
      ['p2-core', 'QBS', 'qbs'],
      [null, 'QBS', 'qbs'],
    ])('starts as the workspace when that is a builder tenant, and as QBS otherwise (workspace %s)', async (workspace, shown, value) => {
      mocks.data = { jobs: [], subs: [], tenantId: workspace }
      open()
      expect(tenant().textContent).toContain(shown)
      fill()
      expect(create().disabled).toBe(false)
      expect(await sent()).toBe(value)
    })

    it('starts again from the workspace each time the form is opened', async () => {
      mocks.data = { jobs: [], subs: [], tenantId: 'vision' }
      open()
      await choose('P2 internal')
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.click(screen.getByRole('button', { name: /New job/ }))
      expect(tenant().textContent).toContain('Vision')
    })
  })

  it('lets the person fix the id and send again after a refusal', async () => {
    mocks.createJob.mockRejectedValueOnce(sdkError('invalid-argument', 'Job ID must look like QBS-001.'))
    open()
    fill()
    type('QBS-045', 'qbs-45')
    fireEvent.click(create())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    type('QBS-045', 'QBS-045')
    fireEvent.click(create())
    await waitFor(() => expect(mocks.createJob).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByPlaceholderText('QBS-045')).toBeNull())
  })
})

describe('inspection result buttons', () => {
  const row = (props = {}) => render(withToast(
    <PhaseRow label="Rough-In" status="pending" docId="job1" field="insp.electrical.roughIn" {...props} />,
  ))
  const pass = () => screen.getByRole('button', { name: 'Mark Rough-In passed' })
  const fail = () => screen.getByRole('button', { name: 'Mark Rough-In failed' })

  it('pass calls passInspection with the job document id, the trade and the phase', async () => {
    row()
    fireEvent.click(pass())
    await waitFor(() => expect(mocks.passInspection).toHaveBeenCalledTimes(1))
    expect(mocks.passInspection).toHaveBeenCalledWith('job1', 'electrical', 'roughIn')
    expect(mocks.failInspection).not.toHaveBeenCalled()
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('names the trim phase of electrical', async () => {
    row({ label: 'Trim', field: 'insp.electrical.trim' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark Trim passed' }))
    await waitFor(() => expect(mocks.passInspection).toHaveBeenCalledWith('job1', 'electrical', 'trim'))
  })

  it('says the phase was marked passed', async () => {
    row()
    fireEvent.click(pass())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Rough-In marked passed.' })
  })

  it('takes one call at a time: the buttons and the list are off while it is out', async () => {
    const pending = deferred()
    mocks.passInspection.mockReturnValue(pending.promise)
    row()
    fireEvent.click(pass())
    expect(pass().disabled).toBe(true)
    expect(fail().disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: /Update Rough-In status/ }).disabled).toBe(true)
    fireEvent.click(pass())
    fireEvent.click(fail())
    expect(mocks.passInspection).toHaveBeenCalledTimes(1)
    expect(mocks.failInspection).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    pending.resolve({ ok: true })
    await waitFor(() => expect(pass().disabled).toBe(false))
  })

  it('shows the message of a refusal in a toast and turns the buttons back on', async () => {
    mocks.passInspection.mockRejectedValue(sdkError('permission-denied', 'Staff access required.'))
    row()
    fireEvent.click(pass())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not record the inspection result. Try again.',
      description: 'Staff access required.',
    })
    expect(pass().disabled).toBe(false)
  })

  it('shows a plain message when no reply came back, and never the bare code', async () => {
    mocks.passInspection.mockRejectedValue(sdkError('internal', 'internal'))
    row()
    fireEvent.click(pass())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'error', title: 'Could not record the inspection result. Try again.' })
  })

  it('the buttons are not offered for a row with no job document', () => {
    row({ docId: undefined })
    expect(screen.queryByRole('button', { name: /Mark Rough-In/ })).toBeNull()
  })
})

// A failed inspection raises an alert for the whole team and shows on the job, so it is
// asked about first. The question is the same from the red button and from the list.
describe('marking an inspection failed', () => {
  const row = (props = {}) => render(withToast(
    <PhaseRow label="Rough-In" status="pending" docId="job1" field="insp.electrical.roughIn" {...props} />,
  ))
  const fail = () => screen.getByRole('button', { name: 'Mark Rough-In failed' })
  const list = () => screen.getByRole('combobox', { name: /Update Rough-In status/ })
  // Base UI puts focus inside a dialog on the next animation frame after it mounts. A test
  // that presses a button in it waits for that first, or the frame lands later on a slow
  // machine, on top of what the test did.
  const ask = async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Mark Rough-In failed?' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    return dialog
  }
  const confirm = (dialog) => fireEvent.click(within(dialog).getByRole('button', { name: 'Mark failed' }))
  const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  it.each([
    ['the red button', () => fireEvent.click(fail())],
    ['the list', () => fireEvent.change(list(), { target: { value: 'failed' } })],
  ])('asks first from %s, and records nothing until it is confirmed', async (_name, start) => {
    row()
    start()
    const dialog = await ask()

    expect(within(dialog).getByText('The failed result is recorded on the job and the team is alerted.')).toBeTruthy()
    expect(mocks.failInspection).not.toHaveBeenCalled()
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it.each([
    ['the red button', () => fireEvent.click(fail())],
    ['the list', () => fireEvent.change(list(), { target: { value: 'failed' } })],
  ])('calls failInspection with the job, the trade and the phase once it is confirmed from %s', async (_name, start) => {
    row()
    start()
    confirm(await ask())

    await waitFor(() => expect(mocks.failInspection).toHaveBeenCalledTimes(1))
    expect(mocks.failInspection).toHaveBeenCalledWith('job1', 'electrical', 'roughIn')
    expect(mocks.passInspection).not.toHaveBeenCalled()
    expect(mocks.updateJob).not.toHaveBeenCalled()
    await gone()
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Rough-In marked failed.' })
  })

  it('names the final phase of HVAC', async () => {
    row({ label: 'Final', field: 'insp.hvac.final' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark Final failed' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mark Final failed?' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    confirm(dialog)
    await waitFor(() => expect(mocks.failInspection).toHaveBeenCalledWith('job1', 'hvac', 'final'))
  })

  it('records nothing when it is cancelled, and the list goes back to the status the phase has', async () => {
    row()
    fireEvent.change(list(), { target: { value: 'failed' } })
    const dialog = await ask()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(mocks.failInspection).not.toHaveBeenCalled()
    expect(list().value).toBe('pending')
  })

  it('reads Working while the call is out, and closes when it is recorded', async () => {
    const pending = deferred()
    mocks.failInspection.mockReturnValue(pending.promise)
    row()
    fireEvent.click(fail())
    confirm(await ask())

    expect(await screen.findByRole('button', { name: 'Working' })).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.failInspection).toHaveBeenCalledTimes(1)

    await act(async () => { pending.resolve({ ok: true }) })
    await gone()
  })

  it('stays open under the error toast when the call is refused, so it can be tried again', async () => {
    mocks.failInspection.mockRejectedValueOnce(sdkError('permission-denied', 'Staff access required.'))
    row()
    fireEvent.click(fail())
    const dialog = await ask()
    confirm(dialog)

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not record the inspection result. Try again.',
      description: 'Staff access required.',
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Mark failed' })).toBeTruthy())

    confirm(dialog)
    await waitFor(() => expect(mocks.failInspection).toHaveBeenCalledTimes(2))
    await gone()
  })

  it('returns focus to the control that asked', async () => {
    row()
    act(() => { fail().focus() })
    fireEvent.click(fail())
    const dialog = await ask()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await gone()

    await waitFor(() => expect(document.activeElement).toBe(fail()))
  })
})

describe('inspection status list', () => {
  const list = () => screen.getByRole('combobox', { name: /Update Rough-In status/ })
  const row = () => render(withToast(
    <PhaseRow label="Rough-In" status="pending" docId="job1" field="insp.electrical.roughIn" />,
  ))

  it('records passed through passInspection, not as a plain edit of the job', async () => {
    row()
    fireEvent.change(list(), { target: { value: 'passed' } })
    await waitFor(() => expect(mocks.passInspection).toHaveBeenCalledWith('job1', 'electrical', 'roughIn'))
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('still edits the other statuses on the job directly, since they are not results', async () => {
    row()
    for (const value of ['scheduled', 'blocked', 'n/a']) {
      fireEvent.change(list(), { target: { value } })
      expect(mocks.updateJob).toHaveBeenLastCalledWith('job1', { 'insp.electrical.roughIn': value })
    }
    expect(mocks.passInspection).not.toHaveBeenCalled()
    expect(mocks.failInspection).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(3))
  })

  // A Firestore write is applied on the screen at once and acknowledged later, which can be
  // long after when the connection is poor, so the list is not held off while it waits.
  it('does not switch the list or the buttons off while a plain edit waits for the server', async () => {
    const pending = deferred()
    mocks.updateJob.mockReturnValue(pending.promise)
    row()
    fireEvent.change(list(), { target: { value: 'scheduled' } })

    expect(list().disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Mark Rough-In passed' }).disabled).toBe(false)

    await act(async () => { pending.resolve() })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
  })

  it('says what the status was set to, in words', async () => {
    row()
    fireEvent.change(list(), { target: { value: 'scheduled' } })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Rough-In set to scheduled.' })
  })

  it('shows the message when a plain edit of the status is refused', async () => {
    mocks.updateJob.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
    row()
    fireEvent.change(list(), { target: { value: 'blocked' } })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not change the inspection status. Try again.',
      description: 'You do not have permission to do that.',
    })
  })

  it('shows the message when recording a result from the list is refused', async () => {
    mocks.passInspection.mockRejectedValue(sdkError('not-found', 'That job no longer exists.'))
    row()
    fireEvent.change(list(), { target: { value: 'passed' } })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0].description).toBe('That job no longer exists.')
  })
})
