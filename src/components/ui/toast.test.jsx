import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider, useToast } from './toast'

// Mount a probe component inside ToastProvider that exposes the toast
// function via a ref so tests can fire toasts and inspect the resulting
// DOM. Same pattern used by the dialog tests.
function mount() {
  const ref = { current: null }
  function Probe() {
    const t = useToast()
    useEffect(() => { ref.current = t }, [t])
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(ToastProvider, null, createElement(Probe)))
  })
  return {
    container,
    get current() { return ref.current },
    toasts: () => Array.from(document.querySelectorAll('[role="status"]')),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('ToastProvider', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders nothing until toast is fired', () => {
    h = mount()
    expect(h.toasts().length).toBe(0)
  })

  it('renders a toast with the given title', () => {
    h = mount()
    act(() => { h.current({ title: 'Saved!' }) })
    const ts = h.toasts()
    expect(ts.length).toBe(1)
    expect(ts[0].textContent).toMatch(/Saved!/)
  })

  it('accepts a string as a shorthand title', () => {
    h = mount()
    act(() => { h.current('Quick note') })
    expect(h.toasts()[0].textContent).toMatch(/Quick note/)
  })

  it('caps visible toasts at 4 — older ones drop off', () => {
    h = mount()
    act(() => {
      for (let i = 0; i < 6; i++) h.current({ title: `Toast ${i}`, duration: 0 })
    })
    expect(h.toasts().length).toBe(4)
    // The first two should have been dropped — the visible ones are 2..5.
    const text = h.toasts().map(t => t.textContent).join(' | ')
    expect(text).not.toMatch(/Toast 0/)
    expect(text).toMatch(/Toast 5/)
  })

  it('dismisses on close-button click', () => {
    h = mount()
    act(() => { h.current({ title: 'Dismiss me', duration: 0 }) })
    expect(h.toasts().length).toBe(1)
    const close = h.toasts()[0].querySelector('button[aria-label="Dismiss notification"]')
    act(() => { close.click() })
    expect(h.toasts().length).toBe(0)
  })

  it('auto-dismisses after the duration', async () => {
    vi.useFakeTimers()
    h = mount()
    act(() => { h.current({ title: 'Brief', duration: 100 }) })
    expect(h.toasts().length).toBe(1)
    act(() => { vi.advanceTimersByTime(200) })
    expect(h.toasts().length).toBe(0)
    vi.useRealTimers()
  })

  it('duration=0 means no auto-dismiss', async () => {
    vi.useFakeTimers()
    h = mount()
    act(() => { h.current({ title: 'Sticky', duration: 0 }) })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(h.toasts().length).toBe(1)
    vi.useRealTimers()
  })

  it('action button fires its callback and dismisses the toast', () => {
    h = mount()
    let undone = 0
    act(() => {
      h.current({
        title: 'Deleted',
        duration: 0,
        action: { label: 'Undo', onClick: () => { undone++ } },
      })
    })
    const undo = h.toasts()[0].querySelector('button')
    act(() => { undo.click() })
    expect(undone).toBe(1)
    expect(h.toasts().length).toBe(0)
  })
})
