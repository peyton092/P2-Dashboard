import { describe, it, expect, vi, beforeEach } from 'vitest'

// The error logger is the logger of last resort: it writes a line to error_logs for an error
// the app did not handle, and it must never throw or show anything of its own. logError is how
// code that handles an error itself, such as useMutation, still puts it in the log. The setup
// file replaces the module in every other test, so this one loads the real one.
const mocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn((db, name) => ({ db, name })),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
  auth: { currentUser: { email: 'pm@p2.test' } },
}))

vi.mock('firebase/firestore', () => ({
  addDoc: mocks.addDoc,
  collection: mocks.collection,
  serverTimestamp: mocks.serverTimestamp,
}))
vi.mock('../../firebase', () => ({ db: { name: 'the database' }, auth: mocks.auth }))

const { logError } = await vi.importActual('../errorLogger')

beforeEach(() => {
  mocks.addDoc.mockReset()
  mocks.addDoc.mockResolvedValue({ id: 'log1' })
  mocks.auth.currentUser = { email: 'pm@p2.test' }
})

const written = () => mocks.addDoc.mock.calls.map(([, data]) => data)

describe('logError', () => {
  it('writes one line to error_logs, with what the error says, where it came from and who was there', () => {
    const error = new Error('Missing or insufficient permissions.')
    logError(error, 'mutation')

    expect(mocks.addDoc).toHaveBeenCalledTimes(1)
    expect(mocks.collection).toHaveBeenCalledWith({ name: 'the database' }, 'error_logs')
    expect(written()[0]).toEqual({
      message: 'Missing or insufficient permissions.',
      stack: error.stack,
      source: 'mutation',
      userEmail: 'pm@p2.test',
      url: window.location.href,
      timestamp: 'SERVER_TIME',
    })
  })

  it('says unknown when it is not told the source, and anonymous when nobody is signed in', () => {
    mocks.auth.currentUser = null
    logError(new Error('No.'))
    expect(written()[0]).toMatchObject({ source: 'unknown', userEmail: 'anonymous' })
  })

  it.each([
    ['a string', 'boom', 'boom'],
    ['a number', 42, '42'],
    ['nothing', undefined, 'undefined'],
    ['null', null, 'null'],
  ])('logs %s that was thrown in place of an error', (_name, thrown, message) => {
    logError(thrown, 'mutation')
    expect(written()[0]).toMatchObject({ message, stack: '' })
  })

  it('keeps a long message and stack to the lengths the log takes', () => {
    const error = new Error('x'.repeat(2000))
    error.stack = 'y'.repeat(5000)
    logError(error, 'mutation')
    expect(written()[0].message).toHaveLength(1000)
    expect(written()[0].stack).toHaveLength(3000)
  })

  it('gives back nothing, and does not throw, when the write is refused', async () => {
    mocks.addDoc.mockRejectedValue(new Error('Missing or insufficient permissions.'))
    expect(logError(new Error('No.'), 'mutation')).toBeUndefined()
    // A rejection nobody handles fails the run, so waiting for it to settle is the check.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('does not throw when the write fails before it starts, or when the database is not there', () => {
    mocks.addDoc.mockImplementation(() => { throw new Error('Firestore is not set up.') })
    expect(() => logError(new Error('No.'), 'mutation')).not.toThrow()

    mocks.collection.mockImplementationOnce(() => { throw new Error('No database.') })
    expect(() => logError(new Error('No.'), 'mutation')).not.toThrow()
  })

  it('does not throw for an error whose message cannot be read', () => {
    const hostile = { get message() { throw new Error('Cannot read the message.') } }
    expect(() => logError(hostile, 'mutation')).not.toThrow()
  })
})
