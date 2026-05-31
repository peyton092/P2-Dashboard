import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import MetricTile from './MetricTile'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(MetricTile, props)) })
  return {
    container,
    root,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('MetricTile', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders label + value', () => {
    h = mount({ label: 'Open', value: 12 })
    expect(h.container.textContent).toMatch(/Open/)
    expect(h.container.textContent).toMatch(/12/)
  })

  it('renders an optional sub line', () => {
    h = mount({ label: 'Open', value: 12, sub: '4 critical' })
    expect(h.container.textContent).toMatch(/4 critical/)
  })

  it('renders a trend pill when trendLabel is set', () => {
    h = mount({ label: 'Revenue', value: '$120k', trend: 'up', trendLabel: '+8% MoM' })
    expect(h.container.textContent).toMatch(/\+8% MoM/)
  })

  it('renders as <button> when onClick is provided', () => {
    h = mount({ label: 'X', value: 1, onClick: () => {} })
    expect(h.container.querySelector('button')).toBeTruthy()
  })

  it('renders as a non-interactive <div> by default', () => {
    h = mount({ label: 'X', value: 1 })
    expect(h.container.querySelector('button')).toBeFalsy()
    expect(h.container.querySelector('div')).toBeTruthy()
  })

  it('fires onClick when clicked', () => {
    let clicks = 0
    h = mount({ label: 'X', value: 1, onClick: () => { clicks++ } })
    act(() => { h.container.querySelector('button').click() })
    expect(clicks).toBe(1)
  })

  it('applies emphasis color to the value', () => {
    h = mount({ label: 'Risk', value: 5, emphasis: 'critical' })
    const valueEl = h.container.querySelector('p.text-\\[26px\\]') ||
                    Array.from(h.container.querySelectorAll('p')).find(p => p.textContent === '5')
    expect(valueEl.style.color).toBe('rgb(239, 68, 68)') // #ef4444
  })
})
