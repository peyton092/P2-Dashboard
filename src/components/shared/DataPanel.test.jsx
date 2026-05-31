import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import DataPanel from './DataPanel'

function mount(props, children = null) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(DataPanel, props, children)) })
  return {
    container,
    text: () => container.textContent,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('DataPanel', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders title in an h3', () => {
    h = mount({ title: 'Inspections' })
    expect(h.container.querySelector('h3')?.textContent).toBe('Inspections')
  })

  it('renders the description when provided', () => {
    h = mount({ title: 'X', description: '3 of 12 shown' })
    expect(h.text()).toMatch(/3 of 12 shown/)
  })

  it('renders the children inside the content area', () => {
    h = mount({ title: 'X' }, createElement('p', { 'data-body': true }, 'Hello body'))
    expect(h.container.querySelector('[data-body]')?.textContent).toBe('Hello body')
  })

  it('renders the actions slot', () => {
    h = mount({
      title: 'X',
      actions: createElement('button', { type: 'button', 'data-action': true }, 'Refresh'),
    })
    expect(h.container.querySelector('[data-action]')).toBeTruthy()
  })

  it('renders the footer slot', () => {
    h = mount({
      title: 'X',
      footer: createElement('span', { 'data-footer': true }, 'Last sync: 2m ago'),
    })
    expect(h.container.querySelector('[data-footer]')?.textContent).toBe('Last sync: 2m ago')
  })

  it('renders the badge slot next to the title', () => {
    h = mount({
      title: 'X',
      badge: createElement('span', { 'data-badge': true }, 'Beta'),
    })
    expect(h.container.querySelector('[data-badge]')?.textContent).toBe('Beta')
  })

  it('omits the header when title + actions are both missing', () => {
    h = mount({}, createElement('p', null, 'Only body'))
    expect(h.container.querySelector('header')).toBeFalsy()
  })

  it('flat tone uses transparent background class', () => {
    h = mount({ title: 'X', tone: 'flat' })
    const section = h.container.querySelector('section')
    expect(section.className).toMatch(/bg-transparent/)
  })

  it('elevated tone is the default', () => {
    h = mount({ title: 'X' })
    const section = h.container.querySelector('section')
    expect(section.className).toMatch(/bg-white/)
  })

  it('padding="none" removes inner padding', () => {
    h = mount({ title: 'X', padding: 'none' }, createElement('p', null, 'b'))
    const contentDiv = h.container.querySelector('section > div')
    expect(contentDiv.className).toMatch(/p-0/)
  })
})
