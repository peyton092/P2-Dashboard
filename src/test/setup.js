import { expect } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'

// Vitest runs this before every test file, through setupFiles in
// vitest.config.js, and before that file's own imports.

// toHaveNoViolations, for the accessibility tests.
expect.extend(axeMatchers)

// jsdom says its vendor is Apple, so Base UI takes it for Safari and shows its
// focus guards to VoiceOver as buttons with no name. Chrome hides them. Base UI
// reads the vendor once when it loads, so this has to run before anything
// imports it.
if (typeof window !== 'undefined') {
  Object.defineProperty(window.navigator, 'vendor', { value: 'Google Inc.', configurable: true })
}
