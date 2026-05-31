import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveDot } from './badges'

function mount(props = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(LiveDot, props)) })
  return {
    container,
    label: () => container.querySelector('span > span:last-child')?.textContent,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('LiveDot', () => {
  let h
  const originalDesc = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')

  function setOnline(value) {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  }

  afterEach(() => {
    h?.unmount?.()
    if (originalDesc) Object.defineProperty(window.navigator, 'onLine', originalDesc)
  })

  it('renders "Live" when online', () => {
    setOnline(true)
    h = mount()
    expect(h.label()).toBe('Live')
  })

  it('renders "Offline" when offline at mount', () => {
    setOnline(false)
    h = mount()
    expect(h.label()).toBe('Offline')
  })

  it('switches to Offline on the offline event', () => {
    setOnline(true)
    h = mount()
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(h.label()).toBe('Offline')
  })

  it('switches back to Live on the online event', () => {
    setOnline(false)
    h = mount()
    expect(h.label()).toBe('Offline')
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(h.label()).toBe('Live')
  })

  it('honors custom liveLabel / offlineLabel', () => {
    setOnline(true)
    h = mount({ liveLabel: 'Connected', offlineLabel: 'Disconnected' })
    expect(h.label()).toBe('Connected')
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(h.label()).toBe('Disconnected')
  })
})
