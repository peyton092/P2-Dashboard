import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// The rule is that a color is written in src/lib/tokens.js or src/index.css and
// nowhere else. The screens have not all caught up, so this test counts the hex
// colors outside those two files and holds the count to a budget.
//
// The budget is what was left when the status vocabulary (src/lib/status.js)
// took over the status colors. It only goes down. A task that removes hex colors
// from a file lowers BUDGET to the new count in the same change, which the second
// test insists on, so the count cannot climb back. Task 12 of the plan brings it
// to zero, and from then on the rule is simply that no file outside the two token
// files spells out a hex color.
//
// What counts is a six digit color. An eight digit one, which carries an alpha
// pair, is found by its first six digits and counts once. Three digit colors are
// not counted.
//
// What is not scanned: the two token files, which own the colors, and every file
// under a __tests__ directory, because tests hold hex colors on purpose as inputs
// (src/lib/__tests__/tokenHelpers.test.js hands malformed ones to hexToRgb).
const BUDGET = 160

const srcDir = resolve(import.meta.dirname, '..')
const SCANNED = /\.(?:jsx?|mjs|cjs|tsx?|css|html|svg|json)$/
const OWNERS = ['lib/tokens.js', 'index.css']

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

const name = (file) => relative(srcDir, file).split('\\').join('/')
const isScanned = (file) => {
  const path = name(file)
  return SCANNED.test(path) && !OWNERS.includes(path) && !path.split('/').includes('__tests__')
}

// Every scanned file with the number of hex colors it holds, most first.
function tally() {
  return filesUnder(srcDir)
    .filter(isScanned)
    .map((file) => ({ file: name(file), count: (readFileSync(file, 'utf8').match(/#[0-9a-f]{6}/gi) || []).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
}

describe('hex colors outside the token files', () => {
  const found = tally()
  const total = found.reduce((sum, { count }) => sum + count, 0)
  const where = found.slice(0, 12).map(({ file, count }) => `${file} ${count}`).join(', ')

  it('finds the source files it is meant to scan, and leaves out the token files and the tests', () => {
    const scanned = filesUnder(srcDir).filter(isScanned).map(name)
    expect(scanned.length).toBeGreaterThan(60)
    for (const expected of ['App.jsx', 'components/shared/badges.jsx', 'lib/status.js']) {
      expect(scanned, expected).toContain(expected)
    }
    for (const left of ['lib/tokens.js', 'index.css', 'lib/__tests__/tokenHelpers.test.js', '__tests__/hex-literals.test.js']) {
      expect(scanned, left).not.toContain(left)
    }
  })

  it('does not exceed the budget', () => {
    expect(total, `${total} hex colors against a budget of ${BUDGET}. Most: ${where}`).toBeLessThanOrEqual(BUDGET)
  })

  it('has a budget that is the count left, so that it keeps falling', () => {
    expect(total, `only ${total} left: lower BUDGET to ${total}`).toBeGreaterThanOrEqual(BUDGET)
  })

  it('holds none in the files that own the status vocabulary', () => {
    const owners = ['lib/status.js', 'components/shared/badges.jsx', 'components/shared/inline-edits.jsx']
    expect(found.filter(({ file }) => owners.includes(file))).toEqual([])
  })
})
