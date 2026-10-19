import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toLocalDateStr } from '@/lib/dates'
import { useNow } from '../useNow'

// Every test here runs on fake timers, and the clock is set by the test, so none of
// them waits for real time or for an animation frame. A tick is a call to
// advanceTimersByTime inside act. A tab coming back is a visibilitychange event.
const MINUTE = 60_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 18, 8, 0, 0))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete document.visibilityState
})

const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })

// jsdom reports a tab as visible. This makes it hidden or visible, and tells the
// listeners, as a browser does when the person switches tabs.
function showTab(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('useNow', () => {
  it('starts as the time it renders', () => {
    const { result } = renderHook(() => useNow())

    expect(result.current).toBeInstanceOf(Date)
    expect(result.current.getTime()).toBe(new Date(2026, 9, 18, 8, 0, 0).getTime())
  })

  it('moves on to a new Date after a minute', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current

    tick(MINUTE)

    expect(result.current).not.toBe(first)
    expect(result.current.getTime()).toBe(first.getTime() + MINUTE)
  })

  it('keeps the same Date until the minute is up', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current

    tick(MINUTE - 1)

    expect(result.current).toBe(first)
  })

  it('keeps moving, a minute at a time', () => {
    const { result } = renderHook(() => useNow())

    tick(MINUTE)
    tick(MINUTE)
    tick(MINUTE)

    expect(result.current.getTime()).toBe(new Date(2026, 9, 18, 8, 3, 0).getTime())
  })

  it('moves on to the next day when a tab is left open across midnight', () => {
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 30))
    const { result } = renderHook(() => useNow())
    expect(toLocalDateStr(result.current)).toBe('2026-10-18')

    tick(MINUTE)

    expect(toLocalDateStr(result.current)).toBe('2026-10-19')
  })

  it('ticks at the interval it is given', () => {
    const { result } = renderHook(() => useNow(1000))
    const first = result.current

    tick(999)
    expect(result.current).toBe(first)

    tick(1)
    expect(result.current.getTime()).toBe(first.getTime() + 1000)
  })

  it('moves to a new interval when the interval changes, and does not leave the old timer running', () => {
    const { result, rerender } = renderHook(({ every }) => useNow(every), { initialProps: { every: MINUTE } })
    expect(vi.getTimerCount()).toBe(1)

    rerender({ every: 1000 })
    expect(vi.getTimerCount()).toBe(1)

    const before = result.current
    tick(1000)
    expect(result.current.getTime()).toBe(before.getTime() + 1000)
  })

  it('catches up the moment the tab becomes visible, without waiting for the next tick', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current

    // The laptop slept through the night. No timer ran, and the clock moved on.
    vi.setSystemTime(new Date(2026, 9, 19, 7, 30, 0))
    expect(result.current).toBe(first)

    showTab('visible')

    expect(result.current.getTime()).toBe(new Date(2026, 9, 19, 7, 30, 0).getTime())
    expect(toLocalDateStr(result.current)).toBe('2026-10-19')
  })

  it('does not update when the tab goes to the background', () => {
    const { result } = renderHook(() => useNow())
    const first = result.current
    vi.setSystemTime(new Date(2026, 9, 19, 7, 30, 0))

    showTab('hidden')

    expect(result.current).toBe(first)
  })

  it('stops its timer and its listener when the component goes away', () => {
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useNow())
    const [, listener] = added.mock.calls.find(([type]) => type === 'visibilitychange')
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    expect(removed).toHaveBeenCalledWith('visibilitychange', listener)
  })
})
