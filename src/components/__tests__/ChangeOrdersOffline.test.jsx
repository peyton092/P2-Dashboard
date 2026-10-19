import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { OFFLINE_WAIT_MS } from '@/hooks/useMutation'

// A new change order is saved in two steps inside one run: the draft is added, and the id the
// add gives back is kept, so that the send, or a second try, works on that draft. Offline,
// Firestore's add does not answer until the connection is back. A run that gave up waiting
// and said "saved on this device" would go on without the id: Send to Builder would ask the
// function to send a change order with no id, a second try would add a second draft, and the
// late answer would make the next change order the person starts an edit of the first. So
// this run waits, however long it takes, and so does the call that sends the draft, which no
// connection queues. The device is offline and the clock moves only when a test moves it.
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
// The chip in every page header asks this hook for the connection. What it says is not what
// this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'offline' }))

import ChangeOrders from '../ChangeOrders'

const JOB = { id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', pm: 'Blake Neblett' }

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let adding
let onLine

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  for (const mock of [mocks.addDoc, mocks.updateDoc, mocks.sendExtraToBuilder, mocks.toast]) mock.mockReset()
  adding = deferred()
  mocks.addDoc.mockReturnValue(adding.promise)
  mocks.updateDoc.mockResolvedValue(undefined)
  mocks.sendExtraToBuilder.mockResolvedValue({ ok: true })
  mocks.data = { jobs: [JOB], extras: [], loading: false }
})

afterEach(() => {
  cleanup()
  onLine.mockRestore()
  vi.useRealTimers()
})

const send = () => screen.getByRole('button', { name: /Send to Builder|Sending/ })
const saveDraft = () => screen.getByRole('button', { name: /Save Draft/ })
const formIsOpen = () => screen.queryByPlaceholderText('Describe the work…') !== null
const wait = (ms) => act(async () => { vi.advanceTimersByTime(ms) })

// A brand new change order: pick the job, describe one line.
async function startNew() {
  render(<ToastContext.Provider value={mocks.toast}><ChangeOrders /></ToastContext.Provider>)
  fireEvent.click(screen.getAllByRole('button', { name: /New CO/ })[0])
  fireEvent.click(screen.getAllByRole('combobox')[0])
  fireEvent.click(screen.getByRole('option', { name: /QBS-003/ }))
  fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Backflow preventer' } })
}

describe('Save Draft with the add still out', () => {
  it('stays on Saving past the wait, says nothing, and keeps the form open', async () => {
    await startNew()
    fireEvent.click(saveDraft())

    await wait(OFFLINE_WAIT_MS * 4)

    expect(mocks.addDoc).toHaveBeenCalledTimes(1)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(formIsOpen()).toBe(true)
    expect(send().textContent).toContain('Sending…')
    expect(saveDraft().disabled).toBe(true)
    expect(send().disabled).toBe(true)
  })

  it('adds one draft, however often the buttons are pressed meanwhile', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await wait(OFFLINE_WAIT_MS * 2)

    fireEvent.click(saveDraft())
    fireEvent.click(send())
    await wait(OFFLINE_WAIT_MS * 2)

    expect(mocks.addDoc).toHaveBeenCalledTimes(1)
    expect(mocks.updateDoc).not.toHaveBeenCalled()
  })

  it('goes on as it always did when the add answers: saves, says so, and closes the form', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await wait(OFFLINE_WAIT_MS * 4)

    await act(async () => { adding.resolve({ id: 'new1' }) })

    expect(mocks.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Change order saved.' }]])
    expect(formIsOpen()).toBe(false)
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
  })

  // The late answer sets the draft that was added as the one being edited. If the form had
  // closed on "saved on this device", the person could be on another change order by then,
  // and saving that one would overwrite the first.
  it('keeps the person on this form, so that no other change order is started while the add is out', async () => {
    await startNew()
    fireEvent.click(saveDraft())
    await wait(OFFLINE_WAIT_MS * 4)
    expect(screen.queryByRole('button', { name: /New CO/ })).toBeNull()

    await act(async () => { adding.resolve({ id: 'new1' }) })

    expect(screen.getAllByRole('button', { name: /New CO/ }).length).toBeGreaterThan(0)
    mocks.addDoc.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getAllByRole('button', { name: /New CO/ })[0])
    fireEvent.click(screen.getAllByRole('combobox')[0])
    fireEvent.click(screen.getByRole('option', { name: /QBS-003/ }))
    fireEvent.change(screen.getByPlaceholderText('Describe the work…'), { target: { value: 'Test cock' } })
    fireEvent.click(saveDraft())
    await wait(OFFLINE_WAIT_MS)

    expect(mocks.addDoc).toHaveBeenCalledTimes(2)
    expect(mocks.updateDoc).not.toHaveBeenCalled()
  })
})

describe('Send to Builder with the add still out', () => {
  it('asks the function to send nothing while the add is out, and then sends the draft by the id the add gave', async () => {
    await startNew()
    fireEvent.click(send())

    await wait(OFFLINE_WAIT_MS * 4)

    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(formIsOpen()).toBe(true)

    await act(async () => { adding.resolve({ id: 'new1' }) })

    expect(mocks.sendExtraToBuilder).toHaveBeenCalledTimes(1)
    expect(mocks.sendExtraToBuilder).toHaveBeenCalledWith('new1')
    expect(mocks.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Change order sent to the builder.' }]])
    expect(formIsOpen()).toBe(false)
  })

  it('never says "Saved, but not sent" for a draft whose id it does not have', async () => {
    mocks.sendExtraToBuilder.mockImplementation(async (id) => {
      if (id === undefined) throw Object.assign(new Error('The extra id is required.'), { code: 'functions/invalid-argument' })
      return { ok: true }
    })
    await startNew()
    fireEvent.click(send())

    await wait(OFFLINE_WAIT_MS * 4)

    expect(mocks.toast.mock.calls.map(([opts]) => opts.title)).not.toContain('Saved, but not sent. Try Send to Builder again.')
    expect(mocks.sendExtraToBuilder).not.toHaveBeenCalled()
  })
})

describe('Send to Builder with the call to the function still out', () => {
  it('stays on Sending past the wait and does not say the change order is saved on this device', async () => {
    const sending = deferred()
    mocks.addDoc.mockResolvedValue({ id: 'new1' })
    mocks.sendExtraToBuilder.mockReturnValue(sending.promise)
    await startNew()
    fireEvent.click(send())
    await act(async () => {})
    expect(mocks.sendExtraToBuilder).toHaveBeenCalledWith('new1')

    await wait(OFFLINE_WAIT_MS * 4)

    expect(mocks.toast).not.toHaveBeenCalled()
    expect(formIsOpen()).toBe(true)
    expect(send().textContent).toContain('Sending…')

    await act(async () => { sending.resolve({ ok: true }) })

    expect(mocks.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Change order sent to the builder.' }]])
    expect(formIsOpen()).toBe(false)
  })
})
