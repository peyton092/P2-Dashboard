import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useStickyState, _clearStickyKey } from './useStickyState'

// Lightweight harness — mount a component that exposes its [value, setValue]
// pair via refs so we can assert + drive updates without bringing in
// @testing-library/react just for this test file. Uses createElement to
// avoid needing JSX transform in the test runner.
function mount(useHook) {
  const ref = { current: null }
  function Probe() {
    const [v, setV] = useHook()
    ref.current = [v, setV]
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(Probe)) })
  return {
    get value() { return ref.current[0] },
    set(v) { act(() => { ref.current[1](v) }) },
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('useStickyState', () => {
  beforeEach(() => {
    _clearStickyKey('t1')
    _clearStickyKey('t2')
  })

  it('returns the initial value when storage is empty', () => {
    const h = mount(() => useStickyState('t1', 'first'))
    expect(h.value).toBe('first')
    h.unmount()
  })

  it('persists updates to localStorage', () => {
    const h = mount(() => useStickyState('t1', 'first'))
    h.set('second')
    expect(h.value).toBe('second')
    expect(localStorage.getItem('p2_sticky_t1')).toBe(JSON.stringify('second'))
    h.unmount()
  })

  it('hydrates from localStorage on remount', () => {
    localStorage.setItem('p2_sticky_t2', JSON.stringify({ filter: 'critical' }))
    const h = mount(() => useStickyState('t2', { filter: 'all' }))
    expect(h.value).toEqual({ filter: 'critical' })
    h.unmount()
  })

  it('round-trips objects / arrays / numbers', () => {
    const h = mount(() => useStickyState('t1', null))
    h.set({ a: 1, b: [2, 3] })
    expect(JSON.parse(localStorage.getItem('p2_sticky_t1'))).toEqual({ a: 1, b: [2, 3] })
    h.unmount()
  })

  it('accepts a lazy initial value', () => {
    let calls = 0
    const h = mount(() => useStickyState('t1', () => { calls++; return 'lazy' }))
    expect(h.value).toBe('lazy')
    expect(calls).toBe(1)
    h.unmount()
  })

  it('syncs across tabs via the storage event', () => {
    const h = mount(() => useStickyState('t1', 'start'))
    expect(h.value).toBe('start')
    // Simulate another tab writing the same key.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'p2_sticky_t1',
        newValue: JSON.stringify('from-other-tab'),
      }))
    })
    expect(h.value).toBe('from-other-tab')
    h.unmount()
  })

  it('ignores storage events for other keys', () => {
    const h = mount(() => useStickyState('t1', 'mine'))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'p2_sticky_other',
        newValue: JSON.stringify('not-mine'),
      }))
    })
    expect(h.value).toBe('mine')
    h.unmount()
  })
})
