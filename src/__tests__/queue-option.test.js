import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'espree'

// run(fn, { queue: true }) tells useMutation that fn is one Firestore write, which is in the
// local cache at once, so that a write that has not answered while the device is offline is
// reported as saved on this device. That is false of a call to a Cloud Function or to Auth,
// which nothing queues, and of a function that awaits something and then does more, whose
// rest has not happened when the first await is still out. This test reads every call of a
// run function in the source and fails when queue: true is on either of those. Files under a
// __tests__ directory are not scanned: they hold these patterns on purpose as inputs.

const srcDir = resolve(import.meta.dirname, '..')

function sourcesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesUnder(path)
    return /\.jsx?$/.test(entry.name) ? [path] : []
  })
}

const parseSource = (code) => parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true })

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

const isFunction = (node) => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'

// run, runSave, runStatus and the like, and result.run or edit.run.
function isRunCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'run' || /^run[A-Z]/.test(callee.name)
  return callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'run'
}

// The names of the helpers in src/hooks/useFirestore.js that call a Cloud Function, found by
// their calling callCloud, so that a new one is covered without this test being told.
function callableHelpers() {
  const tree = parseSource(readFileSync(join(srcDir, 'hooks', 'useFirestore.js'), 'utf8'))
  const names = new Set()
  for (const node of tree.body) {
    if (node.type !== 'ExportNamedDeclaration' || node.declaration?.type !== 'FunctionDeclaration') continue
    const callsCloud = [...nodesUnder(node.declaration.body)].some((inner) => (
      inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && inner.callee.name === 'callCloud'
    ))
    if (callsCloud) names.add(node.declaration.id.name)
  }
  return names
}

// Every call of a run function in a file that is given an options object, as { line, queued,
// problems }. queued is true unless queue is left out or is the literal false. problems say
// what is wrong with a queued call: it calls something the Cloud Functions or Auth provide,
// or it awaits.
function runCalls(code, callables) {
  const tree = parseSource(code)

  // What this file imports that is a call to the server: all of firebase/auth and
  // firebase/functions, and the helpers of useFirestore that call a Cloud Function.
  const server = new Set()
  for (const node of tree.body) {
    if (node.type !== 'ImportDeclaration') continue
    const from = node.source.value
    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue
      if (from === 'firebase/auth' || from === 'firebase/functions') server.add(specifier.local.name)
      else if (/\/useFirestore$/.test(from) && callables.has(specifier.imported.name)) server.add(specifier.local.name)
    }
  }

  const found = []
  for (const node of nodesUnder(tree)) {
    if (node.type !== 'CallExpression' || !isRunCallee(node.callee)) continue
    const [fn, options] = node.arguments
    if (!isFunction(fn) || options?.type !== 'ObjectExpression') continue
    const queue = options.properties.find((property) => property.type === 'Property' && !property.computed && property.key.name === 'queue')
    const queued = !!queue && !(queue.value.type === 'Literal' && queue.value.value === false)
    const problems = []
    if (queued) {
      for (const inner of nodesUnder(fn.body)) {
        if (inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && server.has(inner.callee.name)) {
          problems.push(`calls ${inner.callee.name}, which is a call to the server`)
        }
        if (inner.type === 'AwaitExpression') problems.push('awaits, so it may do more than one thing')
      }
    }
    found.push({ line: node.loc.start.line, queued, problems })
  }
  return found
}

const callables = callableHelpers()
const files = sourcesUnder(srcDir).map((file) => ({
  name: relative(srcDir, file).split('\\').join('/'),
  calls: runCalls(readFileSync(file, 'utf8'), callables),
}))
const all = files.flatMap(({ name, calls }) => calls.map((call) => ({ name, ...call })))

describe('the queue option of run', () => {
  // The helpers are found in useFirestore.js, so a new one is covered without this test being
  // told. The known ones are checked to be found, and the list is not pinned, so adding a
  // helper does not fail this test.
  it('finds the calls it is meant to read, and the helpers that call a Cloud Function', () => {
    expect([...callables]).toEqual(expect.arrayContaining(['sendExtraToBuilder', 'approveExtra', 'rejectExtra', 'passInspection', 'failInspection', 'createJob']))
    expect(all.length).toBeGreaterThan(40)
    expect(all.filter((call) => call.queued).length).toBeGreaterThan(30)
    expect(all.filter((call) => !call.queued).length).toBeGreaterThan(5)
  })

  it('is never given for a call to a Cloud Function or to Auth, or for a function that awaits', () => {
    const wrong = all.flatMap(({ name, line, problems }) => problems.map((problem) => `${name}:${line} queue: true on a function that ${problem}`))
    expect(wrong).toEqual([])
  })
})

// The scan has to see what it is for, or the test above proves nothing.
describe('the scan of the queue option', () => {
  const scan = (code) => runCalls(code, callables)
  const IMPORTS = "import { approveExtra } from '../hooks/useFirestore'\nimport { updatePassword } from 'firebase/auth'\nimport { httpsCallable } from 'firebase/functions'\n"

  it('reports a queued call to a Cloud Function helper, to httpsCallable and to Auth', () => {
    const [helper, callable, auth] = scan(`${IMPORTS}
      run(() => approveExtra(id), { queue: true })
      runQb(() => httpsCallable(functions, 'qbDisconnect')(), { queue: true })
      result.run(() => updatePassword(user, text), { success: 'x', queue: true })
    `)
    expect(helper.problems).toEqual(['calls approveExtra, which is a call to the server'])
    expect(callable.problems).toEqual(['calls httpsCallable, which is a call to the server'])
    expect(auth.problems).toEqual(['calls updatePassword, which is a call to the server'])
  })

  it('reports a queued function that awaits, or whose flag is not a plain true', () => {
    const [awaits, computed] = scan(`
      run(async () => { const created = await addDoc(c, d); keep(created.id) }, { queue: true })
      run(async () => { await updateDoc(r, d) }, { queue: !!docId })
    `)
    expect(awaits.problems).toEqual(['awaits, so it may do more than one thing'])
    expect(computed.queued).toBe(true)
    expect(computed.problems).toEqual(['awaits, so it may do more than one thing'])
  })

  it('accepts one write, a Promise.all of writes, and a call to the server that is not queued', () => {
    const calls = scan(`${IMPORTS}
      run(() => updateJob(id, patch), { queue: true })
      run(() => Promise.all(rows.map((row) => updateNotification(row.id, patch))), { queue: true })
      run(() => { const data = shape(form); return addSupplierInvoice(data) }, { queue: true })
      run(() => approveExtra(id), { success: 'x' })
      run(() => approveExtra(id), { queue: false })
      run(async () => { await updatePassword(user, text) }, { error: 'x' })
    `)
    expect(calls.map((call) => call.queued)).toEqual([true, true, true, false, false, false])
    expect(calls.flatMap((call) => call.problems)).toEqual([])
  })

  it('leaves alone a run with no options, and a call that is not a run', () => {
    expect(scan('run(() => approveExtra(id))\nrunner(() => 1, { queue: true })\nrun(job, { queue: true })')).toEqual([])
  })
})
