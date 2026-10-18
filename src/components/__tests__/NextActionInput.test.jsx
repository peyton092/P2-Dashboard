import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The next action of a job is saved when the person leaves the box. The box follows what is
// stored, so a next action that someone else saved while this box was showing the old one
// is shown, and leaving the box without typing never writes the old one back over it.
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
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

const JOB = { id: 'QBS-003', _docId: 'job3', nextAction: 'Call the inspector' }

beforeEach(() => {
  mocks.updateJob.mockReset()
  mocks.toast.mockReset()
})

afterEach(cleanup)

const withToast = (ui) => <ToastContext.Provider value={mocks.toast}>{ui}</ToastContext.Provider>
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

  it('says saving while the write is out', async () => {
    const write = deferred()
    mocks.updateJob.mockReturnValue(write.promise)
    render(withToast(<NextActionInput job={JOB} />))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })

    expect(screen.getByText('saving…')).toBeTruthy()
    await act(async () => { write.resolve() })
    expect(screen.queryByText('saving…')).toBeNull()
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

  it('keeps what was typed, and says why, when the write is refused', async () => {
    mocks.updateJob.mockRejectedValue(refused())
    render(withToast(<NextActionInput job={JOB} />))
    fireEvent.change(field(), { target: { value: 'Schedule the final' } })
    await act(async () => { fireEvent.blur(field()) })

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not save the next action. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(field().value).toBe('Schedule the final')
  })

  it('follows the stored next action when it changes elsewhere, and does not write the old one back', () => {
    const { rerender } = render(withToast(<NextActionInput job={JOB} />))
    rerender(withToast(<NextActionInput job={{ ...JOB, nextAction: 'Inspector called, passed' }} />))
    expect(field().value).toBe('Inspector called, passed')

    fireEvent.focus(field())
    fireEvent.blur(field())
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('shows the placeholder it is given, and writes nothing for a job with no document', () => {
    render(withToast(<NextActionInput job={{ id: 'QBS-009' }} placeholder="Schedule the rough in" />))
    const box = screen.getByPlaceholderText('Schedule the rough in')
    fireEvent.change(box, { target: { value: 'Something' } })
    fireEvent.blur(box)
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })
})
