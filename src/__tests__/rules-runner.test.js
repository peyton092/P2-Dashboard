import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The rules test files share one emulator and each clears its data between
// tests, so they must not run in parallel: one file's clearFirestore() would
// wipe the fixtures another file had just seeded, which shows up as a test that
// passes alone and fails in the full run.
const runner = readFileSync(resolve(import.meta.dirname, '../../scripts/run-rules-tests.mjs'), 'utf8')

describe('scripts/run-rules-tests.mjs', () => {
  it('runs the rules test files one at a time', () => {
    expect(runner).toContain("'node --test --test-concurrency=1 tests/rules/*.test.mjs'")
  })
})
