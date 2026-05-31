import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PageHeader, SectionHeader } from './headers'

// Mock IntersectionObserver since jsdom doesn't provide one. PageHeader uses
// it for the sticky compact strip — we don't need the strip to fire in tests,
// just need the mount to not throw.
beforeEach(() => {
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
})

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

describe('PageHeader', () => {
  let h
  afterEach(() => { h?.unmount?.() })

  it('renders the title in an h1', () => {
    h = mount(PageHeader, { title: 'Cash control' })
    const h1 = h.container.querySelector('h1')
    expect(h1?.textContent).toBe('Cash control')
  })

  it('renders the eyebrow when present', () => {
    h = mount(PageHeader, { eyebrow: 'Billing', title: 'Cash control' })
    expect(h.text()).toMatch(/Billing/)
  })

  it('renders the subtitle when present', () => {
    h = mount(PageHeader, { title: 'X', subtitle: 'A short description.' })
    expect(h.text()).toMatch(/A short description\./)
  })

  it('renders the meta slot', () => {
    h = mount(PageHeader, { title: 'X', meta: createElement('span', { 'data-meta': true }, '42 items') })
    expect(h.container.querySelector('[data-meta]')?.textContent).toBe('42 items')
  })

  it('renders the actions slot', () => {
    h = mount(PageHeader, {
      title: 'X',
      actions: createElement('button', { type: 'button', 'data-action': true }, 'Export'),
    })
    expect(h.container.querySelector('[data-action]')?.textContent).toBe('Export')
  })

  it('also renders title in the sticky compact strip (twice in DOM)', () => {
    h = mount(PageHeader, { title: 'Cash control' })
    const matches = Array.from(h.container.querySelectorAll('span, h1')).filter(el => el.textContent === 'Cash control')
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('SectionHeader', () => {
  let h
  afterEach(() => { h?.unmount?.() })

  it('renders the title in an h2', () => {
    h = mount(SectionHeader, { title: 'Recent activity' })
    expect(h.container.querySelector('h2')?.textContent).toBe('Recent activity')
  })

  it('renders a numeric count as a chip', () => {
    h = mount(SectionHeader, { title: 'Open', count: 3 })
    expect(h.text()).toMatch(/3/)
  })

  it('hides the count chip when undefined', () => {
    h = mount(SectionHeader, { title: 'Open' })
    expect(h.text()).toBe('Open')
  })

  it('renders the actions slot', () => {
    h = mount(SectionHeader, {
      title: 'X',
      actions: createElement('button', { type: 'button', 'data-action': true }, 'More'),
    })
    expect(h.container.querySelector('[data-action]')).toBeTruthy()
  })
})
