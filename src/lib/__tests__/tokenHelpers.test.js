import { describe, it, expect } from 'vitest'
import { BRAND, SEMANTIC, TONE_HEX, FONT, hexToRgb, withAlpha } from '../tokens'

describe('hexToRgb', () => {
  it('turns a six digit hex into red, green and blue', () => {
    expect(hexToRgb(SEMANTIC.success)).toEqual([34, 197, 94])
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })

  it('reads upper and lower case the same', () => {
    expect(hexToRgb(BRAND.toLowerCase())).toEqual(hexToRgb(BRAND.toUpperCase()))
  })

  it('expands a three digit hex', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#1a2')).toEqual([17, 170, 34])
  })

  it('gives the brand orange the numbers the PDF files used to spell out', () => {
    expect(hexToRgb(BRAND)).toEqual([244, 121, 32])
  })

  it.each(['', '#12', '#12345', '#1234567', '#ggg', 'abcdef', 'orange', 'rgb(1, 2, 3)', undefined, null, 42])(
    'refuses %j instead of guessing a color',
    (value) => {
      expect(() => hexToRgb(value)).toThrow(TypeError)
    },
  )
})

describe('withAlpha', () => {
  it('writes the color as rgba with the alpha given', () => {
    expect(withAlpha(SEMANTIC.success, 0.13)).toBe('rgba(34, 197, 94, 0.13)')
    expect(withAlpha(BRAND, 0.2)).toBe('rgba(244, 121, 32, 0.2)')
  })

  it('keeps both end points', () => {
    expect(withAlpha(SEMANTIC.critical, 0)).toBe('rgba(239, 68, 68, 0)')
    expect(withAlpha(SEMANTIC.critical, 1)).toBe('rgba(239, 68, 68, 1)')
  })

  it('accepts a three digit hex', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
  })

  it('gives undefined for anything that is not a hex color, so React leaves the style out', () => {
    for (const value of [undefined, null, '', 'orange', 'var(--brand)', 'rgba(1, 2, 3, 1)']) {
      expect(withAlpha(value, 0.13)).toBeUndefined()
    }
  })
})

describe('the exports', () => {
  it('name the seven semantic colors the design direction lists, each a six digit hex', () => {
    expect(Object.keys(SEMANTIC)).toEqual(['success', 'warning', 'critical', 'info', 'cyan', 'neutral', 'mute'])
    for (const hex of [BRAND, ...Object.values(SEMANTIC)]) expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('offer every tone by name, brand included', () => {
    expect(TONE_HEX).toEqual({ brand: BRAND, ...SEMANTIC })
  })

  it('name a display, body and mono family, each ending in a generic fallback', () => {
    expect(Object.keys(FONT).sort()).toEqual(['body', 'display', 'mono'])
    expect(FONT.display).toMatch(/^'Barlow Condensed',/)
    expect(FONT.body).toMatch(/^'Geist Variable',/)
    expect(FONT.mono).toMatch(/^'Geist Mono Variable',/)
    for (const family of Object.values(FONT)) expect(family).toMatch(/(sans-serif|monospace)$/)
  })
})
