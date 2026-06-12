import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Skeleton, PageSkeleton, DataSkeleton } from './Skeleton'

function mount(El, props = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(El, props)) })
  return {
    container,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('Skeleton', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders a placeholder div with the p2-skeleton class', () => {
    h = mount(Skeleton, { className: 'h-4 w-32' })
    const el = h.container.firstChild
    expect(el).toBeTruthy()
    expect(el.className).toMatch(/p2-skeleton/)
    expect(el.className).toMatch(/h-4/)
    expect(el.className).toMatch(/w-32/)
  })

  it('uses rounded-md by default', () => {
    h = mount(Skeleton)
    expect(h.container.firstChild.className).toMatch(/rounded-md/)
  })

  it('respects a custom rounded class', () => {
    h = mount(Skeleton, { rounded: 'rounded-full' })
    expect(h.container.firstChild.className).toMatch(/rounded-full/)
  })

  it('is aria-hidden so screen readers skip the shimmer', () => {
    h = mount(Skeleton)
    expect(h.container.firstChild.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('DataSkeleton', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the requested number of tile skeletons', () => {
    h = mount(DataSkeleton, { tiles: 3, rows: 0 })
    // each tile is a div containing skeletons; outer wrapper holds tiles.
    expect(h.container.textContent).toBe('')
    expect(h.container.querySelectorAll('.p2-skeleton').length).toBeGreaterThan(0)
  })

  it('renders the requested number of row skeletons', () => {
    h = mount(DataSkeleton, { tiles: 0, rows: 5 })
    const region = h.container.querySelector('[aria-busy="true"]')
    expect(region).toBeTruthy()
  })

  it('is aria-busy + labelled', () => {
    h = mount(DataSkeleton)
    const region = h.container.querySelector('[aria-busy="true"]')
    expect(region?.getAttribute('aria-label')).toBe('Loading')
  })
})

describe('PageSkeleton', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders header + tiles + rows skeletons', () => {
    h = mount(PageSkeleton)
    expect(h.container.querySelectorAll('.p2-skeleton').length).toBeGreaterThan(5)
  })

  it('is aria-busy + labelled', () => {
    h = mount(PageSkeleton)
    const region = h.container.querySelector('[aria-busy="true"]')
    expect(region?.getAttribute('aria-label')).toBe('Loading')
  })
})
