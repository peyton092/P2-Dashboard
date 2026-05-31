import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JobCard } from './lists'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(JobCard, props)) })
  return {
    container,
    text: () => container.textContent,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('JobCard', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the job id + name', () => {
    h = mount({ job: { id: 'J1', name: 'Maple Build', status: 'on-track' } })
    expect(h.text()).toMatch(/J1/)
    expect(h.text()).toMatch(/Maple Build/)
  })

  it('renders client first word when name missing', () => {
    h = mount({ job: { id: 'J1', client: 'Acme Holdings LLC' } })
    expect(h.text()).toMatch(/Acme/)
  })

  it('falls back to id when name + client missing', () => {
    h = mount({ job: { id: 'J1' } })
    expect(h.text()).toMatch(/J1/)
  })

  it('renders pmLabel + meta + footer slots', () => {
    h = mount({
      job: { id: 'J1', name: 'X' },
      pmLabel: 'PM Blake',
      meta: createElement('p', null, 'Meta line'),
      footer: createElement('p', null, 'Footer'),
    })
    expect(h.text()).toMatch(/PM Blake/)
    expect(h.text()).toMatch(/Meta line/)
    expect(h.text()).toMatch(/Footer/)
  })

  it('renders as a button when onClick is provided', () => {
    h = mount({ job: { id: 'J1', name: 'X' }, onClick: () => {} })
    expect(h.container.querySelector('button')).toBeTruthy()
  })

  it('renders as a non-interactive div by default', () => {
    h = mount({ job: { id: 'J1', name: 'X' } })
    expect(h.container.querySelector('button')).toBeFalsy()
    expect(h.container.querySelector('div')).toBeTruthy()
  })

  it('fires onClick when clicked', () => {
    let clicks = 0
    h = mount({ job: { id: 'J1', name: 'X' }, onClick: () => { clicks++ } })
    act(() => { h.container.querySelector('button').click() })
    expect(clicks).toBe(1)
  })

  it('renders the status badge from job.status when not overridden', () => {
    h = mount({ job: { id: 'J1', name: 'X', status: 'on-track' } })
    expect(h.text()).toMatch(/On Track/)
  })

  it('uses an explicit status prop over job.status', () => {
    h = mount({ job: { id: 'J1', name: 'X', status: 'active' }, status: 'blocked' })
    expect(h.text()).toMatch(/Blocked/)
  })
})
