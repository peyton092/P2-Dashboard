import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ProgressBar } from './ProgressBar'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(ProgressBar, props)) })
  return {
    container,
    fill: () => container.firstChild.firstChild,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('ProgressBar', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the fill at the given percent', () => {
    h = mount({ value: 42 })
    expect(h.fill().style.width).toBe('42%')
  })

  it('clamps values above 100', () => {
    h = mount({ value: 250 })
    expect(h.fill().style.width).toBe('100%')
  })

  it('clamps negatives to 0', () => {
    h = mount({ value: -10 })
    expect(h.fill().style.width).toBe('0%')
  })

  it('respects a custom color', () => {
    h = mount({ value: 50, color: '#22c55e' })
    expect(h.fill().style.backgroundColor).toBe('rgb(34, 197, 94)')
  })

  it('sets role=progressbar with aria-valuenow / min / max', () => {
    h = mount({ value: 42 })
    const el = h.container.firstChild
    expect(el.getAttribute('role')).toBe('progressbar')
    expect(el.getAttribute('aria-valuenow')).toBe('42')
    expect(el.getAttribute('aria-valuemin')).toBe('0')
    expect(el.getAttribute('aria-valuemax')).toBe('100')
  })

  it('rounds aria-valuenow', () => {
    h = mount({ value: 33.7 })
    expect(h.container.firstChild.getAttribute('aria-valuenow')).toBe('34')
  })

  it('passes label as aria-label when provided', () => {
    h = mount({ value: 50, label: 'Job progress' })
    expect(h.container.firstChild.getAttribute('aria-label')).toBe('Job progress')
  })
})
