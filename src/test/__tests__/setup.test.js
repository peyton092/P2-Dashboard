import { describe, it, expect } from 'vitest'

// This file registers nothing and stubs nothing. What it finds is what
// src/test/setup.js, loaded through vitest.config.js, did for every test file.
describe('the shared test setup', () => {
  it('registers the axe matchers, so a test does not have to', () => {
    expect(typeof expect(document.body).toHaveNoViolations).toBe('function')
  })

  it('reports a Chrome vendor before Base UI reads it', () => {
    expect(window.navigator.vendor).toBe('Google Inc.')
  })
})
