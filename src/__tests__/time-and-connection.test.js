import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Three habits made the app say something untrue, and this test keeps each of them out
// of the production source.
//
// 1. A Date made when a file loads. It is the time the tab opened, so a tab left open
//    overnight, or all week, keeps showing that day. Time is read when something
//    renders (useNow) or inside a function that takes it as an argument.
// 2. A day cut out of an ISO string. An ISO string is in UTC, so in the evening in
//    Tennessee it already names tomorrow. A day is named in the local zone by
//    toLocalDateStr, and a month by monthKey, both in src/lib/dates.js.
// 3. A dot that says Live and nothing else. It is true when the app is offline too.
//    The connection chip reads the real state, and it is the only place the word is
//    written.
//
// Files under a __tests__ directory are not scanned: they hold these patterns on
// purpose as inputs.

const srcDir = resolve(import.meta.dirname, '..')

function sourcesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesUnder(path)
    return /\.jsx?$/.test(entry.name) ? [path] : []
  })
}

const sources = sourcesUnder(srcDir).map((file) => ({
  name: relative(srcDir, file).split('\\').join('/'),
  lines: readFileSync(file, 'utf8').split('\n'),
}))

// The file and line of every line that matches, so a failure says where.
const hits = (pattern) =>
  sources.flatMap(({ name, lines }) =>
    lines.flatMap((line, index) => (pattern.test(line) ? [`${name}:${index + 1} ${line.trim()}`] : [])),
  )

describe('time and connection in the source', () => {
  it('finds the source it is meant to scan', () => {
    const names = sources.map(({ name }) => name)
    expect(names.length).toBeGreaterThan(60)
    for (const expected of ['App.jsx', 'lib/dates.js', 'components/shared/ConnectionChip.jsx', 'agent/scoring.js']) {
      expect(names, expected).toContain(expected)
    }
    expect(names.some((name) => name.includes('__tests__'))).toBe(false)
  })

  it('makes no Date or clock reading when a file loads', () => {
    // A line that starts at the left margin is outside every function and component.
    expect(hits(/^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:new Date\(|Date\.now\()/)).toEqual([])
  })

  it('cuts no day or month out of an ISO string', () => {
    expect(hits(/toISOString\(\)\s*\.(?:slice|substring|substr)\(/)).toEqual([])
    expect(hits(/toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/)).toEqual([])
  })

  it('writes the word Live in the connection chip and nowhere else', () => {
    // The word as a string, as the text of an element, and alone on a line of JSX.
    const found = hits(/>\s*Live\s*<|^\s*Live\s*$|'Live'|"Live"/)
    expect(found.map((hit) => hit.split(':')[0])).toEqual(['components/shared/ConnectionChip.jsx'])
  })
})
