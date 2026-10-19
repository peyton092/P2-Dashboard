import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'espree'

// Two habits set small words in colors that cannot be read, and jsdom cannot measure
// contrast, so this test finds them in the source, in the syntax tree of every production
// file. Files under a __tests__ directory are not read.
//
// 1. zinc 500 (and the darker zinc 600) for words. On the page background zinc 500 is about
//    4.1 to 1 and on a card less, under the 4.5 to 1 that text under 18 pixels needs, so
//    small words are zinc 400 or lighter. An icon may stay zinc 500, since a picture beside
//    words needs 3 to 1 at most, and an element whose name ends in Icon is taken for one.
// 2. White words on the brand orange, which is 2.76 to 1. The brand foreground, near black,
//    is what words on a brand fill are set in: an element that fills itself with the brand
//    color (bg-brand, or a backgroundColor style that names BRAND) and sets its own words
//    in white (text-white, or a color style of #fff or white) is reported. A tint of the
//    brand, withAlpha(BRAND, ...), is not a fill and is left alone.

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
    if (key !== 'loc' && key !== 'range' && child && typeof child === 'object') yield* nodesUnder(child)
  }
}

// Every JSX opening element of every file, with the source text of its className and style.
const elements = sources.flatMap(({ name, code }) => {
  const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true })
  const text = (node) => (node ? code.slice(node.range[0], node.range[1]) : '')
  return [...nodesUnder(tree)]
    .filter((node) => node.type === 'JSXOpeningElement')
    .map((node) => {
      const attribute = (attr) => node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === attr)
      const tag = node.name.type === 'JSXIdentifier' ? node.name.name : text(node.name)
      return { where: `${name}:${node.loc.start.line}`, tag, className: text(attribute('className')), style: text(attribute('style')) }
    })
})

describe('small words on the dark surfaces', () => {
  it('reads the files it is meant to read', () => {
    const names = sources.map(({ name }) => name)
    expect(names.length).toBeGreaterThan(60)
    for (const expected of ['App.jsx', 'components/TeamLeaderboard.jsx', 'components/shell/Sidebar.jsx']) {
      expect(names, expected).toContain(expected)
    }
    expect(elements.length).toBeGreaterThan(1000)
  })

  it('are never zinc 500 or zinc 600, except on an icon', () => {
    const dim = elements.filter(({ tag, className }) => /(?<![\w-])(?:[\w-]+:)*text-zinc-[56]00(?![\w-])/.test(className) && !/Icon$/.test(tag))
    expect(dim.map(({ where, tag }) => `${where} <${tag}>`)).toEqual([])
  })

  it('are never white on a brand fill', () => {
    const fill = ({ className, style }) => /(?<![\w-])bg-brand(?![\w/-])/.test(className) || /backgroundColor:\s*(?:[^,}]*\?\s*)?BRAND\b/.test(style)
    const white = ({ className, style }) => /(?<![\w:-])text-white(?![\w/-])/.test(className) || /color:\s*'(?:#f{3}(?:f{3})?|white)'/i.test(style)
    expect(elements.filter((element) => fill(element) && white(element)).map(({ where, tag }) => `${where} <${tag}>`)).toEqual([])
  })
})
