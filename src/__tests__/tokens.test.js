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

  // The one rule that turns the outline off is for a focus that came from a pointer.
  it('turns the outline off in the stylesheet only for a focus from a pointer', () => {
    const off = rules.filter(({ body }) => {
      const declarations = declarationsIn(body)
      return ['outline', 'outline-style', 'outline-width', 'outline-color'].some((property) =>
        /^(?:none|hidden|0|0px|transparent)(?![\w-])/.test(declarations[property] ?? ''))
    })
    expect(off.map(({ selector }) => selector)).toEqual([':focus:not(:focus-visible)'])
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

// The class names on a line of source, each split into its variants and its utility. Tailwind
// takes the important modifier at the end of the utility or at its start, so it is taken off
// either end and noted, and a leading one on the variants, which Tailwind would not build, is
// noted as well. A colon inside the brackets of an arbitrary variant or value does not split
// a name, and the punctuation of the code around a name is not part of it.
function classNames(line) {
  return line.split(/[\s'"`;]+/).flatMap((word) => {
    const token = word.replace(/^[({$]+/, '').replace(/[,)}]+$/, '')
    if (!token) return []
    const parts = []
    let depth = 0
    let from = 0
    for (let i = 0; i < token.length; i++) {
      if (token[i] === '[') depth++
      else if (token[i] === ']') depth--
      else if (token[i] === ':' && depth === 0) {
        parts.push(token.slice(from, i))
        from = i + 1
      }
    }
    const variants = parts.map((variant) => variant.replace(/^!/, ''))
    const written = token.slice(from)
    const utility = written.replace(/^!|!$/g, '')
    return [{
      token,
      variants,
      utility,
      important: utility !== written || parts.some((variant) => variant.startsWith('!')),
      // Focus in any of its forms: focus, focus-visible and focus-within, and each of them
      // through a group, a peer, has, in, or an arbitrary variant.
      onFocus: variants.some((variant) => variant.includes('focus')),
    }]
  })
}

// What a control could write against that one ring. In the base layer the ring gives way to
// a utility, so a control that turns the outline off hides it, one that draws a ring or a
// shadow of its own on focus draws a second one, and one that needs the important modifier
// to place the ring is fighting a rule it should not have to.
const GUARDS = {
  important: (line) => classNames(line).filter((c) => c.onFocus && c.important).map((c) => c.token),
  ownRing: (line) =>
    classNames(line)
      .filter((c) => c.onFocus && /^-?(?:ring|inset-ring|border-ring|shadow|inset-shadow)(?:-|$)/.test(c.utility))
      .map((c) => c.token),
  outlineOff: (line) =>
    classNames(line)
      .filter((c) =>
        /^outline-(?:none|hidden|0|transparent)$/.test(c.utility) ||
        /^outline-\[(?:0|0px|none|transparent)\]$/.test(c.utility) ||
        /^\[outline(?:-style|-width|-color)?:(?:none|hidden|0|0px|transparent)\]$/.test(c.utility))
      .map((c) => c.token),
  // A style written in the code: an inline style object, or a property set on an element.
  inlineOutlineOff: (line) =>
    [...line.matchAll(/(?:\boutline(?:Style|Width|Color)?\s*:|\.style\.outline(?:Style|Width|Color)?\s*=)\s*['"`]?\s*(?:none|0(?:px)?|transparent|hidden)(?![\w-])/g)]
      .map((match) => match[0]),
}

describe('the guards of the one ring', () => {
  it.each([
    ['important', 'focus-visible:-outline-offset-2!'],
    ['important', 'focus-visible:!-outline-offset-2'],
    ['important', 'focus-visible:!outline-offset-4'],
    ['important', '!focus:outline-offset-4'],
    ['important', 'group-focus-visible:outline-offset-4!'],
    ['ownRing', 'focus:ring-2'],
    ['ownRing', 'focus-visible:ring-3 focus-visible:ring-ring/50'],
    ['ownRing', 'focus-visible:border-ring'],
    ['ownRing', 'focus-visible:shadow-[0_0_0_2px_white]'],
    ['ownRing', 'focus:shadow-md'],
    ['ownRing', 'focus-visible:inset-ring-2'],
    ['ownRing', 'group-focus:ring-2'],
    ['ownRing', 'group-focus-visible/row:ring-2'],
    ['ownRing', 'peer-focus-visible:ring-2'],
    ['ownRing', 'has-focus-visible:ring-2'],
    ['ownRing', 'has-[:focus-visible]:ring-2'],
    ['ownRing', 'focus-within:ring-2'],
    ['ownRing', 'group-focus-within:shadow-lg'],
    ['ownRing', '[&:focus-visible]:ring-2'],
    ['ownRing', 'md:focus-visible:ring-2!'],
    ['outlineOff', 'outline-none'],
    ['outlineOff', 'focus-visible:outline-hidden'],
    ['outlineOff', 'outline-0'],
    ['outlineOff', 'outline-transparent'],
    ['outlineOff', 'outline-[0px]'],
    ['outlineOff', '[outline:none]'],
    ['outlineOff', 'focus:[outline-style:none]'],
    ['outlineOff', 'outline-none!'],
    ['outlineOff', '!outline-0'],
    ['inlineOutlineOff', "style={{ outline: 'none' }}"],
    ['inlineOutlineOff', 'style={{ outline: 0 }}'],
    ['inlineOutlineOff', 'style={{ outlineStyle: "none" }}'],
    ['inlineOutlineOff', "style={{ outlineColor: 'transparent' }}"],
    ['inlineOutlineOff', "el.style.outline = 'none'"],
  ])('%s catches %s', (guard, line) => {
    expect(GUARDS[guard](`className={cn("p-2", ${JSON.stringify(line)})} ${line}`).length).toBeGreaterThan(0)
  })

  it.each([
    'focus-visible:-outline-offset-2',
    'focus:bg-accent focus:text-accent-foreground',
    'aria-invalid:ring-3 aria-invalid:ring-destructive/20',
    'data-[selected]:ring-2 hover:shadow-md shadow-lg ring-1',
    'outline-ring/50 outline-offset-0 outline-2',
    'if (a !== b && !focused) return { focus: true }',
    "style={{ outline: '2px solid var(--brand)' }}",
  ])('no guard catches %s', (line) => {
    for (const [guard, catches] of Object.entries(GUARDS)) expect(catches(line), guard).toEqual([])
  })
})

// The guards, read over the source. A comment that names a utility is read too, so a comment
// about the ring names it in words.
describe('the controls and the one ring', () => {
  const sources = files
    .filter((file) => /\.(jsx?|css)$/.test(file) && !name(file).split('/').includes('__tests__'))
    .map((file) => ({ file: name(file), text: readFileSync(file, 'utf8') }))
  const hits = (guard, only = () => true) =>
    sources.filter(({ file }) => only(file)).flatMap(({ file, text }) =>
      text.split('\n').flatMap((line, i) => GUARDS[guard](line).map((found) => `${file}:${i + 1} ${found}`)),
    )

  it('finds the controls it is meant to read', () => {
    for (const expected of ['components/ui/button-variants.js', 'components/ui/input.jsx', 'components/ui/tabs.jsx']) {
      expect(sources.map(({ file }) => file), expected).toContain(expected)
    }
  })

  it('never needs the important modifier to place the ring', () => {
    expect(hits('important')).toEqual([])
  })

  it('never draws a focus ring or a focus shadow of its own beside the outline', () => {
    expect(hits('ownRing')).toEqual([])
  })

  // An element that is not itself a control may turn the outline off: the dialog panel, which
  // takes focus only to hold it while the dialog opens, and the main landmark, which takes
  // focus only from the skip link, as a place to start from. An option of a list is not one
  // of them: the arrow keys move focus from option to option, and the ring is how a keyboard
  // sees where it is, since the fill of the highlighted option is too faint to show it.
  const MAY_HIDE_THE_OUTLINE = {
    'components/ui/dialog.jsx': ['outline-none'],
    'components/shell/AppShell.jsx': ['outline-none'],
  }

  it('turns the outline off only on the elements that are not controls', () => {
    const found = {}
    for (const hit of hits('outlineOff')) {
      const [where, utility] = hit.split(' ')
      const file = where.slice(0, where.lastIndexOf(':'))
      ;(found[file] ??= []).push(utility)
    }
    expect(found).toEqual(MAY_HIDE_THE_OUTLINE)
  })

  // The stylesheet turns it off for a focus from a pointer only, which the keyboard focus
  // tests above read.
  it('never turns the outline off with a style written in the code', () => {
    expect(hits('inlineOutlineOff', (file) => /\.jsx?$/.test(file))).toEqual([])
  })
})

describe('the page', () => {
  const page = readFileSync(resolve(srcDir, '..', 'index.html'), 'utf8')

  it('carries the dark class on the html element, so that portals on body are dark too', () => {
    expect(page).toMatch(/<html\b[^>]*\sclass="(?:[^"]*\s)?dark(?:\s[^"]*)?"/)
  })
})
