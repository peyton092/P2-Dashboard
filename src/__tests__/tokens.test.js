import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { BRAND, SEMANTIC, FONT } from '@/lib/tokens'

// The brand orange has one home, src/lib/tokens.js, and one CSS twin in
// src/index.css. Every screen imports the constant instead of declaring its
// own copy, so a change to the brand color is one edit. These guards keep the
// copies from coming back. They look for the exported value rather than a
// spelled out one, and the old constant's needle is built from pieces, so that
// this file does not match itself.
const srcDir = resolve(import.meta.dirname, '..')

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

const files = filesUnder(srcDir)
const name = (file) => relative(srcDir, file).split('\\').join('/')
const whereFound = (found, except = []) =>
  files.filter((file) => !except.includes(name(file)) && found(readFileSync(file, 'utf8'))).map(name)

describe('the brand orange', () => {
  it('finds the source files it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(100)
    for (const expected of ['App.jsx', 'index.css', 'components/shared/badges.jsx']) {
      expect(files.map(name), expected).toContain(expected)
    }
  })

  it('is written out only in tokens.js and index.css', () => {
    const hex = BRAND.toLowerCase()
    expect(whereFound((text) => text.toLowerCase().includes(hex), ['lib/tokens.js', 'index.css'])).toEqual([])
  })

  it('is never declared again as a local constant', () => {
    const local = 'const ' + 'O ='
    expect(whereFound((text) => text.includes(local))).toEqual([])
  })
})

// index.css declares the same values as custom properties so that Tailwind
// utilities and plain CSS can use them. JavaScript reads them from tokens.js.
// If the two ever disagree, a bg-brand button and a chart drawn from BRAND
// would be two different oranges.
const css = readFileSync(join(srcDir, 'index.css'), 'utf8')

// Every value index.css gives a custom property, wherever it is declared.
const declared = (property) =>
  [...css.matchAll(new RegExp(`(?<![\\w-])${property}:\\s*([^;]+);`, 'g'))].map((match) => match[1].trim())

describe('the CSS tokens', () => {
  it.each([
    ['--brand', BRAND],
    ...Object.entries(SEMANTIC).map(([tone, hex]) => [`--${tone}`, hex]),
  ])('declare %s as the value tokens.js exports', (property, hex) => {
    const values = declared(property)
    expect(values.length, `${property} is declared in index.css`).toBeGreaterThan(0)
    for (const value of values) expect(value.toLowerCase()).toBe(hex.toLowerCase())
  })

  it.each([
    ['--font-display', FONT.display],
    ['--font-sans', FONT.body],
    ['--font-mono', FONT.mono],
  ])('declare %s as the family list tokens.js exports', (property, family) => {
    const values = declared(property)
    expect(values.length, `${property} is declared in index.css`).toBeGreaterThan(0)
    for (const value of values) expect(value).toBe(family)
  })
})
