import { describe, it, expect } from 'vitest'
import { callableMessage } from '../callableError'

const FALLBACK = 'Could not save. Check your connection and try again.'

// What the Functions SDK throws: code is 'functions/<code>' and message is the
// text the function sent, or the bare code when no reply reached the browser.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

describe('callableMessage', () => {
  it('shows the sentence a function wrote for people, as it is', () => {
    expect(callableMessage(sdkError('permission-denied', 'You can only act on change orders for your own projects.'), FALLBACK))
      .toBe('You can only act on change orders for your own projects.')
    expect(callableMessage(sdkError('failed-precondition', 'This change order has already been decided.'), FALLBACK))
      .toBe('This change order has already been decided.')
    expect(callableMessage(sdkError('invalid-argument', 'Say what should be revised.'), FALLBACK))
      .toBe('Say what should be revised.')
  })

  it('uses the fallback when the message is only the code the SDK fell back to', () => {
    expect(callableMessage(sdkError('internal', 'internal'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(sdkError('unavailable', 'unavailable'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(sdkError('deadline-exceeded', 'deadline-exceeded'), FALLBACK)).toBe(FALLBACK)
  })

  it('treats the status name the same way, whatever its casing or separator', () => {
    expect(callableMessage(sdkError('internal', 'INTERNAL'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(sdkError('not-found', 'NOT_FOUND'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(sdkError('not-found', 'Not-Found'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(sdkError('deadline-exceeded', 'DEADLINE_EXCEEDED'), FALLBACK)).toBe(FALLBACK)
  })

  it('does not take a sentence for a code just because it mentions one', () => {
    expect(callableMessage(sdkError('internal', 'Internal error while saving'), FALLBACK)).toBe('Internal error while saving')
  })

  it('uses the fallback when there is no message at all', () => {
    expect(callableMessage(sdkError('internal', ''), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(new Error(''), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage({}, FALLBACK)).toBe(FALLBACK)
  })

  it('uses the fallback for something that is not an error', () => {
    for (const thrown of [undefined, null, 'boom', 42, true]) {
      expect(callableMessage(thrown, FALLBACK)).toBe(FALLBACK)
    }
  })

  it('shows the message of an error that has no code, since it was not made by the SDK', () => {
    expect(callableMessage(new Error('You must be signed in.'), FALLBACK)).toBe('You must be signed in.')
    expect(callableMessage(new Error('internal'), FALLBACK)).toBe('internal')
  })
})
