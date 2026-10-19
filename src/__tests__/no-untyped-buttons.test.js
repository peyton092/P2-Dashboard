import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'espree'

// A native <button> with no type is a submit button. Inside a form it sends the form, and
// Enter pressed in any box of the form presses the first such button, so a close, remove or
// open button in a form sends the form instead. Every native <button> in the production
// source says its type, button, submit or reset, as a literal, found in the syntax tree of
// every file. A button that takes its props from a spread is left alone: the component that
// spreads them gives it its type, as the shared Button does, whose own test checks that it
// is a plain button unless told otherwise. Files under a __tests__ directory and the test
// helpers in src/test are not read.

const srcDir = resolve(import.meta.dirname, '..')

function sourcesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'test' ? [] : sourcesUnder(path)
    return /\.jsx?$/.test(entry.name) ? [path] : []
  })
}

const sources = sourcesUnder(srcDir).map((file) => ({
  name: relative(srcDir, file).split('\\').join('/'),
  code: readFileSync(file, 'utf8'),
}))

// Every node under a node, the node first.
function* nodesUnder(node) {
  if (Array.isArray(node)) {
    for (const child of node) yield* nodesUnder(child)
    return
  }
  if (!node || typeof node.type !== 'string') return
  yield node
  for (const [key, child] of Object.entries(node)) {
    if (key !== 'loc' && child && typeof child === 'object') yield* nodesUnder(child)
  }
}

// The three types a button has.
const TYPES = ['button', 'submit', 'reset']

// The value of an attribute when it is written as a string literal, in quotes or in braces.
const literal = (attr) => {
  const value = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value
  return value?.type === 'Literal' && typeof value.value === 'string' ? value.value : null
}

// The opening tag of every native button in some code, with the line it is on, whether it
// says one of the three types as a literal, and whether its props come from a spread.
function buttonsIn(code) {
  const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true })
  return [...nodesUnder(tree)]
    .filter((node) => node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && node.name.name === 'button')
    .map((node) => ({
      line: node.loc.start.line,
      typed: node.attributes.some((attr) => attr.type === 'JSXAttribute' && attr.name.name === 'type' && TYPES.includes(literal(attr))),
      spread: node.attributes.some((attr) => attr.type === 'JSXSpreadAttribute'),
    }))
}

// Every native button in the production source, with the file and line it is on.
const buttons = sources.flatMap(({ name, code }) =>
  buttonsIn(code).map(({ line, ...button }) => ({ where: `${name}:${line}`, ...button })),
)

describe('native buttons', () => {
  it('are found in the files they are written in', () => {
    expect(sources.length).toBeGreaterThan(60)
    expect(buttons.length).toBeGreaterThan(50)
    for (const file of ['App.jsx', 'components/Calendar.jsx', 'components/shell/MobileNav.jsx']) {
      expect(buttons.some(({ where }) => where.startsWith(`${file}:`)), file).toBe(true)
    }
  })

  it('all say their type, unless their props come from a spread', () => {
    expect(buttons.filter(({ typed, spread }) => !typed && !spread).map(({ where }) => where)).toEqual([])
  })
})

// The guard itself. A type is one of the three a button has, written as a literal in lower
// case: a value that is worked out, or one that is misspelled or left empty, is no type, and
// a browser makes a button with an invalid type a submit button.
describe('the guard of the button type', () => {
  it.each([
    ['type="button"', true],
    ['type="submit"', true],
    ['type="reset"', true],
    ["type={'button'}", true],
    ['', false],
    ['type="buton"', false],
    ['type="Button"', false],
    ['type=""', false],
    ['type', false],
    ['type={kind}', false],
    ['type={open ? "button" : "submit"}', false],
  ])('reads <button %s> as typed: %s', (attributes, typed) => {
    expect(buttonsIn(`const b = <button ${attributes}>Go</button>`)).toEqual([{ line: 1, typed, spread: false }])
  })

  it('reads a button whose props come from a spread as spread', () => {
    expect(buttonsIn('const b = <button {...props}>Go</button>')).toEqual([{ line: 1, typed: false, spread: true }])
  })
})
