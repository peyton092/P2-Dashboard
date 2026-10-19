import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { ToastProvider } from '@/components/ui/toast'
import { logError } from '@/lib/errorLogger'
import { useMutation, OFFLINE_WAIT_MS } from '../useMutation'

// useMutation is the one path every write in the app takes. These tests read the toast
// it is given as a spy, and then once with the real ToastProvider, to prove the Undo
// button a person sees does what the spy was told it would.

// The setup file replaces the error logger with spies, so that no test reaches Firestore.
beforeEach(() => {
  vi.mocked(logError).mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Resolves or rejects when the test says so, to look at the hook in between.
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

function setup() {
  const toast = vi.fn()
  const wrapper = ({ children }) => <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
  return { toast, ...renderHook(() => useMutation(), { wrapper }) }
}

describe('run', () => {
  it('resolves to ok and the value, and toasts the success words', async () => {
    const { result, toast } = setup()
    let outcome
    await act(async () => {
      outcome = await result.current.run(() => Promise.resolve({ docId: 'job9' }), { success: 'Job created.' })
    })
    expect(outcome).toEqual({ ok: true, value: { docId: 'job9' } })
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({ tone: 'success', title: 'Job created.' })
  })

  it('toasts nothing for a success it was given no words for', async () => {
    const { result, toast } = setup()
    await act(async () => { await result.current.run(() => Promise.resolve()) })
    expect(toast).not.toHaveBeenCalled()
  })

  it('works when fn is not async', async () => {
    const { result, toast } = setup()
    let outcome
    await act(async () => { outcome = await result.current.run(() => 7, { success: 'Done.' }) })
    expect(outcome).toEqual({ ok: true, value: 7 })
    expect(toast).toHaveBeenCalledWith({ tone: 'success', title: 'Done.' })
  })

  it('calls fn once, with nothing', async () => {
    const { result } = setup()
    const fn = vi.fn().mockResolvedValue(undefined)
    await act(async () => { await result.current.run(fn) })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith()
  })

  describe('when fn fails', () => {
    it('resets busy after a rejected fn', async () => {
      const { result } = setup()
      await act(async () => {
        await result.current.run(() => Promise.reject(new Error('Nope.')), { error: 'Could not save. Try again.' })
      })
      expect(result.current.busy).toBe(false)
    })

    it('resolves to not ok and the message, and never rethrows', async () => {
      const { result } = setup()
      let outcome
      await act(async () => {
        outcome = await result.current.run(() => Promise.reject(new Error('Staff access required.')), { error: 'Could not save. Try again.' })
      })
      expect(outcome).toEqual({ ok: false, error: 'Staff access required.' })
    })

    it('calls the toast with the error words and the message the error carries', async () => {
      const { result, toast } = setup()
      await act(async () => {
        await result.current.run(
          () => Promise.reject(sdkError('failed-precondition', 'This change order has already been decided.')),
          { error: 'Could not approve the change order. Try again.' },
        )
      })
      expect(toast).toHaveBeenCalledTimes(1)
      expect(toast).toHaveBeenCalledWith({
        tone: 'error',
        title: 'Could not approve the change order. Try again.',
        description: 'This change order has already been decided.',
      })
    })

    it('shows no bare SDK code: an error that only repeats its code is given no description', async () => {
      const { result, toast } = setup()
      let outcome
      await act(async () => {
        outcome = await result.current.run(() => Promise.reject(sdkError('internal', 'internal')), { error: 'Could not save. Try again.' })
      })
      expect(toast).toHaveBeenCalledWith({ tone: 'error', title: 'Could not save. Try again.' })
      expect(outcome).toEqual({ ok: false, error: 'Could not save. Try again.' })
    })

    it('says Something went wrong when it was given no error words', async () => {
      const { result, toast } = setup()
      await act(async () => { await result.current.run(() => Promise.reject(sdkError('unknown', 'unknown'))) })
      expect(toast).toHaveBeenCalledWith({ tone: 'error', title: 'Something went wrong. Try again.' })
    })

    it('does not toast the success words', async () => {
      const { result, toast } = setup()
      await act(async () => {
        await result.current.run(() => Promise.reject(new Error('No.')), { success: 'Saved.', error: 'Could not save. Try again.' })
      })
      expect(toast.mock.calls.map(([opts]) => opts.tone)).toEqual(['error'])
    })

    it('handles an fn that throws before it returns a promise', async () => {
      const { result, toast } = setup()
      let outcome
      await act(async () => {
        outcome = await result.current.run(() => { throw new Error('Before the call.') }, { error: 'Could not save. Try again.' })
      })
      expect(outcome).toEqual({ ok: false, error: 'Before the call.' })
      expect(toast).toHaveBeenCalledTimes(1)
      expect(result.current.busy).toBe(false)
    })

    it.each([[undefined], [null], ['a string'], [42]])('handles a rejection with %p', async (reason) => {
      const { result, toast } = setup()
      let outcome
      await act(async () => {
        outcome = await result.current.run(() => Promise.reject(reason), { error: 'Could not save. Try again.' })
      })
      expect(outcome).toEqual({ ok: false, error: 'Could not save. Try again.' })
      expect(toast).toHaveBeenCalledWith({ tone: 'error', title: 'Could not save. Try again.' })
    })

    it('can be run again after a failure', async () => {
      const { result, toast } = setup()
      const fn = vi.fn().mockRejectedValueOnce(new Error('First.')).mockResolvedValueOnce('second')
      await act(async () => { await result.current.run(fn, { success: 'Saved.' }) })
      await act(async () => { await result.current.run(fn, { success: 'Saved.' }) })
      expect(fn).toHaveBeenCalledTimes(2)
      expect(toast.mock.calls.map(([opts]) => opts.tone)).toEqual(['error', 'success'])
    })
  })
})

describe('busy', () => {
  it('is false before anything runs', () => {
    const { result } = setup()
    expect(result.current.busy).toBe(false)
  })

  it('is true while the work is out, and false once it is done', async () => {
    const { result } = setup()
    const work = deferred()
    let pending
    act(() => { pending = result.current.run(() => work.promise, { success: 'Saved.' }) })
    expect(result.current.busy).toBe(true)
    await act(async () => { work.resolve(); await pending })
    expect(result.current.busy).toBe(false)
  })

  it('stays true until the last of two overlapping runs is done, and does not drop in between', async () => {
    const first = deferred()
    const second = deferred()
    const seen = []
    const toast = vi.fn()
    const wrapper = ({ children }) => <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
    const { result } = renderHook(() => {
      const mutation = useMutation()
      seen.push(mutation.busy)
      return mutation
    }, { wrapper })

    let a, b
    act(() => { a = result.current.run(() => first.promise) })
    act(() => { b = result.current.run(() => second.promise) })
    await act(async () => { first.resolve(); await a })
    expect(result.current.busy).toBe(true)
    await act(async () => { second.resolve(); await b })
    expect(result.current.busy).toBe(false)

    const from = seen.indexOf(true)
    const to = seen.lastIndexOf(true)
    expect(seen.slice(from, to + 1).every(Boolean)).toBe(true)
  })

  it('counts a run that fails like one that succeeds', async () => {
    const { result } = setup()
    const failing = deferred()
    const working = deferred()
    let a, b
    act(() => { a = result.current.run(() => failing.promise, { error: 'Could not save. Try again.' }) })
    act(() => { b = result.current.run(() => working.promise) })
    await act(async () => { failing.reject(new Error('No.')); await a })
    expect(result.current.busy).toBe(true)
    await act(async () => { working.resolve(); await b })
    expect(result.current.busy).toBe(false)
  })
})

describe('error', () => {
  it('is null at first, holds the message of the last failure, and clears when the next run starts', async () => {
    const { result } = setup()
    expect(result.current.error).toBeNull()

    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('Staff access required.')), { error: 'Could not save. Try again.' })
    })
    expect(result.current.error).toBe('Staff access required.')

    const work = deferred()
    let pending
    act(() => { pending = result.current.run(() => work.promise) })
    expect(result.current.error).toBeNull()
    await act(async () => { work.resolve(); await pending })
    expect(result.current.error).toBeNull()
  })

  it('holds the error words when the error carried no message of its own', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.run(() => Promise.reject(sdkError('internal', 'internal')), { error: 'Could not save. Try again.' })
    })
    expect(result.current.error).toBe('Could not save. Try again.')
  })
})

describe('run as a dependency', () => {
  it('is the same function on every render', async () => {
    const { result, rerender } = setup()
    const first = result.current.run
    rerender()
    await act(async () => { await result.current.run(() => Promise.reject(new Error('No.'))) })
    rerender()
    expect(result.current.run).toBe(first)
  })

  it('stays the same function when the toast function changes between renders', () => {
    const wrapper = ({ children }) => {
      const toast = (...args) => args
      return <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
    }
    const { result, rerender } = renderHook(() => useMutation(), { wrapper })
    const first = result.current.run
    rerender()
    rerender()
    expect(result.current.run).toBe(first)
  })

  it('uses the toast function of the latest render', async () => {
    const early = vi.fn()
    const late = vi.fn()
    let current = early
    const wrapper = ({ children }) => <ToastContext.Provider value={current}>{children}</ToastContext.Provider>
    const { result, rerender } = renderHook(() => useMutation(), { wrapper })
    current = late
    rerender()
    await act(async () => { await result.current.run(() => Promise.resolve(), { success: 'Saved.' }) })
    expect(early).not.toHaveBeenCalled()
    expect(late).toHaveBeenCalledWith({ tone: 'success', title: 'Saved.' })
  })
})

describe('after the screen is gone', () => {
  it('still tells the person how the write ended', async () => {
    const { result, unmount, toast } = setup()
    const work = deferred()
    let pending
    act(() => { pending = result.current.run(() => work.promise, { success: 'Saved.' }) })
    unmount()
    await act(async () => { work.resolve(); await pending })
    expect(toast).toHaveBeenCalledWith({ tone: 'success', title: 'Saved.' })
  })

  it('does not throw when a failure arrives', async () => {
    const { result, unmount, toast } = setup()
    const work = deferred()
    let pending, outcome
    act(() => { pending = result.current.run(() => work.promise, { error: 'Could not save. Try again.' }) })
    unmount()
    await act(async () => { work.reject(new Error('No.')); outcome = await pending })
    expect(outcome).toEqual({ ok: false, error: 'No.' })
    expect(toast).toHaveBeenCalledWith({ tone: 'error', title: 'Could not save. Try again.', description: 'No.' })
  })
})

describe('undo', () => {
  async function runWithUndo(undo, options = {}) {
    const rig = setup()
    await act(async () => {
      await rig.result.current.run(() => Promise.resolve(), { success: 'Notification dismissed.', undo, ...options })
    })
    return { ...rig, opts: rig.toast.mock.calls[0][0] }
  }

  it('puts an Undo action on the success toast', async () => {
    const { opts } = await runWithUndo(vi.fn())
    expect(opts).toMatchObject({ tone: 'success', title: 'Notification dismissed.', action: { label: 'Undo' } })
    expect(typeof opts.action.onClick).toBe('function')
  })

  it('puts no action on the toast when there is nothing to undo', async () => {
    const { toast, result } = setup()
    await act(async () => { await result.current.run(() => Promise.resolve(), { success: 'Saved.' }) })
    expect('action' in toast.mock.calls[0][0]).toBe(false)
  })

  it('calls undo when the toast action is clicked, and not before', async () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    const { opts } = await runWithUndo(undo)
    expect(undo).not.toHaveBeenCalled()
    await act(async () => { await opts.action.onClick() })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledWith()
  })

  it('says Undone when undo worked', async () => {
    const { opts, toast } = await runWithUndo(vi.fn().mockResolvedValue(undefined))
    await act(async () => { await opts.action.onClick() })
    expect(toast).toHaveBeenCalledTimes(2)
    expect(toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Undone.' })
  })

  it('accepts an undo that is not async', async () => {
    const undo = vi.fn()
    const { opts, toast } = await runWithUndo(undo)
    await act(async () => { await opts.action.onClick() })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Undone.' })
  })

  it('says Could not undo, with the message, when undo fails, and does not say Undone', async () => {
    const undo = vi.fn().mockRejectedValue(sdkError('permission-denied', 'Staff access required.'))
    const { opts, toast } = await runWithUndo(undo)
    await act(async () => { await opts.action.onClick() })
    expect(toast).toHaveBeenLastCalledWith({ tone: 'error', title: 'Could not undo. Try again.', description: 'Staff access required.' })
    expect(toast.mock.calls.some(([call]) => call.title === 'Undone.')).toBe(false)
  })

  it('gives no bare SDK code when undo fails with one', async () => {
    const { opts, toast } = await runWithUndo(vi.fn().mockRejectedValue(sdkError('internal', 'internal')))
    await act(async () => { await opts.action.onClick() })
    expect(toast).toHaveBeenLastCalledWith({ tone: 'error', title: 'Could not undo. Try again.' })
  })

  it('never offers Undo on the toast of the Undo itself', async () => {
    const { opts, toast } = await runWithUndo(vi.fn())
    await act(async () => { await opts.action.onClick() })
    expect('action' in toast.mock.calls[1][0]).toBe(false)
  })

  it('is not offered when the write failed', async () => {
    const { result, toast } = setup()
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('No.')), { success: 'Dismissed.', undo: vi.fn() })
    })
    expect(toast.mock.calls.map(([opts]) => opts.tone)).toEqual(['error'])
    expect('action' in toast.mock.calls[0][0]).toBe(false)
  })

  it('puts the Undo on a toast that says Done when no success words were given', async () => {
    const { result, toast } = setup()
    await act(async () => { await result.current.run(() => Promise.resolve(), { undo: vi.fn() }) })
    expect(toast.mock.calls[0][0]).toMatchObject({ tone: 'success', title: 'Done.', action: { label: 'Undo' } })
  })

  it('still runs undo and says so when the screen that asked is gone', async () => {
    const { result, unmount, toast } = setup()
    const undo = vi.fn().mockResolvedValue(undefined)
    await act(async () => { await result.current.run(() => Promise.resolve(), { success: 'Dismissed.', undo }) })
    const { action } = toast.mock.calls[0][0]
    unmount()
    await act(async () => { await action.onClick() })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Undone.' })
  })
})

// Every failure is also put in the error log, with the source mutation. It used to get there
// as a rejection nobody handled, and run handles it now.
describe('the error log', () => {
  it('is told once, with the error itself and the source mutation, when a write fails', async () => {
    const { result } = setup()
    const failure = Object.assign(new Error('No document to update: jobs/abc'), { code: 'not-found' })
    await act(async () => { await result.current.run(() => Promise.reject(failure), { error: 'Could not save. Try again.' }) })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(failure, 'mutation')
  })

  it('is told when fn throws before it returns a promise, and when the rejection is not an error', async () => {
    const { result } = setup()
    const thrown = new Error('Before the call.')
    await act(async () => { await result.current.run(() => { throw thrown }) })
    await act(async () => { await result.current.run(() => Promise.reject('a string')) })
    expect(logError.mock.calls).toEqual([[thrown, 'mutation'], ['a string', 'mutation']])
  })

  it('is told when undo fails', async () => {
    const { result, toast } = setup()
    await act(async () => { await result.current.run(() => Promise.resolve(), { success: 'Dismissed.', undo: () => Promise.reject(new Error('No.')) }) })
    expect(logError).not.toHaveBeenCalled()
    await act(async () => { await toast.mock.calls[0][0].action.onClick() })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError.mock.calls[0][1]).toBe('mutation')
  })

  it('is not told about a write that went through', async () => {
    const { result } = setup()
    await act(async () => { await result.current.run(() => Promise.resolve(1), { success: 'Saved.' }) })
    expect(logError).not.toHaveBeenCalled()
  })

  it('is told of a failure that arrives after the screen is gone', async () => {
    const { result, unmount } = setup()
    const work = deferred()
    let pending
    act(() => { pending = result.current.run(() => work.promise) })
    unmount()
    const failure = new Error('No.')
    await act(async () => { work.reject(failure); await pending })
    expect(logError).toHaveBeenCalledWith(failure, 'mutation')
  })

  // The logger never throws, but run promises never to reject, so it does not rely on that.
  it('still resolves not ok, after telling the person, when the logger throws', async () => {
    vi.mocked(logError).mockImplementationOnce(() => { throw new Error('The logger broke.') })
    const { result, toast } = setup()
    let outcome
    await act(async () => {
      outcome = await result.current.run(() => Promise.reject(new Error('No.')), { error: 'Could not save. Try again.' })
    })
    expect(outcome).toEqual({ ok: false, error: 'No.' })
    expect(toast).toHaveBeenCalledWith({ tone: 'error', title: 'Could not save. Try again.', description: 'No.' })
  })
})

// A Firestore write resolves when the server says so, and offline it does not, though the
// entry is in the local cache and will be sent. A run that is given queue: true, which says
// its work is exactly one such write, says after OFFLINE_WAIT_MS, offline, that the entry is
// saved on this device and resolves queued, and goes on watching the write. A run that is not
// given it waits for its work, however long that takes (see the last describe in this one).
describe('while a write is out and the device is offline', () => {
  const QUEUED = 'Saved on this device. It will sync when you are back online.'
  let onLine

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  })
  afterEach(() => { onLine.mockRestore() })

  // Starts a run of work the test settles later, and keeps what it resolved to. The options
  // are passed as they are.
  function begin(rig, work, options = {}) {
    const box = { outcome: undefined }
    act(() => { rig.result.current.run(() => work.promise, options).then((outcome) => { box.outcome = outcome }) })
    return box
  }
  // The same for a write that the screen says is one Firestore write.
  const beginWrite = (rig, work, options = {}) => begin(rig, work, { queue: true, ...options })
  const wait = (ms) => act(async () => { vi.advanceTimersByTime(ms) })

  it('exports the wait as 2500 milliseconds', () => {
    expect(OFFLINE_WAIT_MS).toBe(2500)
  })

  it('stays out, with busy on and nothing said, until the wait has gone by', async () => {
    const rig = setup()
    const run = beginWrite(rig, deferred(), { success: 'Saved.' })

    await wait(OFFLINE_WAIT_MS - 1)

    expect(run.outcome).toBeUndefined()
    expect(rig.result.current.busy).toBe(true)
    expect(rig.toast).not.toHaveBeenCalled()
  })

  it('resolves ok and queued after the wait, says it is saved on this device, and is not busy', async () => {
    const rig = setup()
    const run = beginWrite(rig, deferred(), { success: 'Saved.' })

    await wait(OFFLINE_WAIT_MS)

    expect(run.outcome).toEqual({ ok: true, value: undefined, queued: true })
    expect(rig.toast).toHaveBeenCalledTimes(1)
    expect(rig.toast).toHaveBeenCalledWith({ tone: 'info', title: QUEUED })
    expect(rig.result.current.busy).toBe(false)
    expect(logError).not.toHaveBeenCalled()
  })

  it('says no success words and offers no Undo, even for a write that was given both', async () => {
    const rig = setup()
    beginWrite(rig, deferred(), { success: 'Notification dismissed.', undo: vi.fn() })

    await wait(OFFLINE_WAIT_MS)

    expect(rig.toast.mock.calls.map(([opts]) => opts)).toEqual([{ tone: 'info', title: QUEUED }])
  })

  it('tells the person, with the reason and in the error log, when the write is refused later', async () => {
    const rig = setup()
    const work = deferred()
    beginWrite(rig, work, { error: 'Could not save the material. Try again.' })
    await wait(OFFLINE_WAIT_MS)
    const refused = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

    await act(async () => { work.reject(refused) })

    expect(rig.toast).toHaveBeenCalledTimes(2)
    expect(rig.toast).toHaveBeenLastCalledWith({
      tone: 'error',
      title: 'Could not save the material. Try again.',
      description: 'You do not have permission to do that.',
    })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(refused, 'mutation')
    expect(rig.result.current.error).toBe('You do not have permission to do that.')
    expect(rig.result.current.busy).toBe(false)
  })

  it('shows nothing more when the write goes through later', async () => {
    const rig = setup()
    const work = deferred()
    beginWrite(rig, work, { success: 'Saved.', undo: vi.fn() })
    await wait(OFFLINE_WAIT_MS)

    await act(async () => { work.resolve('late') })
    await wait(60000)

    expect(rig.toast).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it('still tells the person of a late refusal when the screen is gone, without setting state', async () => {
    const rig = setup()
    const work = deferred()
    beginWrite(rig, work, { error: 'Could not save. Try again.' })
    await wait(OFFLINE_WAIT_MS)
    rig.unmount()

    await act(async () => { work.reject(new Error('No.')) })

    expect(rig.toast).toHaveBeenLastCalledWith({ tone: 'error', title: 'Could not save. Try again.', description: 'No.' })
  })

  it('leaves a write that settles before the wait alone, whether it works or fails', async () => {
    const rig = setup()
    const worked = deferred()
    const failed = deferred()
    const first = beginWrite(rig, worked, { success: 'Saved.' })
    const second = beginWrite(rig, failed, { error: 'Could not save. Try again.' })
    await wait(100)

    await act(async () => { worked.resolve(7); failed.reject(new Error('No.')) })

    expect(first.outcome).toEqual({ ok: true, value: 7 })
    expect(second.outcome).toEqual({ ok: false, error: 'No.' })
    expect(rig.toast.mock.calls.map(([opts]) => opts.tone)).toEqual(['success', 'error'])
    await wait(60000)
    expect(rig.toast).toHaveBeenCalledTimes(2)
  })

  it('keeps today\'s path for a write that fails fast offline', async () => {
    const rig = setup()
    const work = deferred()
    const run = beginWrite(rig, work, { error: 'Could not disconnect QuickBooks. Try again.' })
    await wait(200)

    await act(async () => { work.reject(sdkError('unavailable', 'unavailable')) })

    expect(run.outcome).toEqual({ ok: false, error: 'Could not disconnect QuickBooks. Try again.' })
    expect(rig.toast).toHaveBeenCalledTimes(1)
    expect(rig.toast).toHaveBeenCalledWith({ tone: 'error', title: 'Could not disconnect QuickBooks. Try again.' })
  })

  it('has no timer left once the write has settled, and none once it is queued', async () => {
    const rig = setup()
    const work = deferred()
    beginWrite(rig, work)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { work.resolve() })
    expect(vi.getTimerCount()).toBe(0)

    beginWrite(rig, deferred())
    await wait(OFFLINE_WAIT_MS)
    expect(vi.getTimerCount()).toBe(0)
  })

  // Queueing is opt in. A single Firestore write is in the local cache at once, so "saved on
  // this device" is true of it. It is false of a call to a Cloud Function or to Auth, which
  // nothing queues, and a function that goes on to do more after its first await has not done
  // it, and has no value to give back, when the first await is still out.
  describe('and the run is not given queue: true', () => {
    it.each([
      ['leaves it out', {}],
      ['says queue: false', { queue: false }],
    ])('never queues when it %s, however long the work is out, and starts no timer', async (_how, options) => {
      const rig = setup()
      const work = deferred()
      const run = begin(rig, work, { success: 'Saved.', ...options })
      expect(vi.getTimerCount()).toBe(0)

      await wait(10 * 60 * 1000)

      expect(run.outcome).toBeUndefined()
      expect(rig.result.current.busy).toBe(true)
      expect(rig.toast).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)

      await act(async () => { work.resolve('late') })

      expect(run.outcome).toEqual({ ok: true, value: 'late' })
      expect(rig.toast.mock.calls).toEqual([[{ tone: 'success', title: 'Saved.' }]])
      expect(rig.result.current.busy).toBe(false)
    })

    it('gives a function that does more after its first await the whole of its work, and its value', async () => {
      const rig = setup()
      const added = deferred()
      const steps = []
      const box = { outcome: undefined }
      act(() => {
        rig.result.current.run(async () => {
          const created = await added.promise
          steps.push('kept the id')
          return created.id
        }).then((outcome) => { box.outcome = outcome })
      })

      await wait(OFFLINE_WAIT_MS * 3)
      expect(box.outcome).toBeUndefined()
      expect(steps).toEqual([])

      await act(async () => { added.resolve({ id: 'new1' }) })

      expect(steps).toEqual(['kept the id'])
      expect(box.outcome).toEqual({ ok: true, value: 'new1' })
    })

    it('fails as it does online when a call to the server is refused, however late', async () => {
      const rig = setup()
      const work = deferred()
      const run = begin(rig, work, { error: 'Could not disconnect QuickBooks. Try again.' })
      await wait(OFFLINE_WAIT_MS * 2)
      expect(run.outcome).toBeUndefined()

      await act(async () => { work.reject(sdkError('unavailable', 'unavailable')) })

      expect(run.outcome).toEqual({ ok: false, error: 'Could not disconnect QuickBooks. Try again.' })
      expect(rig.toast.mock.calls).toEqual([[{ tone: 'error', title: 'Could not disconnect QuickBooks. Try again.' }]])
      expect(logError).toHaveBeenCalledTimes(1)
      expect(rig.result.current.busy).toBe(false)
    })

    it('does not queue the undo of a run that was not queued, and waits for it', async () => {
      const rig = setup()
      const undoing = deferred()
      await act(async () => { await rig.result.current.run(() => Promise.resolve(), { success: 'Dismissed.', undo: () => undoing.promise }) })
      const { action } = rig.toast.mock.calls[0][0]
      const box = { outcome: undefined }
      act(() => { action.onClick().then((outcome) => { box.outcome = outcome }) })

      await wait(10 * 60 * 1000)

      expect(box.outcome).toBeUndefined()
      expect(rig.toast).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      await act(async () => { undoing.resolve() })

      expect(box.outcome).toEqual({ ok: true, value: undefined })
      expect(rig.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Undone.' })
    })
  })

  describe('and the run it undoes was given queue: true', () => {
    it('queues the undo too, and says it is saved on this device', async () => {
      const rig = setup()
      const undoing = deferred()
      await act(async () => { await rig.result.current.run(() => Promise.resolve(), { queue: true, success: 'Dismissed.', undo: () => undoing.promise }) })
      const { action } = rig.toast.mock.calls[0][0]
      const box = { outcome: undefined }
      act(() => { action.onClick().then((outcome) => { box.outcome = outcome }) })
      expect(box.outcome).toBeUndefined()

      await wait(OFFLINE_WAIT_MS)

      expect(box.outcome).toEqual({ ok: true, value: undefined, queued: true })
      expect(rig.toast.mock.calls.map(([opts]) => opts)).toEqual([
        expect.objectContaining({ tone: 'success', title: 'Dismissed.' }),
        { tone: 'info', title: QUEUED },
      ])
    })
  })

  describe('and when the device is online', () => {
    beforeEach(() => { onLine.mockReturnValue(true) })

    it('waits for the acknowledgement however long it takes, with nothing said', async () => {
      const rig = setup()
      const work = deferred()
      const run = beginWrite(rig, work, { success: 'Saved.' })

      await wait(60000)

      expect(run.outcome).toBeUndefined()
      expect(rig.result.current.busy).toBe(true)
      expect(rig.toast).not.toHaveBeenCalled()

      await act(async () => { work.resolve('done') })

      expect(run.outcome).toEqual({ ok: true, value: 'done' })
      expect(rig.toast).toHaveBeenCalledTimes(1)
      expect(rig.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Saved.' })
    })

    it('notices at the next check that the device went offline while the write was out', async () => {
      const rig = setup()
      const run = beginWrite(rig, deferred(), { success: 'Saved.' })
      await wait(OFFLINE_WAIT_MS)
      expect(run.outcome).toBeUndefined()

      onLine.mockReturnValue(false)
      await wait(OFFLINE_WAIT_MS - 1)
      expect(run.outcome).toBeUndefined()
      await wait(1)

      expect(run.outcome).toEqual({ ok: true, value: undefined, queued: true })
      expect(rig.toast).toHaveBeenCalledWith({ tone: 'info', title: QUEUED })
    })
  })
})

// The same thing with the real toast on the screen: the button a person presses.
describe('with the real toast', () => {
  function Harness({ work = () => Promise.resolve(), undo }) {
    const { run, busy } = useMutation()
    return (
      <button type="button" disabled={busy} onClick={() => run(work, { success: 'Notification dismissed.', error: 'Could not dismiss it. Try again.', undo })}>
        Dismiss
      </button>
    )
  }
  const open = (props) => render(<ToastProvider><Harness {...props} /></ToastProvider>)
  const press = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
  // The toasts on the screen. Their words are also in a live element for as long as they are
  // there, so they are looked for in the toasts themselves.
  const shown = () => [...document.querySelectorAll('[data-toast]')].map((el) => el.textContent)

  it('shows the success words with an Undo button', async () => {
    open({ undo: vi.fn() })
    await press()
    expect(shown()).toEqual(['Notification dismissed.Undo'])
    expect(screen.getByRole('status').textContent).toContain('Notification dismissed.')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('runs undo when Undo is pressed, takes the toast away and says Undone', async () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    open({ undo })
    await press()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })

    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(shown()).toEqual(['Undone.'])
  })

  it('shows the error as an alert, with the reason, when the write fails', async () => {
    open({ work: () => Promise.reject(sdkError('permission-denied', 'Staff access required.')), undo: vi.fn() })
    await press()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not dismiss it. Try again.')
    expect(alert.textContent).toContain('Staff access required.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('keeps an Undo toast for 8 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open({ undo: vi.fn() })
    await press()

    act(() => { vi.advanceTimersByTime(7999) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('keeps a toast that has no Undo for 4 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open()
    await press()

    act(() => { vi.advanceTimersByTime(3999) })
    expect(shown()).toEqual(['Notification dismissed.'])
    act(() => { vi.advanceTimersByTime(1) })
    expect(shown()).toEqual([])
  })
})
