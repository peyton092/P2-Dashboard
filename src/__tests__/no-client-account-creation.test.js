import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Accounts are created by the owner only createUser Cloud Function, which also
// sets the role. Creating one from the browser (createUserWithEmailAndPassword,
// or a second Firebase app to do it without signing the owner out) puts the
// choice of role back in the client, so neither may come back.
const srcDir = resolve(import.meta.dirname, '..')

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

describe('browser code', () => {
  const files = sourceFiles(srcDir)

  it('finds the source files it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('App.jsx'))).toBe(true)
    expect(files.some((f) => f.endsWith('firebase.js'))).toBe(true)
  })

  it('never creates an Auth account or a second Firebase app for it', () => {
    const offenders = files.filter((f) => /createUserWithEmailAndPassword|secondaryAuth|secondaryApp/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
