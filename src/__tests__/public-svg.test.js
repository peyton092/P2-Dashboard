import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The SVG files in public/ are served as they are and drawn with <img>, and a browser
// draws a broken image for an SVG that is not well formed XML, such as one with an &
// written bare instead of as &amp;. The logo and the mark were like that once, broken
// in the sidebar and the portal headers. Each SVG is parsed here as XML, as the browser
// parses it, with the DOMParser of the test environment.

const publicDir = resolve(import.meta.dirname, '../../public')
const svgs = readdirSync(publicDir, { recursive: true }).filter((file) => file.endsWith('.svg')).sort()

const parse = (text) => new DOMParser().parseFromString(text, 'image/svg+xml')

describe('the SVG files in public', () => {
  it('include the ones the app draws', () => {
    expect(svgs).toEqual(expect.arrayContaining(['favicon.svg', 'icons.svg', 'p2-logo.svg', 'p2-mark.svg']))
  })

  it.each(svgs)('%s is well formed XML', (file) => {
    const parsed = parse(readFileSync(join(publicDir, file), 'utf8'))
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(parsed.documentElement.localName).toBe('svg')
  })

  it('are checked by a parse that does catch a bare &', () => {
    const parsed = parse('<svg xmlns="http://www.w3.org/2000/svg" aria-label="Electrical & Mechanical"></svg>')
    expect(parsed.getElementsByTagName('parsererror').length).toBeGreaterThan(0)
  })
})
