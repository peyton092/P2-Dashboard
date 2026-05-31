import { describe, it, expect, beforeEach, vi } from 'vitest'
import { exportToCsv } from './exportCsv'

let lastBlobText = ''

beforeEach(() => {
  lastBlobText = ''
  // Capture the CSV text by stubbing Blob to remember its parts.
  globalThis.Blob = function Blob(parts) { lastBlobText = parts.join('') } /* eslint-disable-line no-global-assign */
  globalThis.URL.createObjectURL = vi.fn(() => 'blob://stub')
  globalThis.URL.revokeObjectURL = vi.fn()
  // jsdom provides document.createElement; we also need .click() to no-op.
  const a = { click: vi.fn(), href: '', download: '' }
  vi.spyOn(document, 'createElement').mockReturnValue(a)
  vi.spyOn(document.body, 'appendChild').mockReturnValue(a)
  vi.spyOn(document.body, 'removeChild').mockReturnValue(a)
})

describe('exportToCsv', () => {
  it('emits header + rows', () => {
    exportToCsv('demo', [
      { label: 'Name', key: 'name' },
      { label: 'Age',  get: r => r.age },
    ], [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }])

    expect(lastBlobText).toContain('Name,Age')
    expect(lastBlobText).toContain('Alice,30')
    expect(lastBlobText).toContain('Bob,25')
  })

  it('escapes commas, quotes and newlines', () => {
    exportToCsv('demo', [
      { label: 'A', key: 'a' },
      { label: 'B', key: 'b' },
    ], [{ a: 'hello, world', b: 'she said "hi"' }, { a: 'multi\nline', b: 'ok' }])

    expect(lastBlobText).toContain('"hello, world"')
    expect(lastBlobText).toContain('"she said ""hi"""')
    expect(lastBlobText).toContain('"multi\nline"')
  })

  it('handles missing / null values gracefully', () => {
    exportToCsv('demo', [
      { label: 'X', key: 'x' },
    ], [{ x: null }, { x: undefined }, {}])
    // 3 rows after the header — empty cells just yield empty fields.
    const lines = lastBlobText.split('\r\n')
    expect(lines.length).toBe(4)
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('')
  })
})
