import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { useSavedField } from '../useSavedField'

// A text box over a value that is stored somewhere else, such as the next action of a job in
// Firestore, and saved when the person leaves the box. Firestore applies a write to its cache
// at once, so the stored value changes before the server has answered, and changes back if the
// rules refuse the write. These tests move the stored value the way it moves, by rendering
// again with a new one, and read what the box shows and whether it says it is saving.

const toast = vi.fn()

beforeEach(() => { toast.mockReset() })
afterEach(cleanup)

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

const WORDS = { success: 'Saved.', error: 'Could not save. Try again.' }

function setup(extra = {}) {
  const write = vi.fn(() => Promise.resolve())
  const wrapper = ({ children }) => <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
  const props = (stored) => ({ stored, write, ...WORDS, ...extra })
  const rig = renderHook((stored) => useSavedField(props(stored)), { initialProps: 'one', wrapper })
  const type = (text) => act(() => { rig.result.current.onChange({ target: { value: text } }) })
  const leave = () => act(async () => { rig.result.current.onBlur() })
  const stored = (value) => rig.rerender(value)
  return { ...rig, write, type, leave, stored }
}

describe('what the box shows', () => {
  it('is what is stored, until something is typed', () => {
    const { result } = setup()
    expect(result.current.value).toBe('one')
  })

  it('follows the stored value when it changes elsewhere and nothing was typed', () => {
    const { result, stored } = setup()
    stored('two')
    expect(result.current.value).toBe('two')
  })

  it('is what was typed, and stays what was typed when the stored value changes elsewhere', () => {
    const { result, type, stored } = setup()
    type('mine')
    stored('theirs')
    expect(result.current.value).toBe('mine')
  })

  it('shows an empty box for a value that is not stored yet', () => {
    const rig = renderHook(() => useSavedField({ stored: undefined, write: vi.fn(), ...WORDS }))
    expect(rig.result.current.value).toBe('')
  })
})

describe('leaving the box', () => {
  it('writes nothing when nothing was typed', async () => {
    const { write, leave } = setup()
    await leave()
    expect(write).not.toHaveBeenCalled()
  })

  it('writes what was typed, and says so', async () => {
    const { write, type, leave } = setup()
    type('two')
    await leave()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('two')
    expect(toast).toHaveBeenCalledWith({ tone: 'success', title: 'Saved.' })
  })

  it('writes nothing when what was typed is what is stored, and lets go of it', async () => {
    const { result, write, type, leave, stored } = setup()
    type('one')
    await leave()
    expect(write).not.toHaveBeenCalled()
    stored('two')
    expect(result.current.value).toBe('two')
  })

  it('compares and writes what normalize makes of the text', async () => {
    const { result, write, type, leave, stored } = setup({ normalize: (text) => text.trim() })
    type('  one  ')
    await leave()
    expect(write).not.toHaveBeenCalled()

    type('  two  ')
    await leave()
    expect(write).toHaveBeenCalledWith('two')
    stored('two')
    expect(result.current.value).toBe('two')
  })

  it('compares what was typed with what is stored as normalize makes of it, so stored spaces are not a difference', async () => {
    const wrapper = ({ children }) => <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
    const write = vi.fn(() => Promise.resolve())
    const rig = renderHook(() => useSavedField({ stored: '  one  ', normalize: (text) => text.trim(), write, ...WORDS }), { wrapper })
    act(() => { rig.result.current.onChange({ target: { value: 'one' } }) })
    await act(async () => { rig.result.current.onBlur() })
    expect(write).not.toHaveBeenCalled()
  })

  it('writes nothing when there is nowhere to write', async () => {
    const { write, type, leave } = setup({ enabled: false })
    type('two')
    await leave()
    expect(write).not.toHaveBeenCalled()
  })

  it('shows what is stored again once the write went through', async () => {
    const { result, type, leave, stored } = setup()
    type('two')
    await leave()
    stored('two')
    expect(result.current.value).toBe('two')
    stored('three')
    expect(result.current.value).toBe('three')
  })

  it('does not let go of text that was typed after the one that was written', async () => {
    const work = deferred()
    const rig = setup()
    rig.write.mockReturnValue(work.promise)
    rig.type('two')
    await rig.leave()
    rig.type('two and more')
    await act(async () => { work.resolve() })
    expect(rig.result.current.value).toBe('two and more')
    rig.write.mockResolvedValue()
    await rig.leave()
    expect(rig.write).toHaveBeenLastCalledWith('two and more')
  })
})

// The write goes to Firestore's cache at once, so the stored value is the new one while the
// server has not answered, and the old one again if the rules refuse it.
describe('a write that is out', () => {
  it('says saving from the moment the box was left until the server has answered, across the apply', async () => {
    const work = deferred()
    const { result, write, type, leave, stored } = setup()
    write.mockReturnValue(work.promise)
    type('two')
    await leave()
    expect(result.current.saving).toBe(true)

    stored('two')
    expect(result.current.saving).toBe(true)
    expect(result.current.value).toBe('two')

    await act(async () => { work.resolve() })
    expect(result.current.saving).toBe(false)
    expect(result.current.value).toBe('two')
  })

  it('keeps what was typed through the apply and the rollback of a refused write, and says why', async () => {
    const work = deferred()
    const { result, write, type, leave, stored } = setup()
    write.mockReturnValue(work.promise)
    type('two')
    await leave()

    stored('two')
    stored('one')
    await act(async () => { work.reject(refused()) })

    expect(result.current.value).toBe('two')
    expect(result.current.saving).toBe(false)
    expect(toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not save. Try again.',
      description: 'You do not have permission to do that.',
    })
  })

  it('keeps what was typed when the refusal arrives before the rollback', async () => {
    const work = deferred()
    const { result, write, type, leave, stored } = setup()
    write.mockReturnValue(work.promise)
    type('two')
    await leave()
    stored('two')

    await act(async () => { work.reject(refused()) })
    expect(result.current.value).toBe('two')
    stored('one')

    expect(result.current.value).toBe('two')
  })

  it('writes what was kept again when the box is left again, which is how it is tried again', async () => {
    const { result, write, type, leave, stored } = setup()
    write.mockRejectedValueOnce(refused()).mockResolvedValueOnce()
    type('two')
    await leave()
    expect(result.current.value).toBe('two')

    await leave()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('two')
    stored('two')
    expect(result.current.value).toBe('two')
  })

  it('writes nothing more when the box is left again with nothing new while the write is out, and still keeps the text if it is refused', async () => {
    const work = deferred()
    const { result, write, type, leave, stored } = setup()
    write.mockReturnValue(work.promise)
    type('two')
    await leave()
    stored('two')

    await leave()
    expect(write).toHaveBeenCalledTimes(1)

    stored('one')
    await act(async () => { work.reject(refused()) })
    expect(result.current.value).toBe('two')
  })

  it('writes the new text when the box is left again with something new while the write is out', async () => {
    const work = deferred()
    const { write, type, leave, stored } = setup()
    write.mockReturnValueOnce(work.promise).mockResolvedValue()
    type('two')
    await leave()
    stored('two')

    type('two and more')
    await leave()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('two and more')
    await act(async () => { work.resolve() })
  })
})

describe('when the box goes away', () => {
  it('writes nothing by default, as a box that saves only when it is left', () => {
    const { write, type, unmount } = setup()
    type('two')
    unmount()
    expect(write).not.toHaveBeenCalled()
  })

  it('writes what was typed through the same path, with the same words, when it asks to', async () => {
    const { write, type, unmount } = setup({ saveOnLeave: true })
    type('two')

    await act(async () => { unmount() })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('two')
    expect(toast).toHaveBeenCalledWith({ tone: 'success', title: 'Saved.' })
  })

  it('tells the person, with the reason, when that write is refused after the box has gone', async () => {
    const rig = setup({ saveOnLeave: true })
    rig.write.mockRejectedValue(refused())
    rig.type('two')

    await act(async () => { rig.unmount() })

    expect(toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not save. Try again.',
      description: 'You do not have permission to do that.',
    })
  })

  it('writes what was typed when the page is hidden, and the box goes on showing it', async () => {
    const { result, write, type, stored } = setup({ saveOnLeave: true })
    type('two')

    await act(async () => { window.dispatchEvent(new Event('pagehide')) })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('two')
    stored('two')
    expect(result.current.value).toBe('two')
  })

  it('writes nothing when nothing was typed, or what was typed is what is stored, or there is nowhere to write', async () => {
    const untouched = setup({ saveOnLeave: true })
    await act(async () => { untouched.unmount() })
    expect(untouched.write).not.toHaveBeenCalled()

    const unchanged = setup({ saveOnLeave: true })
    unchanged.type('one')
    await act(async () => { unchanged.unmount() })
    expect(unchanged.write).not.toHaveBeenCalled()

    const nowhere = setup({ saveOnLeave: true, enabled: false })
    nowhere.type('two')
    await act(async () => { nowhere.unmount() })
    expect(nowhere.write).not.toHaveBeenCalled()
  })

  it('writes nothing twice when the box is left and then goes away with the write already stored', async () => {
    const work = deferred()
    const { write, type, leave, stored, unmount } = setup({ saveOnLeave: true })
    write.mockReturnValue(work.promise)
    type('two')
    await leave()
    stored('two')

    await act(async () => { unmount() })

    expect(write).toHaveBeenCalledTimes(1)
    await act(async () => { work.resolve() })
  })

  it('writes the text of the latest render, not of the first', async () => {
    const { write, type, unmount } = setup({ saveOnLeave: true })
    type('a')
    type('ab')
    type('abc')

    await act(async () => { unmount() })

    expect(write).toHaveBeenCalledWith('abc')
  })

  it('stops listening for the page being hidden once the box has gone', async () => {
    const { write, type, unmount } = setup({ saveOnLeave: true })
    type('two')
    await act(async () => { unmount() })
    write.mockClear()

    await act(async () => { window.dispatchEvent(new Event('pagehide')) })

    expect(write).not.toHaveBeenCalled()
  })
})
