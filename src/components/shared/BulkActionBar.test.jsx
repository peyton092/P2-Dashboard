import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { BulkActionBar } from './BulkActionBar'

function mount(props, child = null) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(BulkActionBar, props, child)) })
  return {
    container,
    region: container.querySelector('[role="region"]'),
    buttons: () => Array.from(container.querySelectorAll('button')),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('BulkActionBar', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the count + default suffix', () => {
    h = mount({ count: 3, onClear: () => {} })
    expect(h.region.textContent).toMatch(/3 selected/)
  })

  it('renders a custom suffix', () => {
    h = mount({ count: 7, countSuffix: 'items', onClear: () => {} })
    expect(h.region.textContent).toMatch(/7 items/)
  })

  it('renders children inside the region', () => {
    h = mount({ count: 1, onClear: () => {} }, createElement('button', { 'data-mine': true }, 'Custom'))
    expect(h.container.querySelector('[data-mine]')).toBeTruthy()
  })

  it('hides "Select all visible" link when fully selected', () => {
    h = mount({ count: 2, visibleIds: ['a', 'b'], onSelectAllVisible: () => {}, onClear: () => {} })
    const linkBtn = h.buttons().find(b => b.textContent.startsWith('Select all'))
    expect(linkBtn).toBeFalsy()
  })

  it('shows "Select all N visible" link when partial', () => {
    h = mount({ count: 1, visibleIds: ['a', 'b', 'c'], onSelectAllVisible: () => {}, onClear: () => {} })
    const linkBtn = h.buttons().find(b => b.textContent.startsWith('Select all'))
    expect(linkBtn?.textContent).toMatch(/Select all 3 visible/)
  })

  it('fires onSelectAllVisible when the link is clicked', () => {
    let clicked = false
    h = mount({ count: 1, visibleIds: ['a', 'b'], onSelectAllVisible: () => { clicked = true }, onClear: () => {} })
    const linkBtn = h.buttons().find(b => b.textContent.startsWith('Select all'))
    act(() => { linkBtn.click() })
    expect(clicked).toBe(true)
  })

  it('fires onClear when Clear is clicked', () => {
    let cleared = false
    h = mount({ count: 1, onClear: () => { cleared = true } })
    const clearBtn = h.buttons().find(b => b.textContent.includes('Clear'))
    act(() => { clearBtn.click() })
    expect(cleared).toBe(true)
  })

  it('disables children buttons when busy', () => {
    h = mount({ count: 1, busy: true, onClear: () => {} })
    const clearBtn = h.buttons().find(b => b.textContent.includes('Clear'))
    expect(clearBtn.disabled).toBe(true)
  })

  it('uses the provided ariaLabel', () => {
    h = mount({ count: 1, ariaLabel: 'Custom region label', onClear: () => {} })
    expect(h.region.getAttribute('aria-label')).toBe('Custom region label')
  })

  it('renders a busy spinner when busy=true', () => {
    h = mount({ count: 1, busy: true, onClear: () => {} })
    expect(h.container.querySelector('[aria-label="Working…"]')).toBeTruthy()
  })

  it('does not render the spinner when not busy', () => {
    h = mount({ count: 1, onClear: () => {} })
    expect(h.container.querySelector('[aria-label="Working…"]')).toBeFalsy()
  })
})
