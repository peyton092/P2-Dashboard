import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// errorLogger imports firebase + addDoc — stub them out before the module
// runs so the test never touches the real network.
const addDocMock = vi.fn(() => Promise.resolve())
vi.mock('firebase/firestore', () => ({
  addDoc: addDocMock,
  collection: (...args) => ({ path: args[1] }),
  serverTimestamp: () => '__SERVER__',
}))
vi.mock('../firebase', () => ({
  db: { __stub: true },
  auth: { currentUser: { email: 'jesse@p2.test' } },
}))

const { initErrorLogger, logError } = await import('./errorLogger')

describe('initErrorLogger', () => {
  let originalHref
  beforeEach(() => {
    addDocMock.mockClear()
    originalHref = window.location.href
  })
  afterEach(() => {
    // Strip listeners to avoid contaminating later tests.
    const noop = () => {}
    window.addEventListener('error', noop)
    window.addEventListener('unhandledrejection', noop)
  })

  it('writes a log entry on window.error', async () => {
    initErrorLogger()
    const event = new ErrorEvent('error', {
      message: 'Boom!',
      filename: 'app.js',
      error: new Error('Boom!'),
    })
    window.dispatchEvent(event)
    // Allow the addDoc promise to enqueue.
    await Promise.resolve()
    expect(addDocMock).toHaveBeenCalledTimes(1)
    const payload = addDocMock.mock.calls[0][1]
    expect(payload.message).toBe('Boom!')
    expect(payload.userEmail).toBe('jesse@p2.test')
    expect(payload.url).toBe(originalHref)
    expect(payload.timestamp).toBe('__SERVER__')
  })

  it('writes a log entry on unhandledrejection', async () => {
    initErrorLogger()
    const reason = new Error('Async fail')
    const event = new Event('unhandledrejection')
    event.reason = reason
    window.dispatchEvent(event)
    await Promise.resolve()
    const lastCall = addDocMock.mock.calls[addDocMock.mock.calls.length - 1][1]
    expect(lastCall.message).toBe('Async fail')
    expect(lastCall.source).toBe('unhandledrejection')
  })

  it('logError() writes an entry tagged with the supplied source', async () => {
    const err = new Error('upload exploded')
    err.stack = 'at uploadOne (JobDetail.jsx:181)'
    logError('jobDetail.uploadFile', err)
    await Promise.resolve()
    const payload = addDocMock.mock.calls[addDocMock.mock.calls.length - 1][1]
    expect(payload.source).toBe('jobDetail.uploadFile')
    expect(payload.message).toBe('upload exploded')
    expect(payload.stack).toContain('uploadOne')
  })

  it('logError() falls back to a stringified value when err is not an Error', async () => {
    logError('client.uploadFile', 'plain string failure')
    await Promise.resolve()
    const payload = addDocMock.mock.calls[addDocMock.mock.calls.length - 1][1]
    expect(payload.source).toBe('client.uploadFile')
    expect(payload.message).toBe('plain string failure')
  })

  it('truncates extremely long messages + stacks', async () => {
    initErrorLogger()
    const huge = 'X'.repeat(5000)
    const event = new ErrorEvent('error', {
      message: huge,
      filename: 'big.js',
      error: { message: huge, stack: huge },
    })
    window.dispatchEvent(event)
    await Promise.resolve()
    const payload = addDocMock.mock.calls[addDocMock.mock.calls.length - 1][1]
    expect(payload.message.length).toBeLessThanOrEqual(1000)
    expect(payload.stack.length).toBeLessThanOrEqual(3000)
  })
})
