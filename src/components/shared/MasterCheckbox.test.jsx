import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MasterCheckbox } from './MasterCheckbox'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(MasterCheckbox, props)) })
  return {
    el: container.querySelector('[role="checkbox"]'),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('MasterCheckbox', () => {
  let m
  beforeEach(() => { m?.unmount?.() })

  it('reports aria-checked=false when state is none', () => {
    m = mount({ state: 'none', onClick: () => {}, ariaLabel: 'Select all' })
    expect(m.el.getAttribute('aria-checked')).toBe('false')
  })

  it('reports aria-checked=true when state is all', () => {
    m = mount({ state: 'all', onClick: () => {}, ariaLabel: 'Select all' })
    expect(m.el.getAttribute('aria-checked')).toBe('true')
  })

  it('reports aria-checked=mixed for the partial state', () => {
    m = mount({ state: 'some', onClick: () => {}, ariaLabel: 'Select all' })
    expect(m.el.getAttribute('aria-checked')).toBe('mixed')
  })

  it('forwards the aria-label', () => {
    m = mount({ state: 'none', onClick: () => {}, ariaLabel: 'Select all rows' })
    expect(m.el.getAttribute('aria-label')).toBe('Select all rows')
  })

  it('fires onClick when clicked', () => {
    let clicks = 0
    m = mount({ state: 'none', onClick: () => { clicks++ }, ariaLabel: 'Select all' })
    act(() => { m.el.click() })
    expect(clicks).toBe(1)
  })
})
