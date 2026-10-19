import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The next action of a job is saved when the person leaves the box. The box follows what is
// stored while nothing is typed in it, so a next action that someone else saved while this
// box was showing the old one is shown, and leaving the box without typing never writes the
// old one back over it. What is typed stays in the box until it is saved, through the apply of
// the write to Firestore's cache, which changes the stored value at once, and through the
// rollback of a write the rules refuse, which changes it back, so it can be tried again.
const mocks = vi.hoisted(() => ({
  updateJob: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../hooks/useFirestore', () => ({ updateJob: mocks.updateJob }))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import { NextActionInput } from '../PMDashboard'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const JOB = { id: 'QBS-003', _docId: 'job3', nextAction: 'Call the inspector' }

beforeEach(() => {
  mocks.updateJob.mockReset()
  mocks.toast.mockReset()
})

afterEach(cleanup)

const withToast = (ui) => <ToastContext.Provider value={mocks.toast}>{ui}</ToastContext.Provider>
const view = (job) => withToast(<NextActionInput job={job} />)
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)
const field = () => screen.getByPlaceholderText('Next action…')

describe('NextActionInput', () => {
  it('shows the stored next action, and writes nothing while the person types', () => {
    render(withToast(<NextActionInput job={JOB} />))
    expect(field().value).toBe('Call the inspector')
    fireEvent.change(field(), { target: { value: 'Call the inspector again' } })
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('saves the trimmed text when the person leaves the box, and says so', async () => {
    render(withToast(<NextActionInput job={JOB} />))
    fireEvent.change(field(), { target: { value: '  Schedule the final  ' } })
    await act(async () => { fireEvent.blur(field()) })

    expect(mocks.updateJob).toHaveBeenCalledTimes(1)
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { nextAction: 'Schedule the final' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Next action saved.' }])
  })

  it('says saving from the moment the box is left until the server has answered, across the apply of the write', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })
    expect(screen.getByText('saving…')).toBeTruthy()

    // Firestore applies the write to its cache at once, so the stored next action is the new one.
    rerender(view({ ...JOB, nextAction: 'Schedule the final' }))
    expect(screen.getByText('saving…')).toBeTruthy()
    expect(field().value).toBe('Schedule the final')

    await act(async () => { write.resolve() })
    expect(screen.queryByText('saving…')).toBeNull()
    expect(field().value).toBe('Schedule the final')
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Next action saved.' }])
  })

  it('writes nothing when the person leaves the box without a change, or with only spaces added', () => {
    render(withToast(<NextActionInput job={JOB} />))
    fireEvent.blur(field())
    fireEvent.change(field(), { target: { value: 'Call the inspector  ' } })
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('writes nothing for a job that has no next action when the box is left empty or with only spaces', () => {
    render(withToast(<NextActionInput job={{ id: 'QBS-003', _docId: 'job3' }} />))
    fireEvent.blur(field())
    fireEvent.change(field(), { target: { value: '   ' } })
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  const REFUSED_TOAST = {
    tone: 'error',
    title: 'Could not save the next action. Try again.',
    description: 'You do not have permission to do that.',
  }

  it('keeps what was typed, and says why, through the apply and the rollback of a refused write', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })

    rerender(view({ ...JOB, nextAction: 'Schedule the final' }))
    expect(field().value).toBe('Schedule the final')
    expect(screen.getByText('saving…')).toBeTruthy()

    // The rules refuse it: the cache goes back, and then the write rejects.
    rerender(view(JOB))
    await act(async () => { write.reject(refused()) })

    expect(toastCalls()).toEqual([REFUSED_TOAST])
    expect(field().value).toBe('Schedule the final')
    expect(screen.queryByText('saving…')).toBeNull()
  })

  it('keeps what was typed when the refusal arrives before the rollback', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, nextAction: 'Schedule the final' }))

    await act(async () => { write.reject(refused()) })
    rerender(view(JOB))

    expect(toastCalls()).toEqual([REFUSED_TOAST])
    expect(field().value).toBe('Schedule the final')
    expect(screen.queryByText('saving…')).toBeNull()
  })

  it('writes what was kept again when the box is left again, and then shows what is stored', async () => {
    mocks.updateJob.mockRejectedValueOnce(refused()).mockResolvedValueOnce()
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, nextAction: 'Schedule the final' }))
    rerender(view(JOB))
    expect(field().value).toBe('Schedule the final')

    fireEvent.focus(field())
    await act(async () => { fireEvent.blur(field()) })

    expect(mocks.updateJob).toHaveBeenCalledTimes(2)
    expect(mocks.updateJob).toHaveBeenLastCalledWith('job3', { nextAction: 'Schedule the final' })
    expect(toastCalls().map((call) => call.tone)).toEqual(['error', 'success'])
    rerender(view({ ...JOB, nextAction: 'Schedule the final' }))
    expect(field().value).toBe('Schedule the final')
  })

  it('writes nothing more when the box is left again while the write is out, and still keeps the text if it is refused', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, nextAction: 'Schedule the final' }))

    fireEvent.focus(field())
    await act(async () => { fireEvent.blur(field()) })
    expect(mocks.updateJob).toHaveBeenCalledTimes(1)

    rerender(view(JOB))
    await act(async () => { write.reject(refused()) })
    expect(field().value).toBe('Schedule the final')
  })

  it('does not lose what is typed after the box was left, while the first write is out', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValueOnce(write.promise).mockResolvedValue()
    const { rerender } = render(view(JOB))
    fireEvent.change(field(), { target: { value: 'Schedule' } })
    await act(async () => { fireEvent.blur(field()) })
    rerender(view({ ...JOB, nextAction: 'Schedule' }))

    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { write.resolve() })
    expect(field().value).toBe('Schedule the final')

    await act(async () => { fireEvent.blur(field()) })
    expect(mocks.updateJob).toHaveBeenLastCalledWith('job3', { nextAction: 'Schedule the final' })
  })

  it('follows the stored next action when it changes elsewhere, and does not write the old one back', () => {
    const { rerender } = render(withToast(<NextActionInput job={JOB} />))
    rerender(withToast(<NextActionInput job={{ ...JOB, nextAction: 'Inspector called, passed' }} />))
    expect(field().value).toBe('Inspector called, passed')

    fireEvent.focus(field())
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('does not take away what is being typed when the stored next action changes elsewhere', async () => {
    const { rerender } = render(view(JOB))
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })

    rerender(view({ ...JOB, nextAction: 'Inspector called, passed' }))
    expect(field().value).toBe('Schedule the final')

    await act(async () => { fireEvent.blur(field()) })
    expect(mocks.updateJob).toHaveBeenCalledWith('job3', { nextAction: 'Schedule the final' })
  })

  it('shows the placeholder it is given, and writes nothing for a job with no document', () => {
    render(withToast(<NextActionInput job={{ id: 'QBS-009' }} placeholder="Schedule the rough in" />))
    const box = screen.getByPlaceholderText('Schedule the rough in')
    fireEvent.change(box, { target: { value: 'Something' } })
    fireEvent.blur(box)
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })
})
