import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TableHeader, ResponsiveTable } from './lists'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // TableHeader renders <thead><tr> — needs a <table> wrapper to be valid HTML.
  act(() => {
    root.render(
      createElement(ResponsiveTable, null, createElement(TableHeader, props)),
    )
  })
  return {
    container,
    headers: () => Array.from(container.querySelectorAll('th')),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('TableHeader', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders one th per column', () => {
    h = mount({
      columns: [
        { key: 'job', label: 'Job' },
        { key: 'pm',  label: 'PM' },
      ],
    })
    expect(h.headers().length).toBe(2)
  })

  it('non-sortable column renders label as plain text', () => {
    h = mount({ columns: [{ key: 'x', label: 'Plain' }] })
    expect(h.headers()[0].textContent).toBe('Plain')
    expect(h.headers()[0].querySelector('button')).toBeFalsy()
  })

  it('sortable column renders a clickable button', () => {
    h = mount({
      columns: [{ key: 'job', label: 'Job', sortable: true }],
      sort: { field: null, direction: 'asc' },
      onSort: () => {},
    })
    expect(h.headers()[0].querySelector('button')).toBeTruthy()
  })

  it('marks the active sortable column with aria-sort', () => {
    h = mount({
      columns: [
        { key: 'job', label: 'Job', sortable: true },
        { key: 'pm',  label: 'PM',  sortable: true },
      ],
      sort: { field: 'job', direction: 'desc' },
      onSort: () => {},
    })
    const ths = h.headers()
    expect(ths[0].getAttribute('aria-sort')).toBe('descending')
    expect(ths[1].getAttribute('aria-sort')).toBe('none')
  })

  it('clicking a sortable header fires onSort with the column key', () => {
    let lastField = null
    h = mount({
      columns: [{ key: 'pm', label: 'PM', sortable: true }],
      sort: { field: null, direction: 'asc' },
      onSort: (field) => { lastField = field },
    })
    act(() => { h.headers()[0].querySelector('button').click() })
    expect(lastField).toBe('pm')
  })

  it('honors col.width as inline style', () => {
    h = mount({ columns: [{ key: 'x', label: 'X', width: '20%' }] })
    expect(h.headers()[0].style.width).toBe('20%')
  })

  it('applies sticky positioning by default', () => {
    h = mount({ columns: [{ key: 'x', label: 'X' }] })
    expect(h.headers()[0].className).toMatch(/sticky/)
  })
})
