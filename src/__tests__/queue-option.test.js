import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'espree'

// run(fn, { queue: true }) tells useMutation that fn is one Firestore write, which is in the
// local cache at once, so that a write that has not answered while the device is offline is
// reported as saved on this device. That is false of a call to a Cloud Function or to Auth,
// which nothing queues, and of a function that awaits something and then does more, whose
// rest has not happened while the first await is still out.
//
// What this test does. It reads every call of a run function in the production source (run,
// runSave and the like, result.run, edit.run) that has a function written inline as its first
// argument and an options object as its second, and fails when queue is on one whose function
// calls anything imported from firebase/auth or firebase/functions, or a helper of
// useFirestore.js that calls a Cloud Function; or awaits something and then does more, an await
// being allowed only as the last thing a function does; or calls, by name, a function declared
// in the same file whose body does either of those. A function called by name is followed one
// step. A queue that is not the literal false counts as queued.
//
// What it cannot see. A first argument that is not written inline. A function called by a name
// this file does not declare: an import, a member of an object, or a parameter, such as the
// action that PhaseRow is given. A call two steps away. Work chained on a promise with then.
// Whether the caller uses the value of the write. The call site audit in the task report, and
// the review, are what cover those, and the audit is redone when a task adds a call or changes
// what one calls.
//
// Files under a __tests__ directory are not scanned: they hold these patterns on purpose as
// inputs.

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

// The functions a file declares, by name, wherever they are in it: function declarations, and
// constants that hold an arrow function or a function expression. Two functions with one name
// are both kept, and both are read.
function declaredFunctions(tree) {
  const declared = new Map()
  const add = (name, fn) => declared.set(name, [...(declared.get(name) ?? []), fn])
  for (const node of nodesUnder(tree)) {
    if (node.type === 'FunctionDeclaration' && node.id) add(node.id.name, node)
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isFunction(node.init)) add(node.id.name, node.init)
  }
  return declared
}

// The awaits in a function that are not the last thing it does, found by walking to the end of
// the function. An await may be the whole of the last statement, or of what it returns or
// declares, and the same of the last statement of each branch of an if that ends the function.
// An await in a statement that another follows, in a loop or a try, or inside a larger
// expression, has work after it.
function awaitsBeforeTheEnd(fn) {
  const found = []
  const awaitsIn = (node) => {
    for (const inner of nodesUnder(node)) if (inner.type === 'AwaitExpression') found.push(inner)
  }
  // What an await at the head of an expression leaves to look in: the thing it waits for.
  const afterHead = (expression) => (expression?.type === 'AwaitExpression' ? expression.argument : expression)
  const last = (statement) => {
    if (statement.type === 'BlockStatement') return inBlock(statement.body)
    if (statement.type === 'IfStatement') {
      awaitsIn(statement.test)
      last(statement.consequent)
      return statement.alternate ? last(statement.alternate) : undefined
    }
    if (statement.type === 'ExpressionStatement') return awaitsIn(afterHead(statement.expression))
    if (statement.type === 'ReturnStatement') return awaitsIn(afterHead(statement.argument))
    if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) return awaitsIn(afterHead(statement.declarations[0].init))
    return awaitsIn(statement)
  }
  const inBlock = (statements) => {
    const end = statements.at(-1)
    statements.forEach((statement) => (statement === end ? last(statement) : awaitsIn(statement)))
  }
  if (fn.body.type === 'BlockStatement') inBlock(fn.body.body)
  else awaitsIn(afterHead(fn.body))
  return found
}

// What is wrong with a function that is to be queued: it calls something that is a call to the
// server, or it awaits something and then does more.
function problemsOf(fn, server) {
  const problems = []
  for (const inner of nodesUnder(fn.body)) {
    if (inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && server.has(inner.callee.name)) {
      problems.push(`calls ${inner.callee.name}, which is a call to the server`)
    }
  }
  if (awaitsBeforeTheEnd(fn).length > 0) problems.push('awaits something and then does more')
  return problems
}

// Every call of a run function in a file that is given an inline function and an options
// object, as { line, queued, problems }. queued is true unless queue is left out or is the
// literal false. problems say what is wrong with a queued call, in its own function and in the
// functions of this file that it calls by name.
function runCalls(code, callables) {
  const tree = parseSource(code)
  const declared = declaredFunctions(tree)

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
      problems.push(...problemsOf(fn, server))
      const named = new Set()
      for (const inner of nodesUnder(fn.body)) {
        if (inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && declared.has(inner.callee.name)) named.add(inner.callee.name)
      }
      for (const name of named) {
        for (const helper of declared.get(name)) problems.push(...problemsOf(helper, server).map((problem) => `calls ${name}, which ${problem}`))
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
  // helper does not fail this test. The counts are floors, low enough that a later task which
  // removes a few call sites does not trip them. They are here so that a scan that has gone
  // blind, and finds nothing, cannot pass the test below.
  it('finds the calls it is meant to read, and the helpers that call a Cloud Function', () => {
    expect([...callables]).toEqual(expect.arrayContaining(['sendExtraToBuilder', 'approveExtra', 'rejectExtra', 'passInspection', 'failInspection', 'createJob']))
    expect(all.filter((call) => call.queued).length).toBeGreaterThanOrEqual(10)
    expect(all.filter((call) => !call.queued).length).toBeGreaterThanOrEqual(5)
  })

  it('is never given for a call to a Cloud Function or to Auth, or for a function that awaits and then does more', () => {
    const wrong = all.flatMap(({ name, line, problems }) => problems.map((problem) => `${name}:${line} queue: true on a function that ${problem}`))
    expect(wrong).toEqual([])
  })

  // The save of the review link awaits its write and then sets the link the cards show, so it
  // must not be queued. A copy of the real file with queue: true put back on that call is what
  // the scan has to catch, and the real file is not touched.
  it('catches queue: true put back on the save of the review link', () => {
    const real = readFileSync(join(srcDir, 'components', 'TeamLeaderboard.jsx'), 'utf8')
    const call = 'runUrl(() => saveUrl(urlDraft.trim()), {'
    expect(real, 'the call this sample puts queue: true on has moved').toContain(call)

    const mutant = real.replace(call, `${call}\n      queue: true,`)

    const wrong = runCalls(mutant, callables).filter((found) => found.problems.length > 0)
    expect(wrong.map((found) => found.problems)).toEqual([['calls saveUrl, which awaits something and then does more']])
  })
})

// The scan has to see what it is for, or the test above proves nothing.
describe('the scan of the queue option', () => {
  const scan = (code) => runCalls(code, callables)
  const IMPORTS = "import { approveExtra } from '../hooks/useFirestore'\nimport { updatePassword } from 'firebase/auth'\nimport { httpsCallable } from 'firebase/functions'\n"
  const AWAITS = 'awaits something and then does more'

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

  it('reports a queued function that awaits and then does more, however it is written', () => {
    const calls = scan(`
      run(async () => { const created = await addDoc(c, d); keep(created.id) }, { queue: true })
      run(async () => { await updateDoc(r, d); done() }, { queue: !!docId })
      run(async () => keep(await addDoc(c, d)), { queue: true })
      run(async () => { for (const row of rows) { await updateDoc(row, d) } }, { queue: true })
      run(async () => { if (x) { await updateDoc(r, d) } finish() }, { queue: true })
      run(async () => { await first(); await second() }, { queue: true })
      run(async () => { if (x) { await updateDoc(r, d) } else { await first(); second() } }, { queue: true })
      run(async () => { if (await allowed()) { await updateDoc(r, d) } }, { queue: true })
    `)
    expect(calls.map((call) => call.problems)).toEqual(Array(8).fill([AWAITS]))
    expect(calls[1].queued).toBe(true)
  })

  it('accepts a function that ends in its await, which is one write', () => {
    const calls = scan(`
      run(async () => { await updateDoc(r, d) }, { queue: true })
      run(async () => await updateDoc(r, d), { queue: true })
      run(async () => { return await updateDoc(r, d) }, { queue: true })
      run(async () => { const patch = shape(); if (x) { await updateDoc(r, patch) } else { await setDoc(r, patch) } }, { queue: true })
      run(async () => { const reference = await addDoc(c, d) }, { queue: true })
    `)
    expect(calls.map((call) => call.queued)).toEqual([true, true, true, true, true])
    expect(calls.flatMap((call) => call.problems)).toEqual([])
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

  describe('follows a call to a function declared in the same file, one step', () => {
    it('reports a function declaration that awaits and then does more, wherever it is declared', () => {
      const [call] = scan(`
        function useReviewUrl() {
          async function saveUrl(val) {
            await setDoc(ref, { url: val })
            setUrl(val)
          }
          return { saveUrl }
        }
        function Screen() {
          const { saveUrl } = useReviewUrl()
          run(() => saveUrl(draft.trim()), { queue: true })
        }
      `)
      expect(call.problems).toEqual([`calls saveUrl, which ${AWAITS}`])
    })

    it('reports a constant that holds a function that awaits and then does more', () => {
      const calls = scan(`
        const saveUrl = async (val) => { await setDoc(ref, { url: val }); setUrl(val) }
        const saveLink = async function (val) { await setDoc(ref, { url: val }) }
        run(() => saveUrl(draft), { queue: true })
        run(() => saveLink(draft), { queue: true })
      `)
      expect(calls.map((call) => call.problems)).toEqual([[`calls saveUrl, which ${AWAITS}`], []])
    })

    it('reports a function that calls the server, and says what it calls', () => {
      const [call] = scan(`${IMPORTS}
        async function send(id) { return approveExtra(id) }
        run(() => send(id), { queue: true })
      `)
      expect(call.problems).toEqual(['calls send, which calls approveExtra, which is a call to the server'])
    })

    it('accepts a function that ends in its await, or in no await at all', () => {
      const calls = scan(`
        async function patchScore(name, updates) { await updateDoc(ref(name), updates) }
        async function applyAction(alert, status) {
          const patch = { status }
          if (alert.id) { await updateAgentAlert(alert.id, patch) } else { await addAgentAlert({ ...alert, ...patch }) }
        }
        const plain = (id) => updateJob(id, {})
        run(() => patchScore(name, { referrals: 1 }), { queue: true })
        run(() => applyAction(alert, 'resolved'), { queue: true })
        run(() => plain(id), { queue: true })
      `)
      expect(calls.map((call) => call.queued)).toEqual([true, true, true])
      expect(calls.flatMap((call) => call.problems)).toEqual([])
    })

    it('does not follow a call two steps away, a name this file does not declare, or a member', () => {
      const calls = scan(`${IMPORTS}
        function outer(id) { return inner(id) }
        async function inner(id) { await first(id); second(id) }
        run(() => outer(id), { queue: true })
        run(() => imported(id), { queue: true })
        run(() => now.write(id), { queue: true })
        run((action) => action(id), { queue: true })
      `)
      expect(calls.flatMap((call) => call.problems)).toEqual([])
    })

    it('reads each function that has the name, and reports a call once however often it is made', () => {
      const [call] = scan(`
        function Screen() { async function save(v) { await a(v); b(v) } run(() => { save(1); save(2) }, { queue: true }) }
      `)
      expect(call.problems).toEqual([`calls save, which ${AWAITS}`])
    })
  })

  it('leaves alone a run with no options, and a call that is not a run', () => {
    expect(scan('run(() => approveExtra(id))\nrunner(() => 1, { queue: true })\nrun(job, { queue: true })')).toEqual([])
  })
})
