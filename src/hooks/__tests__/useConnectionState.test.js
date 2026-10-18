import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Firestore is replaced by two lists of the listeners it would hold, so that a test
// can play the server: call a listener, and the hook hears what the SDK would say.
// Nothing here waits for time, a frame or a network, and the browser's own online
// state is a variable the test sets and announces.
const sdk = vi.hoisted(() => ({ documents: [], inSync: [] }))
const session = vi.hoisted(() => ({ value: null }))

vi.mock('firebase/firestore', () => ({
  doc: (database, ...path) => ({ database, path: path.join('/') }),
  onSnapshot: (ref, options, next, error) => {
    const listener = { ref, options, next, error, live: true }
    sdk.documents.push(listener)
    return () => { listener.live = false }
  },
  onSnapshotsInSync: (database, next) => {
    const listener = { database, next, live: true }
    sdk.inSync.push(listener)
    return () => { listener.live = false }
  },
}))
vi.mock('../../firebase', () => ({ db: { name: 'the database' } }))
vi.mock('../../use-data', () => ({ useData: () => session.value }))

import { useConnectionState, probeConnection } from '../useConnectionState'

const SIGNED_IN = { uid: 'user-1' }

const liveDocument = () => sdk.documents.filter((listener) => listener.live).at(-1)
const liveInSync = () => sdk.inSync.filter((listener) => listener.live).at(-1)

// The user's document, as the SDK reports it: whether the copy came from the cache,
// and whether a write to it waits to be sent.
const documentIs = (fromCache, hasPendingWrites = false) =>
  act(() => liveDocument().next({ metadata: { fromCache, hasPendingWrites } }))
// Every listener has seen the change. The SDK says so after each change.
const everyoneCaughtUp = () => act(() => liveInSync().next())

let online
const goOffline = () => act(() => { online = false; window.dispatchEvent(new Event('offline')) })
const goOnline = () => act(() => { online = true; window.dispatchEvent(new Event('online')) })

beforeEach(() => {
  sdk.documents.length = 0
  sdk.inSync.length = 0
  session.value = null
  online = true
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete window.navigator.onLine
})

describe('useConnectionState with nobody signed in', () => {
  it('is offline when the browser is offline', () => {
    online = false
    const { result } = renderHook(() => useConnectionState())

    expect(result.current).toBe('offline')
  })

  it('is syncing until the listeners are in sync, and online after that', () => {
    const { result } = renderHook(() => useConnectionState())
    expect(result.current).toBe('syncing')

    everyoneCaughtUp()

    expect(result.current).toBe('online')
  })

  it('listens for being in sync and reads no document', () => {
    renderHook(() => useConnectionState())

    expect(sdk.inSync).toHaveLength(1)
    expect(sdk.inSync[0].database).toEqual({ name: 'the database' })
    expect(sdk.documents).toHaveLength(0)
  })

  it('goes offline and comes back as the browser does', () => {
    const { result } = renderHook(() => useConnectionState())
    everyoneCaughtUp()
    expect(result.current).toBe('online')

    goOffline()
    expect(result.current).toBe('offline')

    goOnline()
    expect(result.current).toBe('online')
  })

  it('reads a provider that has no user the same way', () => {
    session.value = { uid: null }
    const { result } = renderHook(() => useConnectionState())
    everyoneCaughtUp()

    expect(result.current).toBe('online')
    expect(sdk.documents).toHaveLength(0)
  })
})

describe('useConnectionState with a signed in user', () => {
  beforeEach(() => {
    session.value = SIGNED_IN
  })

  it('listens to the user document with metadata changes, and to no other document', () => {
    renderHook(() => useConnectionState())

    expect(sdk.documents.map((listener) => listener.ref.path)).toEqual(['users/user-1'])
    expect(sdk.documents[0].options).toEqual({ includeMetadataChanges: true })
    expect(sdk.inSync).toHaveLength(1)
  })

  it('stays syncing until the server has answered for the document and the listeners are in sync', () => {
    const { result } = renderHook(() => useConnectionState())
    expect(result.current).toBe('syncing')

    // The SDK says "in sync" as soon as it is asked, before any snapshot has come.
    everyoneCaughtUp()
    expect(result.current).toBe('syncing')

    // The copy in the cache comes first, then the answer of the server.
    documentIs(true)
    everyoneCaughtUp()
    expect(result.current).toBe('syncing')

    documentIs(false)
    expect(result.current).toBe('syncing')

    everyoneCaughtUp()
    expect(result.current).toBe('online')
  })

  it('is syncing while a write waits in the cache, and online once it has been sent', () => {
    const { result } = renderHook(() => useConnectionState())
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')

    documentIs(true, true)
    everyoneCaughtUp()
    expect(result.current).toBe('syncing')

    documentIs(false, false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')
  })

  it('is syncing when the document came from the cache and no write waits, as when the connection is gone but the browser says it is online', () => {
    const { result } = renderHook(() => useConnectionState())
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')

    documentIs(true, false)
    everyoneCaughtUp()

    expect(result.current).toBe('syncing')
  })

  it('takes a refused listener as an answer from the server', () => {
    const { result } = renderHook(() => useConnectionState())

    act(() => liveDocument().error(new Error('permission-denied')))
    everyoneCaughtUp()

    expect(result.current).toBe('online')
  })

  it('follows a drop and a return of the connection', () => {
    const { result } = renderHook(() => useConnectionState())
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')

    goOffline()
    documentIs(true)
    everyoneCaughtUp()
    expect(result.current).toBe('offline')

    // The browser is back before the SDK has reconnected.
    goOnline()
    expect(result.current).toBe('syncing')

    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')
  })

  it('is offline when the browser is offline, whatever the server last said', () => {
    online = false
    const { result } = renderHook(() => useConnectionState())

    documentIs(false)
    everyoneCaughtUp()

    expect(result.current).toBe('offline')
  })

  it('listens again for another user, and does not carry the first user answer over', () => {
    const { result, rerender } = renderHook(() => useConnectionState())
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')
    const [first] = sdk.documents

    session.value = { uid: 'user-2' }
    rerender()

    expect(first.live).toBe(false)
    expect(liveDocument().ref.path).toBe('users/user-2')
    expect(result.current).toBe('syncing')

    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')
  })

  it('does not listen again when it renders again', () => {
    const { rerender } = renderHook(() => useConnectionState())

    rerender()
    rerender()
    rerender()

    expect(sdk.documents).toHaveLength(1)
    expect(sdk.inSync).toHaveLength(1)
  })

  it('stops listening when the component goes away', () => {
    const { unmount } = renderHook(() => useConnectionState())
    expect(liveDocument()).toBeDefined()
    expect(liveInSync()).toBeDefined()

    unmount()

    expect(sdk.documents.every((listener) => !listener.live)).toBe(true)
    expect(sdk.inSync.every((listener) => !listener.live)).toBe(true)
  })

  it('stops listening to the browser when the component goes away', () => {
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useConnectionState())
    const heard = added.mock.calls.filter(([type]) => type === 'online' || type === 'offline')
    expect(heard.map(([type]) => type).sort()).toEqual(['offline', 'online'])

    unmount()

    for (const [type, listener] of heard) expect(removed).toHaveBeenCalledWith(type, listener)
  })
})

// probeConnection is the one place that talks to Firestore. The demo build swaps it
// for a probe of the local store, so what it reports is a contract of its own.
describe('probeConnection', () => {
  const database = { name: 'the database' }

  it('reports each snapshot of the user document by whether it came from the cache', () => {
    const onChange = vi.fn()
    probeConnection(database, 'user-1', onChange)

    liveDocument().next({ metadata: { fromCache: true, hasPendingWrites: true } })
    liveDocument().next({ metadata: { fromCache: false, hasPendingWrites: false } })

    expect(onChange.mock.calls).toEqual([
      [{ type: 'snapshot', fromCache: true }],
      [{ type: 'snapshot', fromCache: false }],
    ])
  })

  it('reports every time the listeners are in sync', () => {
    const onChange = vi.fn()
    probeConnection(database, 'user-1', onChange)

    liveInSync().next()
    liveInSync().next()

    expect(onChange.mock.calls).toEqual([[{ type: 'sync' }], [{ type: 'sync' }]])
  })

  it('reports a refusal as a snapshot the server sent', () => {
    const onChange = vi.fn()
    probeConnection(database, 'user-1', onChange)

    liveDocument().error(new Error('permission-denied'))

    expect(onChange.mock.calls).toEqual([[{ type: 'snapshot', fromCache: false }]])
  })

  it('reads the document of the user it is given, and none when it is given no user', () => {
    probeConnection(database, 'user-9', vi.fn())
    probeConnection(database, null, vi.fn())

    expect(sdk.documents.map((listener) => listener.ref.path)).toEqual(['users/user-9'])
    expect(sdk.inSync).toHaveLength(2)
  })

  it('stops everything it started', () => {
    const stop = probeConnection(database, 'user-1', vi.fn())

    stop()

    expect(sdk.documents.every((listener) => !listener.live)).toBe(true)
    expect(sdk.inSync.every((listener) => !listener.live)).toBe(true)
  })
})
