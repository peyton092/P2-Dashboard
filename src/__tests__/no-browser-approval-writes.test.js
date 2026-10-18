import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Sending, approving and rejecting change orders, recording inspection results
// and creating jobs are done by Cloud Functions that check the caller's role and
// write the notification and the history entry with the change. If the browser
// writes any of it again, a builder or a client is back to deciding for itself
// what the database says, so these structural guards keep the pieces that made
// that possible from coming back. How the screens behave around those calls is
// tested where it happens: ExtraApprovals, ChangeOrdersSave and JobActions.
const srcDir = resolve(import.meta.dirname, '..')

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

const files = sourceFiles(srcDir)
const read = (name) => readFileSync(files.find((f) => f.endsWith(name)), 'utf8')

// The source of one top level function declaration, from its first line to the
// closing brace in the first column.
function functionSource(text, name) {
  const start = text.search(new RegExp(`^(export )?(async )?function ${name}\\(`, 'm'))
  if (start === -1) return null
  return text.slice(start, text.indexOf('\n}\n', start) + 2)
}

// What a file imports from a module, as a list of names.
function importsFrom(text, module) {
  const names = []
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (match[2] === module) names.push(...match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean))
  }
  return names
}

describe('browser code', () => {
  it('finds the source files it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(20)
    for (const name of ['useFirestore.js', 'ClientPortal.jsx', 'QBSBuilderPortal.jsx']) {
      expect(files.some((f) => f.endsWith(name)), name).toBe(true)
    }
  })

  it('has no helper named sendExtraToQBS any more', () => {
    const offenders = files.filter((f) => /sendExtraToQBS/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => f.slice(srcDir.length + 1))).toEqual([])
  })

  describe('the six callable helpers', () => {
    const SIX = ['sendExtraToBuilder', 'approveExtra', 'rejectExtra', 'passInspection', 'failInspection', 'createJob']

    it.each(SIX)('%s catches nothing and writes nothing to Firestore, so a failed call reaches the caller', (name) => {
      const source = functionSource(read('useFirestore.js'), name)
      expect(source, `${name} is declared in useFirestore.js`).not.toBeNull()
      expect(source).not.toMatch(/\bcatch\b/)
      expect(source).not.toMatch(/\b(addDoc|updateDoc|setDoc|deleteDoc|writeBatch|runTransaction|serverTimestamp)\b/)
    })

    it('go through one function that does not catch or write either', () => {
      const source = functionSource(read('useFirestore.js'), 'callCloud')
      expect(source, 'callCloud is declared in useFirestore.js').not.toBeNull()
      expect(source).toMatch(/\bhttpsCallable\b/)
      expect(source).not.toMatch(/\bcatch\b/)
      expect(source).not.toMatch(/\b(addDoc|updateDoc|setDoc|deleteDoc|writeBatch|runTransaction|serverTimestamp)\b/)
    })

    it('leave no browser helper that writes a change order, a notification or an inspection record', () => {
      const text = read('useFirestore.js')
      for (const gone of ['updateExtra', 'addNotification', 'updateInspection']) {
        expect(text, gone).not.toMatch(new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${gone}\\b`))
      }
    })
  })

  describe.each(['ClientPortal.jsx', 'QBSBuilderPortal.jsx'])('%s', (name) => {
    it('imports no Firestore write for change orders, notifications or history', () => {
      const text = read(name)
      const fromHelpers = importsFrom(text, '../hooks/useFirestore')
      for (const writer of ['updateExtra', 'addExtra', 'addNotification', 'addHistory', 'updateInspection']) {
        expect(fromHelpers, writer).not.toContain(writer)
      }
      expect(importsFrom(text, 'firebase/firestore'), 'firebase/firestore').toEqual([])
    })
  })
})
