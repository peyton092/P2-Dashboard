import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'espree'

// Three habits made the app say something untrue, and this test keeps each of them out
// of the production source.
//
// 1. The clock read when a file loads. A Date, Date.now() or a day helper that defaults
//    to now is the time the tab opened, so a tab left open overnight, or all week, keeps
//    showing that day. Time is read when something renders (useNow) or inside a function
//    that takes it as an argument. This is found in the syntax tree, wherever it is
//    written at the top of a file: after an equals sign, in an object or an array, in a
//    class, or inside a function that is called where it is written.
// 2. A day cut out of an ISO string. An ISO string is in UTC, so in the evening in
//    Tennessee it already names tomorrow. A day is named in the local zone by
//    toLocalDateStr, and a month by monthKey, both in src/lib/dates.js.
// 3. A dot that says Live and nothing else. It is true when the app is offline too.
//    The connection chip reads the real state, and it is the only place the word is
//    written.
//
// It also checks the one line that keeps the connection probe running from the
// dashboard. Files under a __tests__ directory are not scanned: they hold these
// patterns on purpose as inputs.

const srcDir = resolve(import.meta.dirname, '..')

function sourcesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesUnder(path)
    return /\.jsx?$/.test(entry.name) ? [path] : []
  })
}

const sources = sourcesUnder(srcDir).map((file) => {
  const code = readFileSync(file, 'utf8')
  return { name: relative(srcDir, file).split('\\').join('/'), code, lines: code.split('\n') }
})

// The file and line of every line that matches, so a failure says where.
const hits = (pattern) =>
  sources.flatMap(({ name, lines }) =>
    lines.flatMap((line, index) => (pattern.test(line) ? [`${name}:${index + 1} ${line.trim()}`] : [])),
  )

// The helpers in src/lib/dates.js that read the clock when the time is left out, each with
// the most arguments a call can have and still leave it out: toLocalDateStr() names today,
// and daysSince(day) counts to now. daysBetween has no clock to default to, so it reaches
// the clock only through an argument, and a Date or Date.now() passed to it is reported
// as itself.
const CLOCK_DEFAULTS = { toLocalDateStr: 0, monthKey: 0, startOfLocalDay: 0, fmtLongDate: 0, daysSince: 1 }

const isFunction = (node) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
const isNamed = (node, name) => node?.type === 'Identifier' && node.name === name

// What a node reads from the clock, or null when it reads none.
function clockRead(node) {
  if (node.type === 'NewExpression' && isNamed(node.callee, 'Date')) return 'new Date'
  if (node.type !== 'CallExpression') return null
  const { callee } = node
  if (isNamed(callee, 'Date')) return 'Date()'
  if (callee.type === 'MemberExpression' && !callee.computed && isNamed(callee.object, 'Date') && isNamed(callee.property, 'now')) {
    return 'Date.now'
  }
  if (callee.type === 'Identifier' && Object.hasOwn(CLOCK_DEFAULTS, callee.name) && node.arguments.length <= CLOCK_DEFAULTS[callee.name]) {
    return `${callee.name} with the clock as its default`
  }
  return null
}

// Whether a call runs the function it holds where it is written, which makes that function
// code that runs when the file loads: (() => {})(), (function () {})(), and the same
// through .call or .apply.
function runsInPlace(call) {
  const { callee } = call
  if (isFunction(callee)) return true
  return callee.type === 'MemberExpression' && isFunction(callee.object) && ['call', 'apply'].includes(callee.property.name)
}

// Every clock reading that happens when the code loads, as { line, what }. Anything in a
// function, its parameters included, runs only when the function is called, and so does the
// initial value of a class field that is not static. A function called where it is written
// runs at once, so it is read as the code around it. A function handed to map or forEach at
// the top of a file runs at once too, and this scan does not follow it.
function loadTimeClockReads(code) {
  const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true })
  const found = []

  function walk(node, deferred, inPlace = false) {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, deferred, inPlace)
      return
    }
    if (!node || typeof node.type !== 'string') return

    if (!deferred) {
      const what = clockRead(node)
      if (what) found.push({ line: node.loc.start.line, what })
    }

    const callsInPlace = (node.type === 'CallExpression' || node.type === 'NewExpression') && runsInPlace(node)
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || !child || typeof child !== 'object') continue
      const later = (isFunction(node) && !inPlace) || (node.type === 'PropertyDefinition' && !node.static && key === 'value')
      const nextInPlace = (callsInPlace && key === 'callee') || (inPlace && node.type === 'MemberExpression' && key === 'object')
      walk(child, deferred || later, nextInPlace)
    }
  }

  walk(tree, false)
  return found
}

// The file and line of every clock reading at load, so a failure says where.
const loadTimeReads = sources.flatMap(({ name, code, lines }) => {
  try {
    return loadTimeClockReads(code).map(({ line, what }) => `${name}:${line} ${what}: ${lines[line - 1].trim()}`)
  } catch (error) {
    throw new Error(`${name} could not be read as source: ${error.message}`, { cause: error })
  }
})

describe('time and connection in the source', () => {
  it('finds the source it is meant to scan', () => {
    const names = sources.map(({ name }) => name)
    expect(names.length).toBeGreaterThan(60)
    for (const expected of ['App.jsx', 'lib/dates.js', 'components/shared/ConnectionChip.jsx', 'agent/scoring.js']) {
      expect(names, expected).toContain(expected)
    }
    expect(names.some((name) => name.includes('__tests__'))).toBe(false)
  })

  it('has no new Date, Date.now or default clock helper call outside a function, an immediately invoked one included', () => {
    expect(loadTimeReads).toEqual([])
  })

  it('cuts no day or month out of an ISO string', () => {
    expect(hits(/toISOString\(\)\s*\.(?:slice|substring|substr)\(/)).toEqual([])
    expect(hits(/toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/)).toEqual([])
  })

  it('keeps the connection probe running from the dashboard, for the screens that show no chip', () => {
    // Without this call the probe stops on Settings, a job page and Analytics, and the chip on
    // the next screen starts from nothing and flashes Syncing.
    const app = sources.find(({ name }) => name === 'App.jsx').lines.join('\n')
    expect(app).toMatch(/import \{ useConnectionState \} from '\.\/hooks\/useConnectionState'/)
    expect(app).toMatch(/^\s*useConnectionState\(\)\s*$/m)
  })

  it('writes the word Live in the connection chip and nowhere else', () => {
    // The word as a string, as the text of an element, and alone on a line of JSX.
    const found = hits(/>\s*Live\s*<|^\s*Live\s*$|'Live'|"Live"/)
    expect(found.map((hit) => hit.split(':')[0])).toEqual(['components/shared/ConnectionChip.jsx'])
  })
})

describe('the scan for the clock at load', () => {
  const found = (code) => loadTimeClockReads(code)

  it.each([
    ['a Date made at the top of a file', 'const NOW = new Date()'],
    ['a Date made from a number', 'export const START = new Date(0)'],
    ['Date.now', 'const STARTED = Date.now()'],
    ['Date called as a function', 'const STAMP = Date()'],
    ['a Date in an object', 'const STATE = { today: new Date() }'],
    ['a Date in an array', 'const DAYS = [new Date()]'],
    ['a Date in a template', 'const LABEL = `${Date.now()}`'],
    ['a Date in the default export', 'export default { when: new Date() }'],
    ['a Date in JSX at the top of a file', 'const CLOCK = <Clock at={new Date()} />'],
    ['today from the day helper', 'const TODAY = toLocalDateStr()'],
    ['the month from the month helper', 'const MONTH = monthKey()'],
    ['the start of the day from its helper', 'const START = startOfLocalDay()'],
    ['the long date from its helper', 'const LONG = fmtLongDate()'],
    ['the age of a day, counted to now', "const AGE = daysSince('2026-01-01')"],
    ['an arrow function called where it is written', 'const MONTH = (() => new Date().getMonth())()'],
    ['a function expression called where it is written', 'const MONTH = (function () { return new Date() })()'],
    ['an async function called where it is written', 'const LOADED = (async () => { await load(); return Date.now() })()'],
    ['a function run through call', 'const MONTH = (function () { return new Date() }).call(null)'],
    ['a function called where it is written, with a default Date as a parameter', 'const MONTH = ((when = new Date()) => when)()'],
    ['a static field of a class', 'class Clock { static started = new Date() }'],
    ['a static block of a class', 'class Clock { static { Clock.at = Date.now() } }'],
  ])('reports %s', (_what, code) => {
    expect(found(code)).not.toEqual([])
  })

  it('reports the line of the reading itself, in a function called where it is written', () => {
    const code = ['const CURRENT_MONTH = (() => {', '  const d = new Date()', '  return d.getMonth()', '})()'].join('\n')
    expect(found(code)).toEqual([{ line: 2, what: 'new Date' }])
  })

  it.each([
    ['a function declaration', 'function today() { return new Date() }'],
    ['an arrow function', 'const today = () => Date.now()'],
    ['a function expression', 'const today = function () { return toLocalDateStr() }'],
    ['a component', 'export default function Page() { const now = new Date(); return <p>{fmtLongDate()}</p> }'],
    ['a lazy initial value', 'function Page() { const [now] = useState(() => new Date()) }'],
    ['a Date as the default of a parameter', 'function age(day, now = new Date()) { return daysSince(day, now) }'],
    ['a method', 'const clock = { today() { return monthKey() } }'],
    ['a getter', 'const clock = { get now() { return Date.now() } }'],
    ['a method of a class', 'class Clock { now() { return new Date() } }'],
    ['a field of a class that is not static', 'class Clock { started = new Date() }'],
    ['a helper given the time', 'const MONTH = monthKey(someDate)'],
    ['the age of a day given the time', 'const AGE = daysSince(day, now)'],
    ['the days between two days', 'const GAP = daysBetween(first, second)'],
    ['a name that only looks like a clock', 'const when = new Dates(); const x = Date.nowish()'],
    ['an import of a helper', "import { toLocalDateStr, monthKey } from './dates'"],
  ])('leaves alone %s', (_what, code) => {
    expect(found(code)).toEqual([])
  })
})
