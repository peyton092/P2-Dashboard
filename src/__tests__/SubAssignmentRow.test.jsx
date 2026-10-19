import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// A sub assignment row holds the status of one trade's sub on a job, and the loose ends
// that sub still owes. The status is saved when it is picked. The loose ends are saved
// when the person leaves the box, and not on every key, so a write is one sentence that
// was finished and not a stream of half words, and also when the box goes away or the page
// is hidden with something typed in it that was not saved. What is typed stays in the box
// until it is saved, through the apply of the write to Firestore's cache, which changes the
// stored loose ends at once, and through the rollback of a write the rules refuse, which
// changes them back, so it can be tried again. Importing App.jsx pulls in the whole app,
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

const view = (job) => (
  <ToastContext.Provider value={mocks.toast}><ul><SubAssignmentRow job={job} /></ul></ToastContext.Provider>
)
const open = (job = JOB) => render(view(job))
const box = () => screen.getByPlaceholderText(/^Loose ends/)
const withEnds = (text) => ({ ...JOB, subsLooseEnds: { electrical: text } })

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

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

  const REFUSED_TOAST = {
    tone: 'error',
    title: 'Could not save the loose ends. Try again.',
    description: 'You do not have permission to do that.',
  }

  it('keeps what was typed, and says why, through the apply and the rollback of a refused write', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = open()
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    await act(async () => { fireEvent.blur(box()) })

    // Firestore applies the write to its cache at once, so the stored loose ends are the new ones.
    rerender(view(withEnds('Cover plates, labels')))
    expect(box().value).toBe('Cover plates, labels')

    // The rules refuse it: the cache goes back, and then the write rejects.
    rerender(view(JOB))
    await act(async () => { write.reject(refused()) })

    expect(mocks.toast.mock.calls.map(([opts]) => opts)).toEqual([REFUSED_TOAST])
    expect(box().value).toBe('Cover plates, labels')
  })

  it('keeps what was typed when the refusal arrives before the rollback', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = open()
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    await act(async () => { fireEvent.blur(box()) })
    rerender(view(withEnds('Cover plates, labels')))

    await act(async () => { write.reject(refused()) })
    rerender(view(JOB))

    expect(mocks.toast.mock.calls.map(([opts]) => opts)).toEqual([REFUSED_TOAST])
    expect(box().value).toBe('Cover plates, labels')
  })

  it('writes what was kept again when the box is left again, and then shows what is stored', async () => {
    mocks.updateJob.mockRejectedValueOnce(refused()).mockResolvedValueOnce()
    const { rerender } = open()
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    await act(async () => { fireEvent.blur(box()) })
    rerender(view(withEnds('Cover plates, labels')))
    rerender(view(JOB))
    expect(box().value).toBe('Cover plates, labels')

    fireEvent.focus(box())
    await act(async () => { fireEvent.blur(box()) })

    expect(mocks.updateJob).toHaveBeenCalledTimes(2)
    expect(mocks.updateJob).toHaveBeenLastCalledWith('job3', { 'subsLooseEnds.electrical': 'Cover plates, labels' })
    expect(mocks.toast.mock.calls.map(([opts]) => opts.tone)).toEqual(['error', 'success'])
    rerender(view(withEnds('Cover plates, labels')))
    expect(box().value).toBe('Cover plates, labels')
  })

  it('writes nothing more when the box is left again while the write is out, and still keeps the text if it is refused', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = open()
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
    await act(async () => { fireEvent.blur(box()) })
    rerender(view(withEnds('Cover plates, labels')))

    fireEvent.focus(box())
    await act(async () => { fireEvent.blur(box()) })
    expect(mocks.updateJob).toHaveBeenCalledTimes(1)

    rerender(view(JOB))
    await act(async () => { write.reject(refused()) })
    expect(box().value).toBe('Cover plates, labels')
  })

  it('does not take away what is being typed when the stored loose ends change elsewhere', async () => {
    const { rerender } = open()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })

    rerender(view(withEnds('Cover plates, labels and a final walk')))
    expect(box().value).toBe('Cover plates, labels')

    await act(async () => { fireEvent.blur(box()) })
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { 'subsLooseEnds.electrical': 'Cover plates, labels' })
  })

  // A person can go away from the box without leaving it, and no blur is sent: by Alt and the
  // left arrow, by the row going when a change is made elsewhere, by the screen closing. The
  // box used to write on every key, so nothing typed was lost. It writes what is typed, through
  // the same path and with the same words, when it goes away or the page is hidden.
  describe('when the box goes away with something typed in it', () => {
    it('saves what was typed, and says so, though the box was never left', async () => {
      const { unmount } = open()
      fireEvent.focus(box())
      fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
      expect(mocks.updateJob).not.toHaveBeenCalled()

      await act(async () => { unmount() })

      expect(mocks.updateJob).toHaveBeenCalledTimes(1)
      expect(mocks.updateJob).toHaveBeenCalledWith('job3', { 'subsLooseEnds.electrical': 'Cover plates, labels' })
      expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Loose ends saved.' })
    })

    it('says why, when that write is refused after the box has gone', async () => {
      mocks.updateJob.mockRejectedValue(refused())
      const { unmount } = open()
      fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })

      await act(async () => { unmount() })

      expect(mocks.toast).toHaveBeenCalledWith(REFUSED_TOAST)
    })

    it('saves what was typed when the page is hidden, and the box goes on showing it', async () => {
      const { rerender } = open()
      fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })

      await act(async () => { window.dispatchEvent(new Event('pagehide')) })

      expect(mocks.updateJob).toHaveBeenCalledTimes(1)
      expect(mocks.updateJob).toHaveBeenCalledWith('job3', { 'subsLooseEnds.electrical': 'Cover plates, labels' })
      rerender(view(withEnds('Cover plates, labels')))
      expect(box().value).toBe('Cover plates, labels')
    })

    it('writes nothing when nothing was typed, or the row has no document, or what was typed is what is saved', async () => {
      const untouched = open()
      await act(async () => { untouched.unmount() })

      const nowhere = open({ ...JOB, _docId: undefined })
      fireEvent.change(box(), { target: { value: 'Something else' } })
      await act(async () => { nowhere.unmount() })

      const same = open()
      fireEvent.change(box(), { target: { value: 'Cover plates' } })
      await act(async () => { same.unmount() })

      expect(mocks.updateJob).not.toHaveBeenCalled()
    })

    it('writes once, not twice, when the box was left and then goes away with the write already stored', async () => {
      const write = deferred()
      mocks.updateJob.mockReturnValue(write.promise)
      const { rerender, unmount } = open()
      fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
      await act(async () => { fireEvent.blur(box()) })
      rerender(view(withEnds('Cover plates, labels')))

      await act(async () => { unmount() })

      expect(mocks.updateJob).toHaveBeenCalledTimes(1)
      await act(async () => { write.resolve() })
    })

    // On a phone the tap that leaves the box also collapses its card, so the blur and the end
    // of the box come in the same turn, before the stored loose ends have been drawn again.
    it('writes once, and says so once, when the box is left and its card collapses in the same turn', async () => {
      const write = deferred()
      mocks.updateJob.mockReturnValue(write.promise)
      const { unmount } = open()
      fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })

      await act(async () => {
        fireEvent.blur(box())
        unmount()
      })
      await act(async () => { window.dispatchEvent(new Event('pagehide')) })
      await act(async () => { write.resolve() })

      expect(mocks.updateJob).toHaveBeenCalledTimes(1)
      expect(mocks.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Loose ends saved.' }]])
    })

    it('stops listening for the page being hidden once the box has gone', async () => {
      const { unmount } = open()
      fireEvent.change(box(), { target: { value: 'Cover plates, labels' } })
      await act(async () => { unmount() })
      mocks.updateJob.mockClear()

      await act(async () => { window.dispatchEvent(new Event('pagehide')) })

      expect(mocks.updateJob).not.toHaveBeenCalled()
    })
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
