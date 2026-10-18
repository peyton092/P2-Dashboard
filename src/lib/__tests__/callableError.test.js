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

// What the Firestore SDK throws: code is the bare code ('permission-denied'), and the message
// was written for developers ("Missing or insufficient permissions.", "No document to update:
// jobs/abc"). A person is never shown that. A few codes have a plain sentence, and every other
// code gets the fallback.
const firestoreError = (code, message) => Object.assign(new Error(message), { code })

describe('callableMessage for a Firestore error', () => {
  it.each([
    ['permission-denied', 'You do not have permission to do that.'],
    ['unauthenticated', 'Sign in again and try once more.'],
    ['unavailable', 'Could not reach the server. Try again.'],
    ['deadline-exceeded', 'Could not reach the server. Try again.'],
    ['not-found', 'That record is no longer there.'],
    ['already-exists', 'That record already exists.'],
    ['failed-precondition', 'That cannot be done right now. Refresh the page and try again.'],
    ['resource-exhausted', 'Too many requests right now. Wait a moment and try again.'],
  ])('says %s in plain words', (code, sentence) => {
    expect(callableMessage(firestoreError(code, 'Developer text.'), FALLBACK)).toBe(sentence)
  })

  it.each([
    ['permission-denied', 'Missing or insufficient permissions.'],
    ['not-found', 'No document to update: projects/abc/jobs/xyz'],
    ['failed-precondition', 'The query requires an index. You can create it here: https://console.firebase.google.com/'],
    ['unavailable', 'The service is currently unavailable.'],
  ])('does not show the developer text of a %s error', (code, text) => {
    expect(callableMessage(firestoreError(code, text), FALLBACK)).not.toContain(text)
    expect(callableMessage(firestoreError(code, text), FALLBACK)).not.toBe(text)
  })

  it.each([
    ['invalid-argument'], ['internal'], ['cancelled'], ['aborted'], ['out-of-range'],
    ['unimplemented'], ['data-loss'], ['unknown'],
  ])('shows only the fallback for %s, which has no sentence of its own', (code) => {
    expect(callableMessage(firestoreError(code, 'Some developer text about it.'), FALLBACK)).toBe(FALLBACK)
  })

  it('reads a code whatever its casing or separator', () => {
    expect(callableMessage(firestoreError('PERMISSION_DENIED', 'Developer text.'), FALLBACK)).toBe('You do not have permission to do that.')
    expect(callableMessage(firestoreError('Not-Found', 'Developer text.'), FALLBACK)).toBe('That record is no longer there.')
  })

  it('shows only the fallback for other Firebase errors too, such as sign in and storage', () => {
    expect(callableMessage(firestoreError('auth/wrong-password', 'Firebase: Error (auth/wrong-password).'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(firestoreError('storage/unauthorized', 'User does not have permission to access this object.'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(firestoreError('timeout', 'timeout'), FALLBACK)).toBe(FALLBACK)
  })

  it('still shows the sentence a function wrote, even under a code that has a sentence here', () => {
    expect(callableMessage(sdkError('permission-denied', 'You can only act on change orders for your own projects.'), FALLBACK))
      .toBe('You can only act on change orders for your own projects.')
    expect(callableMessage(sdkError('not-found', 'That change order does not exist.'), FALLBACK))
      .toBe('That change order does not exist.')
  })

  it('still gives the fallback for a function error that is only its code', () => {
    expect(callableMessage(sdkError('permission-denied', 'permission-denied'), FALLBACK)).toBe(FALLBACK)
    expect(callableMessage(sdkError('unavailable', 'unavailable'), FALLBACK)).toBe(FALLBACK)
  })

  it('still shows the message of an error that has no code, which is not the SDK\'s', () => {
    expect(callableMessage(new Error('You must be signed in.'), FALLBACK)).toBe('You must be signed in.')
  })
})
