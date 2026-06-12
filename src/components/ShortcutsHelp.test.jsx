import { describe, it, expect, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import ShortcutsHelp from './ShortcutsHelp'

function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(ShortcutsHelp)) })
  return {
    container,
    isOpen: () => Boolean(document.querySelector('[role="dialog"]')),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('ShortcutsHelp', () => {
  let h
  afterEach(() => { h?.unmount?.() })

  it('renders nothing until "?" is pressed', () => {
    h = mount()
    expect(h.isOpen()).toBe(false)
  })

  it('opens on "?" keypress outside an input', () => {
    h = mount()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
    })
    expect(h.isOpen()).toBe(true)
  })

  it('does not open when "?" is pressed inside an input', () => {
    h = mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
    })
    expect(h.isOpen()).toBe(false)
    input.remove()
  })

  it('closes on Escape', () => {
    h = mount()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) })
    expect(h.isOpen()).toBe(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(h.isOpen()).toBe(false)
  })

  it('renders the three section headings when open', () => {
    h = mount()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) })
    const text = document.querySelector('[role="dialog"]').textContent
    expect(text).toMatch(/Navigation/)
    expect(text).toMatch(/Inside dialogs/)
    expect(text).toMatch(/Inside the command palette/)
  })

  it('closes on close-button click', () => {
    h = mount()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) })
    const close = document.querySelector('[aria-label="Close shortcuts"]')
    expect(close).toBeTruthy()
    act(() => { close.click() })
    expect(h.isOpen()).toBe(false)
  })

  it('opens on the p2:open-shortcuts custom event', () => {
    h = mount()
    act(() => { window.dispatchEvent(new CustomEvent('p2:open-shortcuts')) })
    expect(h.isOpen()).toBe(true)
  })
})
