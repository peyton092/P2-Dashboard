import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EmptyState, AllClearState, LoadingState, ErrorState } from './states'

function mount(El, props = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(El, props)) })
  return {
    container,
    text: () => container.textContent,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('EmptyState', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the default title', () => {
    h = mount(EmptyState, {})
    expect(h.text()).toMatch(/Nothing here yet/)
  })

  it('renders a custom title + description', () => {
    h = mount(EmptyState, { title: 'No items', description: 'Add the first one.' })
    expect(h.text()).toMatch(/No items/)
    expect(h.text()).toMatch(/Add the first one\./)
  })

  it('renders an action slot', () => {
    h = mount(EmptyState, {
      title: 'No items',
      action: createElement('button', { type: 'button', 'data-act': true }, 'Create'),
    })
    expect(h.container.querySelector('[data-act]')).toBeTruthy()
  })
})

describe('AllClearState', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the default title', () => {
    h = mount(AllClearState, {})
    expect(h.text()).toMatch(/All clear/)
  })

  it('renders a custom title', () => {
    h = mount(AllClearState, { title: 'Nothing to do', description: 'Take a break.' })
    expect(h.text()).toMatch(/Nothing to do/)
    expect(h.text()).toMatch(/Take a break\./)
  })
})

describe('LoadingState', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the default label', () => {
    h = mount(LoadingState, {})
    expect(h.text()).toMatch(/Loading…/)
  })

  it('renders a custom label', () => {
    h = mount(LoadingState, { label: 'Loading jobs…' })
    expect(h.text()).toMatch(/Loading jobs…/)
  })
})

describe('ErrorState', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders title + description defaults', () => {
    h = mount(ErrorState, {})
    expect(h.text()).toMatch(/Something went wrong/)
    expect(h.text()).toMatch(/Please try again/)
  })

  it('renders a retry button when onRetry is set, fires on click', () => {
    let clicked = 0
    h = mount(ErrorState, { onRetry: () => { clicked++ } })
    const retry = Array.from(h.container.querySelectorAll('button')).find(b => /Retry/i.test(b.textContent))
    expect(retry).toBeTruthy()
    act(() => { retry.click() })
    expect(clicked).toBe(1)
  })

  it('hides the retry button when onRetry is not set', () => {
    h = mount(ErrorState, {})
    const retry = Array.from(h.container.querySelectorAll('button')).find(b => /Retry/i.test(b.textContent))
    expect(retry).toBeFalsy()
  })
})
