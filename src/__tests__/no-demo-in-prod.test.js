import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parse } from 'espree'

// The demo build (vite build --mode demo) runs this app on sample data, and the
// production build must carry none of it: no shim, no seed, no banner, no sample text.
// The production build leaves a module out when nothing reaches it, so this test holds
// the one way in. Nothing outside src/demo imports from src/demo, except a single
// dynamic import in src/main.jsx inside if (import.meta.env.VITE_DEMO === '1'), which
// the production build drops because the condition is false when it is built. Nothing
// outside src/demo imports the sample data in scripts/demo-data.mjs. The CI job
// demo-build checks the built output itself. Files under a __tests__ directory are not
// scanned: tests import the demo modules on purpose.
//
// Every way Vite pulls a file into a build is read: import and export from, import(),
// import.meta.glob, new URL(path, import.meta.url), and the scripts of index.html, with
// paths relative, from @ (src) or from / (the project root). The production build also
// stops itself when it loads a demo module (vite.config.js), so this test and the build
// both fail closed.

const srcDir = resolve(import.meta.dirname, '..')
const rootDir = resolve(srcDir, '..')
const demoDir = join(srcDir, 'demo')
const sampleData = join(rootDir, 'scripts', 'demo-data.mjs')
const mainFile = join(srcDir, 'main.jsx')
const indexFile = join(rootDir, 'index.html')

const inDemo = (path) => path === demoDir || path.startsWith(`${demoDir}${sep}`)

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

function sourcesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || inDemo(path) ? [] : sourcesUnder(path)
    return /\.(?:jsx?|mjs)$/.test(entry.name) ? [path] : []
  })
}

// Every file a glob could pull in that the production build must not carry.
const demoFiles = [...filesUnder(demoDir), sampleData]

const parseSource = (code) => parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true })

// Every node under a node, each with the chain of nodes above it, nearest first.
function* nodesWithAncestors(node, ancestors = []) {
  if (Array.isArray(node)) {
    for (const child of node) yield* nodesWithAncestors(child, ancestors)
    return
  }
  if (!node || typeof node.type !== 'string') return
  yield { node, ancestors }
  for (const [key, child] of Object.entries(node)) {
    if (key !== 'loc' && child && typeof child === 'object') yield* nodesWithAncestors(child, [{ node, key }, ...ancestors])
  }
}

// What a specifier names on disk, for the three ways a path of the project is written:
// relative, from @ (src), and from / (the project root, as Vite reads it). A query or
// a hash (?raw, ?url) is not part of the path. A package name gives null.
function fromFile(file, path) {
  if (path.startsWith('@/')) return join(srcDir, path.slice(2))
  if (path.startsWith('/')) return join(rootDir, path.slice(1))
  if (path.startsWith('.')) return resolve(dirname(file), path)
  return null
}

const pathOf = (file, specifier) => fromFile(file, specifier.replace(/[?#].*$/, ''))

const namesDemo = (path) => path !== null && (inDemo(path) || path === sampleData || path === sampleData.replace(/\.mjs$/, ''))

// A pattern of import.meta.glob as a regular expression over whole paths, in the syntax
// Vite's globs use: ** for any number of folders, * and ? inside one name, {a,b} for
// choices. Every other character stands for itself.
function globToRegExp(pattern) {
  let out = ''
  let depth = 0
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else if (c === '{') { out += '(?:'; depth += 1 }
    else if (c === '}' && depth > 0) { out += ')'; depth -= 1 }
    else if (c === ',' && depth > 0) out += '|'
    else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

// Whether the patterns of one import.meta.glob take in a demo file: a file one of its
// patterns matches and none of its ! patterns leaves out. A ? in a pattern is a glob
// character, not a query, so patterns are placed with fromFile.
function globReachesDemo(file, patterns) {
  const matcher = (pattern) => {
    const path = fromFile(file, pattern)
    return path === null ? () => false : (candidate) => globToRegExp(path.split(sep).join('/')).test(candidate.split(sep).join('/'))
  }
  const taken = patterns.filter((p) => !p.startsWith('!')).map(matcher)
  const left = patterns.filter((p) => p.startsWith('!')).map((p) => matcher(p.slice(1)))
  return demoFiles.some((candidate) => taken.some((match) => match(candidate)) && !left.some((match) => match(candidate)))
}

const isImportMeta = (node) => node?.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta'

// import.meta.glob(...) and import.meta.globEager(...).
const isGlobCall = (node) => node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
  && isImportMeta(node.callee.object) && ['glob', 'globEager'].includes(node.callee.property.name)

// new URL(path, import.meta.url), which Vite turns into a file of the build.
const isAssetUrl = (node) => node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL'
  && node.arguments.length >= 2 && node.arguments[1].type === 'MemberExpression'
  && isImportMeta(node.arguments[1].object) && node.arguments[1].property.name === 'url'

// The string patterns of a glob call, or null when one of them is computed.
function patternsOf(argument) {
  const items = argument?.type === 'ArrayExpression' ? argument.elements : [argument]
  return items.every((item) => item?.type === 'Literal' && typeof item.value === 'string') ? items.map((item) => item.value) : null
}

// The test of the if statement whose consequent holds the node, nearest first.
function gateOf(ancestors) {
  for (let i = 0; i < ancestors.length; i += 1) {
    const { node, key } = ancestors[i]
    if (node.type === 'IfStatement' && key === 'consequent') return node.test
  }
  return null
}

// import.meta.env.VITE_DEMO === '1', exactly.
function isDemoGate(test) {
  if (!test || test.type !== 'BinaryExpression' || test.operator !== '===') return false
  const { left, right } = test
  const isFlag = left.type === 'MemberExpression' && !left.computed && left.property.name === 'VITE_DEMO'
    && left.object.type === 'MemberExpression' && !left.object.computed && left.object.property.name === 'env'
    && left.object.object.type === 'MetaProperty' && left.object.object.meta.name === 'import' && left.object.object.property.name === 'meta'
  return isFlag && right.type === 'Literal' && right.value === '1'
}

// Every place a file names a demo module or the sample data: an import or export from
// it, an import() of it, a glob that takes it in, or a new URL of it. Each is
// { line, how, gated }. Only an import() can be gated.
function demoImportsIn(file, code) {
  const found = []
  for (const { node, ancestors } of nodesWithAncestors(parseSource(code))) {
    const line = node.loc.start.line
    let specifier = null
    let how = null
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      specifier = node.source.value
      how = 'static'
    } else if (node.type === 'ImportExpression') {
      specifier = node.source.type === 'Literal' ? node.source.value : null
      how = 'dynamic'
      if (specifier === null) {
        found.push({ line, how: 'dynamic with a computed path', gated: false })
        continue
      }
    } else if (isGlobCall(node)) {
      const patterns = patternsOf(node.arguments[0])
      if (patterns === null) found.push({ line, how: 'glob with a computed pattern', gated: false })
      else if (globReachesDemo(file, patterns)) found.push({ line, how: 'glob', gated: false })
      continue
    } else if (isAssetUrl(node)) {
      const [target] = node.arguments
      if (target.type === 'Literal' && typeof target.value === 'string' && namesDemo(pathOf(file, target.value))) {
        found.push({ line, how: 'url', gated: false })
      }
      continue
    }
    if (specifier !== null && namesDemo(pathOf(file, specifier))) {
      found.push({ line, how, gated: how === 'dynamic' && isDemoGate(gateOf(ancestors)) })
    }
  }
  return found
}

// The scripts of a page, each with the line its tag starts on, the line its text
// starts on, its src (or null) and whether it is a module.
function scriptsOf(html) {
  const lineAt = (index) => html.slice(0, index).split('\n').length
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((match) => ({
    line: lineAt(match.index),
    textLine: lineAt(match.index + match[0].indexOf('>') + 1),
    src: /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2] ?? null,
    module: /\btype\s*=\s*(["'])module\1/i.test(match[1]),
    text: match[2],
  }))
}

// Every place a page loads a demo module: a script whose src is one, or a module
// script whose text imports one.
function demoImportsInHtml(file, html) {
  return scriptsOf(html).flatMap((script) => {
    if (script.src !== null) return namesDemo(pathOf(file, script.src)) ? [{ line: script.line, how: 'script', gated: false }] : []
    if (!script.module) return []
    return demoImportsIn(file, script.text).map((hit) => ({ ...hit, line: script.textLine + hit.line - 1 }))
  })
}

const files = sourcesUnder(srcDir)
const name = (file) => relative(srcDir, file).split(sep).join('/')
const found = files.flatMap((file) => demoImportsIn(file, readFileSync(file, 'utf8')).map((hit) => ({ file: name(file), ...hit })))

describe('the demo code in the production build', () => {
  it('finds the source it is meant to scan, and none of the demo code', () => {
    const names = files.map(name)
    expect(names.length).toBeGreaterThan(60)
    for (const expected of ['main.jsx', 'App.jsx', 'firebase.js', 'hooks/useFirestore.js']) expect(names).toContain(expected)
    expect(names.some((n) => n.startsWith('demo/') || n.includes('__tests__'))).toBe(false)
  })

  it('is reached by one import alone, the gated dynamic import in main.jsx', () => {
    expect(found).toEqual([{ file: 'main.jsx', line: expect.any(Number), how: 'dynamic', gated: true }])
  })

  it('starts the app from index.html through src/main.jsx alone', () => {
    const html = readFileSync(indexFile, 'utf8')
    expect(demoImportsInHtml(indexFile, html)).toEqual([])
    expect(scriptsOf(html).map((script) => script.src)).toEqual(['/src/main.jsx'])
  })

  it('registers the service worker only in the build that is not the demo', () => {
    const tree = parseSource(readFileSync(mainFile, 'utf8'))
    const registrations = [...nodesWithAncestors(tree)].filter(({ node }) =>
      node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'register')
    expect(registrations).toHaveLength(1)
    const elseOfGate = registrations[0].ancestors.find(({ node, key }) => node.type === 'IfStatement' && key === 'alternate')
    expect(elseOfGate && isDemoGate(elseOfGate.node.test)).toBe(true)
  })
})

// The scan has to see what it is for, or the tests above prove nothing.
describe('the scan for demo imports', () => {
  const scan = (code, file = mainFile) => demoImportsIn(file, code)
  const scanHtml = (html) => demoImportsInHtml(indexFile, html)

  it('reports a static import, an export from, and an import() that is not behind the gate', () => {
    expect(scan("import { db } from './demo/firebase'")).toEqual([{ line: 1, how: 'static', gated: false }])
    expect(scan("export * from '@/demo/seed'")).toEqual([{ line: 1, how: 'static', gated: false }])
    expect(scan("import('./demo/DemoBanner.jsx')")).toEqual([{ line: 1, how: 'dynamic', gated: false }])
    expect(scan("import { STATIC_JOBS } from '../scripts/demo-data.mjs'", join(srcDir, 'App.jsx'))).toEqual([{ line: 1, how: 'static', gated: false }])
  })

  it('reports an import() behind a gate that is not exactly the demo flag', () => {
    for (const gate of ["import.meta.env.VITE_DEMO == '1'", 'import.meta.env.VITE_DEMO', "import.meta.env.MODE === 'demo'", "import.meta.env.VITE_DEMO === '0'"]) {
      expect(scan(`if (${gate}) { import('./demo/start.jsx') }`), gate).toEqual([{ line: 1, how: 'dynamic', gated: false }])
    }
    expect(scan("if (import.meta.env.VITE_DEMO === '1') {} else { import('./demo/start.jsx') }")).toEqual([{ line: 1, how: 'dynamic', gated: false }])
    expect(scan('import(somewhere)')).toEqual([{ line: 1, how: 'dynamic with a computed path', gated: false }])
  })

  it('accepts the gated import, and leaves alone imports of the app and of packages', () => {
    expect(scan("if (import.meta.env.VITE_DEMO === '1') { import('./demo/start.jsx') }")).toEqual([{ line: 1, how: 'dynamic', gated: true }])
    expect(scan("import App from './App.jsx'\nimport { onSnapshot } from 'firebase/firestore'\nimport('./components/Analytics')")).toEqual([])
  })

  it('reads a path from the project root, and one with a query, as Vite does', () => {
    expect(scan("import '/src/demo/start.jsx'")).toEqual([{ line: 1, how: 'static', gated: false }])
    expect(scan("import('/scripts/demo-data.mjs')")).toEqual([{ line: 1, how: 'dynamic', gated: false }])
    expect(scan("import words from './demo/seed.js?raw'")).toEqual([{ line: 1, how: 'static', gated: false }])
    expect(scan("import '/src/App.jsx'")).toEqual([])
  })

  it('reports an import.meta.glob or a new URL that can reach the demo code', () => {
    expect(scan("const pages = import.meta.glob('./demo/*.jsx')")).toEqual([{ line: 1, how: 'glob', gated: false }])
    expect(scan("import.meta.glob('./**/*.jsx', { eager: true })")).toEqual([{ line: 1, how: 'glob', gated: false }])
    expect(scan("import.meta.glob(['./components/*.jsx', '/src/demo/shims/*.js'])")).toEqual([{ line: 1, how: 'glob', gated: false }])
    expect(scan("import.meta.glob('@/demo/{seed,users}.js')")).toEqual([{ line: 1, how: 'glob', gated: false }])
    expect(scan("import.meta.glob('./demo/?????.js')")).toEqual([{ line: 1, how: 'glob', gated: false }])
    expect(scan('import.meta.glob(pattern)')).toEqual([{ line: 1, how: 'glob with a computed pattern', gated: false }])
    expect(scan("new URL('./demo/demo.css', import.meta.url)")).toEqual([{ line: 1, how: 'url', gated: false }])
  })

  it('leaves alone a glob or a URL that cannot reach the demo code', () => {
    expect(scan("import.meta.glob('./components/**/*.jsx')")).toEqual([])
    expect(scan("import.meta.glob('./*.jsx')")).toEqual([])
    expect(scan("import.meta.glob(['./**/*.jsx', '!./demo/**'])")).toEqual([])
    expect(scan("new URL('./assets/logo.svg', import.meta.url)")).toEqual([])
  })

  it('reports a script of index.html that loads the demo code, by its src or inside it', () => {
    expect(scanHtml('<script type="module" src="/src/demo/start.jsx"></script>')).toEqual([{ line: 1, how: 'script', gated: false }])
    expect(scanHtml('<body>\n<script type="module">\nimport "/src/demo/start.jsx"\n</script>')).toEqual([{ line: 3, how: 'static', gated: false }])
    expect(scanHtml('<script type="module" src="/src/main.jsx"></script>')).toEqual([])
  })
})
