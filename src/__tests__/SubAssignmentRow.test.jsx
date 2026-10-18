import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// A sub assignment row holds the status of one trade's sub on a job, and the loose ends
// that sub still owes. The status is saved when it is picked. The loose ends are saved
// when the person leaves the box, and not on every key, so a write is one sentence that
// was finished and not a stream of half words. Importing App.jsx pulls in the whole app,
// so everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
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
vi.mock('../hooks/useFirestore', async (importOriginal) => ({
  ...(await importOriginal()),
  updateJob: mocks.updateJob,
}))

import { SubAssignmentRow } from '../App'

const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

const JOB = {
  id: 'QBS-003', _docId: 'job3', client: 'Dana Lee', status: 'active', trade: 'electrical',
  subsStatus: { electrical: 'active' }, subsLooseEnds: { electrical: 'Cover plates' },
}

beforeEach(() => {
  mocks.updateJob.mockReset()
  mocks.toast.mockReset()
})

afterEach(cleanup)

const open = (job = JOB) => render(
  <ToastContext.Provider value={mocks.toast}><ul><SubAssignmentRow job={job} /></ul></ToastContext.Provider>,
)
const box = () => screen.getByPlaceholderText(/^Loose ends/)

describe('the status of the sub', () => {
  async function choose(option) {
    fireEvent.click(screen.getByRole('combobox'))
    const item = await screen.findByRole('option', { name: option })
    fireEvent.pointerMove(item)
    fireEvent.mouseMove(item)
    await act(async () => { fireEvent.click(item) })
  }

  it('saves the status under the trade, and says what it was set to', async () => {
    open()
    await choose('Issue')

    await waitFor(() => expect(mocks.updateJob).toHaveBeenCalledWith('job3', { 'subsStatus.electrical': 'issue' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Sub status set to issue.' })
  })

  it('says it could not change the sub status, with the reason, when the write is refused', async () => {
    mocks.updateJob.mockRejectedValue(refused())
    open()
    await choose('Done')

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not change the sub status. Try again.',
      description: 'You do not have permission to do that.',
    })
  })
})

describe('the loose ends', () => {
  it('shows what is saved, and writes nothing while the person types', () => {
    open()
    expect(box().value).toBe('Cover plates')
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    fireEvent.change(box(), { target: { value: 'Cover plates, labels and a final walk' } })
    expect(box().value).toBe('Cover plates, labels and a final walk')
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('saves under the trade when the person leaves the box, and says so', async () => {
    open()
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    fireEvent.blur(box())

    expect(mocks.updateJob).toHaveBeenCalledTimes(1)
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { 'subsLooseEnds.electrical': 'Cover plates, labels' })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Loose ends saved.' })
  })

  it('writes nothing when the person leaves the box without a change', () => {
    open()
    fireEvent.focus(box())
    fireEvent.blur(box())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('keeps what was typed, and says why, when the write is refused', async () => {
    mocks.updateJob.mockRejectedValue(refused())
    open()
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    fireEvent.blur(box())

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not save the loose ends. Try again.',
      description: 'You do not have permission to do that.',
    })
    expect(box().value).toBe('Cover plates, labels')
  })

  it('shows the loose ends that are saved when they change elsewhere, and does not write them back', () => {
    const { rerender } = open()
    rerender(
      <ToastContext.Provider value={mocks.toast}>
        <ul><SubAssignmentRow job={{ ...JOB, subsLooseEnds: { electrical: 'Cover plates, labels' } }} /></ul>
      </ToastContext.Provider>,
    )
    expect(box().value).toBe('Cover plates, labels')

    fireEvent.blur(box())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('writes nothing for a job with no document', () => {
    open({ ...JOB, _docId: undefined })
    fireEvent.change(box(), { target: { value: 'Something else' } })
    fireEvent.blur(box())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })
})
