import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The Materials screen requests a material, edits one, and changes its status. Each of
// those tells the person how it ended, and a form closes only when its write went
// through. Importing App.jsx pulls in the whole app, so everything that would reach
// Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], materials: [], scope: { role: 'owner' } },
  addMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  addHistory: vi.fn(),
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
  addMaterial: mocks.addMaterial,
  updateMaterial: mocks.updateMaterial,
  addHistory: mocks.addHistory,
  useHistory: () => ({ history: [] }),
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import { Materials } from '../App'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const PANEL = {
  _docId: 'm1', name: 'Main panel', item: 'Main panel', qty: 1, unit: 'ea', jobId: 'QBS-003', job: 'QBS-003',
  jobName: 'Dana Lee', status: 'Ordered', vendor: 'Graybar', dateOrdered: '2026-10-10', dateNeeded: '2026-12-25',
  notes: '', cost: 0, createdAt: { seconds: 1760000000 },
}

beforeEach(() => {
  for (const mock of [mocks.addMaterial, mocks.updateMaterial, mocks.addHistory, mocks.toast]) mock.mockReset()
  mocks.data = { jobs: [{ id: 'QBS-003', _docId: 'job3', client: 'Dana Lee' }], materials: [PANEL], scope: { role: 'owner' } }
})

afterEach(cleanup)

const open = () => render(<ToastContext.Provider value={mocks.toast}><Materials /></ToastContext.Provider>)
const nameField = () => screen.getByPlaceholderText(/^e\.g\. 200A Main Panel/)
const submit = () => screen.getByRole('button', { name: /^(Submit request|Save changes|Saving…)$/ })
const requestOne = () => {
  fireEvent.click(screen.getAllByRole('button', { name: /Request material/ })[0])
  fireEvent.change(nameField(), { target: { value: '200A panel' } })
}

describe('requesting a material', () => {
  it('writes the material, says it was requested, and closes and clears the form', async () => {
    open()
    requestOne()
    fireEvent.click(submit())

    await waitFor(() => expect(mocks.addMaterial).toHaveBeenCalledTimes(1))
    expect(mocks.addMaterial.mock.calls[0][0]).toMatchObject({ name: '200A panel', item: '200A panel', status: 'Ordered', cost: 0 })
    await waitFor(() => expect(screen.queryByPlaceholderText(/^e\.g\. 200A Main Panel/)).toBeNull())
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Material requested.' })

    fireEvent.click(screen.getAllByRole('button', { name: /Request material/ })[0])
    expect(nameField().value).toBe('')
  })

  it('reads Saving and takes no second press while the write is out', async () => {
    const pending = deferred()
    mocks.addMaterial.mockReturnValue(pending.promise)
    open()
    requestOne()
    fireEvent.click(submit())

    expect(submit().textContent).toBe('Saving…')
    expect(submit().disabled).toBe(true)
    fireEvent.click(submit())
    expect(mocks.addMaterial).toHaveBeenCalledTimes(1)

    await act(async () => { pending.resolve() })
    await waitFor(() => expect(screen.queryByPlaceholderText(/^e\.g\. 200A Main Panel/)).toBeNull())
  })

  it('keeps the form open with what was typed, and says why, when the write is refused', async () => {
    mocks.addMaterial.mockRejectedValue(refused())
    open()
    requestOne()
    fireEvent.click(submit())

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not save the material. Try again.',
      description: 'You do not have permission to do that.',
    })
    expect(nameField().value).toBe('200A panel')
    expect(submit().textContent).toBe('Submit request')
    expect(submit().disabled).toBe(false)
  })

  it('can be sent again after a refusal', async () => {
    mocks.addMaterial.mockRejectedValueOnce(refused()).mockResolvedValueOnce(undefined)
    open()
    requestOne()
    fireEvent.click(submit())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))

    fireEvent.click(submit())

    await waitFor(() => expect(mocks.addMaterial).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByPlaceholderText(/^e\.g\. 200A Main Panel/)).toBeNull())
    expect(mocks.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Material requested.' })
  })
})

describe('editing a material', () => {
  const edit = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit material' }))
    fireEvent.change(nameField(), { target: { value: 'Main panel, 225A' } })
  }

  it('updates the material, writes the history entry, says it was updated, and closes the form', async () => {
    open()
    edit()
    fireEvent.click(submit())

    await waitFor(() => expect(mocks.updateMaterial).toHaveBeenCalledTimes(1))
    expect(mocks.updateMaterial.mock.calls[0][0]).toBe('m1')
    expect(mocks.updateMaterial.mock.calls[0][1]).toMatchObject({ name: 'Main panel, 225A' })
    await waitFor(() => expect(mocks.addHistory).toHaveBeenCalledTimes(1))
    expect(mocks.addHistory).toHaveBeenCalledWith({ materialDocId: 'm1', materialName: 'Main panel, 225A', jobId: 'QBS-003', type: 'edited' })
    expect(mocks.addMaterial).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByPlaceholderText(/^e\.g\. 200A Main Panel/)).toBeNull())
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Material updated.' })
  })

  // The update and the history entry are two writes. The material is saved when the first is
  // in, so the form closes then, and a refusal of the second says so in its own words and is not
  // taken for a material that was not saved, which would have the person save it twice.
  it('closes the form once the update is in, while the history entry is still being written', async () => {
    const history = deferred()
    mocks.addHistory.mockReturnValue(history.promise)
    open()
    edit()
    fireEvent.click(submit())

    await waitFor(() => expect(screen.queryByPlaceholderText(/^e\.g\. 200A Main Panel/)).toBeNull())
    expect(mocks.addHistory).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Material updated.' })
    await act(async () => { history.resolve() })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('says the material was saved, and that its history entry was not, when only that fails', async () => {
    mocks.addHistory.mockRejectedValue(refused())
    open()
    edit()
    fireEvent.click(submit())

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2))
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'success', title: 'Material updated.' })
    expect(mocks.toast.mock.calls[1][0]).toEqual({
      tone: 'error',
      title: 'The material was saved, but its history entry was not.',
      description: 'You do not have permission to do that.',
    })
    expect(screen.queryByPlaceholderText(/^e\.g\. 200A Main Panel/)).toBeNull()
  })

  it('writes the history entry after the update, and not before it is in', async () => {
    const update = deferred()
    mocks.updateMaterial.mockReturnValue(update.promise)
    open()
    edit()
    fireEvent.click(submit())
    await waitFor(() => expect(mocks.updateMaterial).toHaveBeenCalledTimes(1))
    expect(mocks.addHistory).not.toHaveBeenCalled()

    await act(async () => { update.resolve() })

    await waitFor(() => expect(mocks.addHistory).toHaveBeenCalledTimes(1))
  })

  it('writes no history entry, and keeps the form open, when the update is refused', async () => {
    mocks.updateMaterial.mockRejectedValue(refused())
    open()
    edit()
    fireEvent.click(submit())

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0]).toMatchObject({ tone: 'error', title: 'Could not save the material. Try again.' })
    expect(mocks.addHistory).not.toHaveBeenCalled()
    expect(nameField().value).toBe('Main panel, 225A')
  })
})

describe('changing the status of a material', () => {
  // The list on the row of the material, found by the status it shows.
  const trigger = (words) => screen.getAllByRole('combobox').find((el) => el.textContent.includes(words))
  async function choose(words, option) {
    fireEvent.click(trigger(words))
    const item = await screen.findByRole('option', { name: option })
    fireEvent.pointerMove(item)
    fireEvent.mouseMove(item)
    await act(async () => { fireEvent.click(item) })
  }

  it('writes the status and the history entry, and says what the status is now', async () => {
    open()
    await choose('Ordered', 'In transit')

    await waitFor(() => expect(mocks.updateMaterial).toHaveBeenCalledWith('m1', { status: 'In Transit' }))
    await waitFor(() => expect(mocks.addHistory).toHaveBeenCalledTimes(1))
    expect(mocks.addHistory).toHaveBeenCalledWith({
      materialDocId: 'm1', materialName: 'Main panel', jobId: 'QBS-003', fromStatus: 'Ordered', toStatus: 'In Transit', type: 'status_change',
    })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Main panel set to in transit.' })
  })

  it('writes no history entry, and says it could not update the material, when the status is refused', async () => {
    mocks.updateMaterial.mockRejectedValue(refused())
    open()
    await choose('Ordered', 'Delivered')

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not update the material. Try again.',
      description: 'You do not have permission to do that.',
    })
    expect(mocks.addHistory).not.toHaveBeenCalled()
  })

  it('says the status changed, and that its history entry was not saved, when only that fails', async () => {
    mocks.addHistory.mockRejectedValue(refused())
    open()
    await choose('Ordered', 'Delivered')

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2))
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'success', title: 'Main panel set to delivered.' })
    expect(mocks.toast.mock.calls[1][0]).toEqual({
      tone: 'error',
      title: 'The status changed, but its history entry was not saved.',
      description: 'You do not have permission to do that.',
    })
  })
})
