import { describe, it, expect } from 'vitest'
import { safeHref } from './safeHref'

describe('safeHref', () => {
  it('passes http and https through', () => {
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('https://example.com/pay?x=1')).toBe('https://example.com/pay?x=1')
  })
  it('passes mailto and tel through', () => {
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(safeHref('tel:+16155551234')).toBe('tel:+16155551234')
  })
  it('passes root- and protocol-relative links through', () => {
    expect(safeHref('/docs/file.pdf')).toBe('/docs/file.pdf')
    expect(safeHref('//cdn.example.com/x.png')).toBe('//cdn.example.com/x.png')
  })
  it('blocks javascript: scheme', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('  JavaScript:alert(1)')).toBeUndefined()
  })
  it('blocks data: scheme', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
  })
  it('returns undefined for empty / non-string', () => {
    expect(safeHref('')).toBeUndefined()
    expect(safeHref('   ')).toBeUndefined()
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
    expect(safeHref(42)).toBeUndefined()
  })
  it('trims surrounding whitespace on safe URLs', () => {
    expect(safeHref('  https://example.com  ')).toBe('https://example.com')
  })
})
