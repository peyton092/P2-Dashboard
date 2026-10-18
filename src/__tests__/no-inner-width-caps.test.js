import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// AppShell is the one place that limits how wide a page can be, and it does so only
// above 1800 pixels. A screen that caps and centers its own content inside the shell
// is a narrow column on a wide monitor, whatever the shell does, which is the very
// thing the shell's cap was changed to end. So no screen carries a max-w utility of 3xl
// or wider, and the shell's own cap stays in AppShell.
//
// What is read is the class names in the source: any max-w of 3xl or wider (3xl to 7xl,
// a screen size, or a measure of 768 pixels or more), anywhere under src/components and
// in src/App.jsx. Four things are left out. First, src/components/ui, where the dialog
// and the popups set their own width. Second, a line that takes its element out of the
// page flow with fixed or absolute, which is how a dialog or a popup is drawn. Third,
// AppShell itself, which holds the one cap. Fourth, the two portals in ALLOWED, below.

const src = resolve(import.meta.dirname, '..')

// Task 9 replaces the two portals with the shared portal layout and deletes this list.
// Until then each keeps the narrow column it was built with.
const ALLOWED = ['components/QBSBuilderPortal.jsx', 'components/ClientPortal.jsx']

// The shell holds the one cap there is, and AppShell.test.jsx pins it.
const THE_SHELL = 'components/shell/AppShell.jsx'

const NAMED = /(?<![\w-])max-w-(?:3xl|4xl|5xl|6xl|7xl|screen-[a-z0-9]+)(?![\w-])/
const MEASURED = /(?<![\w-])max-w-\[(\d+(?:\.\d+)?)(px|rem)\]/g
const OUT_OF_FLOW = /(?<![\w-])(?:fixed|absolute)(?![\w-])/
const WIDE_PIXELS = 768 // max-w-3xl, which is 48rem

const isCap = (line) => {
  if (OUT_OF_FLOW.test(line)) return false
  if (NAMED.test(line)) return true
  return [...line.matchAll(MEASURED)].some(([, size, unit]) => Number(size) * (unit === 'rem' ? 16 : 1) >= WIDE_PIXELS)
}

const sourcesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesUnder(path)
    return /\.jsx?$/.test(entry.name) ? [path] : []
  })

const scanned = [...sourcesUnder(join(src, 'components')), join(src, 'App.jsx')]
  .map((path) => ({
    name: relative(src, path).split('\\').join('/'),
    lines: readFileSync(path, 'utf8').split('\n'),
  }))
  .filter(({ name }) => !name.startsWith('components/ui/') && name !== THE_SHELL)

const capsIn = ({ name, lines }) =>
  lines.flatMap((text, index) => (isCap(text) ? [`${name}:${index + 1}  ${text.trim()}`] : []))

describe('the shell is the only width cap', () => {
  it('finds the screens it is meant to read', () => {
    const names = scanned.map(({ name }) => name)
    for (const expected of [
      'App.jsx',
      'components/Analytics.jsx',
      'components/InvoiceAuditor.jsx',
      'components/TeamLeaderboard.jsx',
      'components/BillingQueue.jsx',
      ...ALLOWED,
    ]) {
      expect(names, expected).toContain(expected)
    }
    expect(names).not.toContain(THE_SHELL)
    expect(names.filter((name) => name.startsWith('components/ui/'))).toEqual([])
  })

  it('has no screen that caps its own width, and a failure names the file and the line', () => {
    const offenders = scanned.filter(({ name }) => !ALLOWED.includes(name)).flatMap(capsIn)
    expect(offenders).toEqual([])
  })

  it.each(ALLOWED)('still finds the cap that %s is excused for, so the list is cut down when it goes', (name) => {
    const file = scanned.find((candidate) => candidate.name === name)
    expect(capsIn(file).length, `${name} no longer caps its width, so take it off ALLOWED`).toBeGreaterThan(0)
  })
})

describe('what counts as a cap', () => {
  it.each([
    'p-6 space-y-6 max-w-7xl mx-auto',
    'space-y-6 max-w-5xl',
    'flex-1 px-4 max-w-3xl w-full mx-auto',
    'max-w-4xl',
    'md:max-w-6xl',
    'max-w-screen-xl',
    'max-w-[1100px]',
    'max-w-[60rem]',
    'min-[1800px]:max-w-[1760px]',
  ])('is one: %s', (line) => {
    expect(isCap(line)).toBe(true)
  })

  it.each([
    'max-w-sm',
    'max-w-md',
    'max-w-lg',
    'max-w-xl',
    'max-w-2xl',
    'max-w-full',
    'max-w-none',
    'max-w-[180px]',
    'max-w-[60%]',
    'max-w-[24rem]',
    'text-zinc-100 truncate max-w-[280px]',
    'w-full px-4 sm:px-6 mx-auto',
  ])('is not one: %s', (line) => {
    expect(isCap(line)).toBe(false)
  })

  it.each([
    'fixed inset-0 max-w-4xl',
    'absolute top-0 left-0 max-w-5xl',
    'sm:fixed max-w-7xl',
  ])('leaves a dialog or a popup alone, as it is out of the page flow: %s', (line) => {
    expect(isCap(line)).toBe(false)
  })
})
