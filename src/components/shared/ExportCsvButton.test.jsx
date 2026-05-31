import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ExportCsvButton } from './ExportCsvButton'

// jsdom doesn't navigate when an <a> with download fires, but we still need
// to capture the resulting blob and trigger event so we know exportToCsv ran.
let lastBlobText = ''
let anchorClick

beforeEach(() => {
  lastBlobText = ''
  globalThis.Blob = function Blob(parts) { lastBlobText = parts.join('') }
  globalThis.URL.createObjectURL = vi.fn(() => 'blob://stub')
  globalThis.URL.revokeObjectURL = vi.fn()
  anchorClick = vi.fn()
  HTMLAnchorElement.prototype.click = anchorClick
})

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(ExportCsvButton, props)) })
  return {
    button: container.querySelector('button'),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('ExportCsvButton', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders an Export button by default', () => {
    h = mount({ filename: 'x', columns: [{ label: 'A', key: 'a' }], rows: [{ a: 1 }] })
    expect(h.button).toBeTruthy()
    expect(h.button.textContent).toMatch(/Export/)
  })

  it('honors a custom label', () => {
    h = mount({ filename: 'x', columns: [{ label: 'A', key: 'a' }], rows: [{ a: 1 }], label: 'Export CSV' })
    expect(h.button.textContent).toMatch(/Export CSV/)
  })

  it('disables when rows is empty', () => {
    h = mount({ filename: 'x', columns: [], rows: [] })
    expect(h.button.disabled).toBe(true)
  })

  it('disables when rows is undefined', () => {
    h = mount({ filename: 'x', columns: [] })
    expect(h.button.disabled).toBe(true)
  })

  it('enabled with non-empty rows', () => {
    h = mount({ filename: 'x', columns: [{ label: 'A', key: 'a' }], rows: [{ a: 1 }] })
    expect(h.button.disabled).toBe(false)
  })

  it('calling onClick generates a CSV blob and triggers anchor download', () => {
    h = mount({ filename: 'demo', columns: [
      { label: 'A', key: 'a' },
      { label: 'B', key: 'b' },
    ], rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }] })
    act(() => { h.button.click() })
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(lastBlobText).toContain('A,B')
    expect(lastBlobText).toContain('1,2')
    expect(lastBlobText).toContain('3,4')
  })

  it('passes title attribute through', () => {
    h = mount({ filename: 'x', columns: [], rows: [{ a: 1 }], title: 'Tooltip text' })
    expect(h.button.getAttribute('title')).toBe('Tooltip text')
  })
})
