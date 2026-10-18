import { describe, it, expect } from 'vitest'
import { safeHttpUrl } from '../safeUrl'

describe('safeHttpUrl', () => {
  it('rejects javascript: URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
  })
  it('rejects http URLs', () => {
    expect(safeHttpUrl('http://example.com/a')).toBeNull()
  })
  it('accepts https and returns the normalized href', () => {
    expect(safeHttpUrl('https://example.com')).toBe('https://example.com/')
    expect(safeHttpUrl('https://example.com/pay?id=1')).toBe('https://example.com/pay?id=1')
  })
  it('rejects URLs carrying credentials', () => {
    expect(safeHttpUrl('https://user:pw@host/x')).toBeNull()
    expect(safeHttpUrl('https://user@host/x')).toBeNull()
  })
  it('rejects unparseable strings', () => {
    expect(safeHttpUrl('not a url')).toBeNull()
    expect(safeHttpUrl('')).toBeNull()
  })
  it('rejects non strings', () => {
    expect(safeHttpUrl(null)).toBeNull()
    expect(safeHttpUrl(undefined)).toBeNull()
    expect(safeHttpUrl(42)).toBeNull()
    expect(safeHttpUrl({ href: 'https://example.com' })).toBeNull()
  })
})
