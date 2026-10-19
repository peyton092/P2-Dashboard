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

// The rest of what the dark theme and the focus ring rest on in the stylesheet
// and the page, read as text so that an edit that breaks one fails here.

// The rules of the stylesheet that hold declarations directly, comments removed.
// A rule inside a media query or a layer is found on its own.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].trim(),
  body: match[2],
}))

// The property: value pairs inside one rule.
const declarationsIn = (body) =>
  Object.fromEntries(
    body.split(';').map((line) => line.trim()).filter(Boolean).map((line) => {
      const colon = line.indexOf(':')
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
    }),
  )

describe('the dark theme in the stylesheet', () => {
  const dark = declarationsIn(rules.find((rule) => rule.selector === '.dark')?.body ?? '')

  it('tells the browser the document is dark, so native controls and scrollbars follow', () => {
    expect(dark['color-scheme']).toBe('dark')
  })

  it('has four warm graphite surfaces, from the page up, at chroma 0.004 and hue 60', () => {
    const surfaces = ['--background', '--surface-1', '--surface-2', '--surface-3'].map((property) => dark[property])
    expect(surfaces).toEqual([
      'oklch(0.145 0.004 60)',
      'oklch(0.165 0.004 60)',
      'oklch(0.205 0.004 60)',
      'oklch(0.269 0.004 60)',
    ])
    const lightness = surfaces.map((value) => Number(/^oklch\(([\d.]+) /.exec(value)[1]))
    expect([...lightness].sort((a, b) => a - b), 'each surface sits above the one below').toEqual(lightness)
  })
})

describe('keyboard focus', () => {
  // :focus:not(:focus-visible) takes the ring off for the mouse; it is not a ring.
  const rings = rules.filter(({ selector, body }) =>
    selector.includes(':focus-visible') &&
    !selector.includes(':not(:focus-visible)') &&
    /(?:^|;)\s*outline\s*:\s*(?!none)/.test(body),
  )

  it('has exactly one focus-visible outline rule, so that no later rule can disagree with it', () => {
    expect(rings.map(({ selector }) => selector)).toHaveLength(1)
  })

  it('draws that ring in the brand color', () => {
    expect(declarationsIn(rings[0].body).outline).toBe('2px solid var(--brand)')
  })

  // A rule outside every layer beats every Tailwind utility, whatever its specificity, so a
  // control could not move the ring inside itself without the important modifier, and an
  // outline-none in a shadcn control did nothing while its own ring-3 drew a second ring. In
  // the base layer the rule is the default, and a utility on the control can change it.
  it('sits in the base layer, below the utilities', () => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // Each @layer base block, from its opening brace to the brace that closes it.
    const base = [...text.matchAll(/@layer\s+base\s*\{/g)].map((match) => {
      let depth = 0
      for (let i = match.index + match[0].length - 1; i < text.length; i++) {
        if (text[i] === '{') depth++
        if (text[i] === '}' && --depth === 0) return text.slice(match.index, i + 1)
      }
      return ''
    })
    expect(base.some((block) => block.includes(rings[0].selector)), `${rings[0].selector} is inside @layer base`).toBe(true)
  })
})

// The utilities a control could use against that one ring, read from the source. In the
// base layer the ring gives way to a utility, so a control that says outline-none hides it,
// and one that draws a ring of its own draws a second one.
describe('the controls and the one ring', () => {
  const sources = files
    .filter((file) => /\.(jsx?|css)$/.test(file) && !name(file).split('/').includes('__tests__'))
    .map((file) => ({ file: name(file), text: readFileSync(file, 'utf8') }))
  const hits = (pattern) =>
    sources.flatMap(({ file, text }) =>
      text.split('\n').flatMap((line, i) => [...line.matchAll(pattern)].map((match) => `${file}:${i + 1} ${match[0]}`)),
    )

  it('finds the controls it is meant to read', () => {
    for (const expected of ['components/ui/button-variants.js', 'components/ui/input.jsx', 'components/ui/tabs.jsx']) {
      expect(sources.map(({ file }) => file), expected).toContain(expected)
    }
  })

  it('never needs the important modifier to place the ring', () => {
    expect(hits(/(?<![\w-])focus(?:-visible)?:[\w/[\]().-]*!(?![=\w])/g)).toEqual([])
  })

  it('never draws a focus ring of its own beside the outline', () => {
    expect(hits(/(?<![\w-])focus(?:-visible)?:(?:ring|border-ring)(?:-[\w/[\]().]+)?/g)).toEqual([])
  })

  // An element that is not itself a control may turn the outline off: the dialog panel, which
  // takes focus only to hold it while the dialog opens, an option of a list, which shows that
  // it is highlighted by its fill, and the main landmark, which takes focus only from the skip
  // link, as a place to start from.
  const MAY_HIDE_THE_OUTLINE = {
    'components/ui/dialog.jsx': ['outline-none'],
    'components/ui/select.jsx': ['outline-hidden'],
    'components/shell/AppShell.jsx': ['outline-none'],
  }

  it('turns the outline off only on the elements that are not controls', () => {
    const found = {}
    for (const hit of hits(/(?<![\w-])(?:[\w-]+:)*outline-(?:none|hidden)(?![\w-])/g)) {
      const [where, utility] = hit.split(' ')
      const file = where.slice(0, where.lastIndexOf(':'))
      ;(found[file] ??= []).push(utility)
    }
    expect(found).toEqual(MAY_HIDE_THE_OUTLINE)
  })
})

describe('the page', () => {
  const page = readFileSync(resolve(srcDir, '..', 'index.html'), 'utf8')

  it('carries the dark class on the html element, so that portals on body are dark too', () => {
    expect(page).toMatch(/<html\b[^>]*\sclass="(?:[^"]*\s)?dark(?:\s[^"]*)?"/)
  })
})
