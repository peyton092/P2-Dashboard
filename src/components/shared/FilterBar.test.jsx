import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FilterBar } from './lists'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(FilterBar, props)) })
  return {
    container,
    input: () => container.querySelector('input[type="text"]'),
    // Chip buttons are inside a wrapper with the flex-wrap class. Use a wide
    // selector and exclude the search-clear × button.
    chips: () => Array.from(container.querySelectorAll('button'))
      .filter(b => b.getAttribute('aria-label') !== 'Clear search'
        && !b.hasAttribute('data-trail')),
    clearBtn: () => container.querySelector('button[aria-label="Clear search"]'),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('FilterBar', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders nothing when no search or chips', () => {
    h = mount({})
    expect(h.container.querySelector('input')).toBeFalsy()
    expect(h.chips().length).toBe(0)
  })

  it('renders the search input when search + onSearchChange are passed', () => {
    h = mount({ search: '', onSearchChange: () => {}, searchPlaceholder: 'Search jobs…' })
    expect(h.input()).toBeTruthy()
    expect(h.input().placeholder).toBe('Search jobs…')
  })

  it('hides the clear-search × when input is empty', () => {
    h = mount({ search: '', onSearchChange: () => {} })
    expect(h.clearBtn()).toBeFalsy()
  })

  it('shows the clear-search × when input has text', () => {
    h = mount({ search: 'hello', onSearchChange: () => {} })
    expect(h.clearBtn()).toBeTruthy()
  })

  it('clicking × fires onSearchChange with an empty string', () => {
    let lastVal = 'unchanged'
    h = mount({ search: 'hello', onSearchChange: (v) => { lastVal = v } })
    act(() => { h.clearBtn().click() })
    expect(lastVal).toBe('')
  })

  it('typing fires onSearchChange with the new value', () => {
    let lastVal = ''
    h = mount({ search: '', onSearchChange: (v) => { lastVal = v } })
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => {
      setter.call(h.input(), 'taco')
      h.input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(lastVal).toBe('taco')
  })

  it('renders each chip with the right pressed state', () => {
    h = mount({
      chips: [
        { value: 'all',      label: 'All',      active: true,  onClick: () => {} },
        { value: 'critical', label: 'Critical', active: false, onClick: () => {} },
      ],
    })
    const chips = h.chips()
    expect(chips.length).toBe(2)
    expect(chips[0].getAttribute('aria-pressed')).toBe('true')
    expect(chips[1].getAttribute('aria-pressed')).toBeNull()
  })

  it('chip click fires onClick', () => {
    let clicked = ''
    h = mount({
      chips: [
        { value: 'a', label: 'A', active: false, onClick: () => { clicked = 'A' } },
      ],
    })
    act(() => { h.chips()[0].click() })
    expect(clicked).toBe('A')
  })

  it('renders chip count badges when count > 0', () => {
    h = mount({
      chips: [{ value: 'x', label: 'Open', count: 5, active: false, onClick: () => {} }],
    })
    expect(h.chips()[0].textContent).toMatch(/Open.*5/)
  })

  it('renders the trailing slot', () => {
    h = mount({
      chips: [{ value: 'x', label: 'X', active: false, onClick: () => {} }],
      trailing: createElement('button', { type: 'button', 'data-trail': true }, 'Trail'),
    })
    expect(h.container.querySelector('[data-trail]')).toBeTruthy()
  })
})
