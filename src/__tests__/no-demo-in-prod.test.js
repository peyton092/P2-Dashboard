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

const srcDir = resolve(import.meta.dirname, '..')
const demoDir = join(srcDir, 'demo')
const sampleData = resolve(srcDir, '..', 'scripts', 'demo-data.mjs')
const mainFile = join(srcDir, 'main.jsx')

const inDemo = (path) => path === demoDir || path.startsWith(`${demoDir}${sep}`)

function sourcesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || inDemo(path) ? [] : sourcesUnder(path)
    return /\.(?:jsx?|mjs)$/.test(entry.name) ? [path] : []
  })
}

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

// What a specifier names on disk, for the two ways the app writes a path of its own:
// relative, and from @, which is src. A package name is not a path and gives null.
function pathOf(file, specifier) {
  if (specifier.startsWith('@/')) return join(srcDir, specifier.slice(2))
  if (specifier.startsWith('.')) return resolve(dirname(file), specifier)
  return null
}

const namesDemo = (path) => path !== null && (inDemo(path) || path === sampleData || path === sampleData.replace(/\.mjs$/, ''))

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
// it, or an import() of it. Each is { line, how, gated }.
function demoImportsIn(file, code) {
  const found = []
  for (const { node, ancestors } of nodesWithAncestors(parseSource(code))) {
    let specifier = null
    let how = null
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      specifier = node.source.value
      how = 'static'
    } else if (node.type === 'ImportExpression') {
      specifier = node.source.type === 'Literal' ? node.source.value : null
      how = 'dynamic'
      if (specifier === null) {
        found.push({ line: node.loc.start.line, how: 'dynamic with a computed path', gated: false })
        continue
      }
    }
    if (specifier !== null && namesDemo(pathOf(file, specifier))) {
      found.push({ line: node.loc.start.line, how, gated: how === 'dynamic' && isDemoGate(gateOf(ancestors)) })
    }
  }
  return found
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
})
