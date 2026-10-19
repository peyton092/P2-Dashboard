import { expect, vi } from 'vitest'
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

// The error logger writes to Firestore, which a test must never reach. useMutation reports
// every failed write to it, so every screen test would load the real one, and with it the real
// Firebase app. A test that wants to see what was logged reads these spies, and the test of
// the logger itself loads the real module with vi.importActual.
vi.mock('@/lib/errorLogger', () => ({ logError: vi.fn(), initErrorLogger: vi.fn() }))
