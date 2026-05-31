import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from './toast'
import { ServiceWorkerUpdateNotifier } from './ServiceWorkerUpdateNotifier'

// Toast capture probe — read the toast queue out of the DOM so we can assert
// the update notifier actually fired one.
function getToasts() {
  return Array.from(document.querySelectorAll('[role="status"]'))
}

function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(ToastProvider, null,
        createElement(ServiceWorkerUpdateNotifier),
      ),
    )
  })
  return {
    container,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('ServiceWorkerUpdateNotifier', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders nothing on mount', () => {
    h = mount()
    expect(getToasts().length).toBe(0)
  })

  it('shows a toast when p2:sw-update fires', () => {
    h = mount()
    act(() => { window.dispatchEvent(new CustomEvent('p2:sw-update')) })
    const toasts = getToasts()
    expect(toasts.length).toBe(1)
    expect(toasts[0].textContent).toMatch(/New version available/)
    expect(toasts[0].textContent).toMatch(/Reload/)
  })

  it('only fires once per session', () => {
    h = mount()
    act(() => {
      window.dispatchEvent(new CustomEvent('p2:sw-update'))
      window.dispatchEvent(new CustomEvent('p2:sw-update'))
      window.dispatchEvent(new CustomEvent('p2:sw-update'))
    })
    expect(getToasts().length).toBe(1)
  })
})
