import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ProgressBar } from './ProgressBar'

// React 19 wants this flag set so the act() warnings are silenced and
// updates flush synchronously inside act blocks.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
})
