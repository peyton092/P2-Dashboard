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

// The SDK raises the snapshots in sync event once as soon as a listener for it is
// added, before it has anything to say. This plays that for every listener there is.
const theSdkRaisesItsFirstSync = () =>
  act(() => sdk.inSync.filter((listener) => listener.live).forEach((listener) => listener.next()))

// The probe is shared and stops a moment after the last component goes, at the end of
// the task, so that a screen replaced by another does not start it again. This lets
// that moment pass.
const settle = () => act(async () => {})

let online
const goOffline = () => act(() => { online = false; window.dispatchEvent(new Event('offline')) })
const goOnline = () => act(() => { online = true; window.dispatchEvent(new Event('online')) })

beforeEach(async () => {
  // A probe the last test left is stopped a moment after its components were removed.
  // Let that moment pass, so that this test starts a probe of its own.
  await settle()
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

  it('registers no listener of any kind, because there is nothing to ask', () => {
    renderHook(() => useConnectionState())

    expect(sdk.inSync).toHaveLength(0)
    expect(sdk.documents).toHaveLength(0)
  })

  it('is syncing and never online, whatever the SDK raises for the listeners it has', () => {
    const { result } = renderHook(() => useConnectionState())
    expect(result.current).toBe('syncing')

    theSdkRaisesItsFirstSync()

    expect(result.current).toBe('syncing')
  })

  it('goes offline when the browser does, and comes back to syncing', () => {
    const { result } = renderHook(() => useConnectionState())
    expect(result.current).toBe('syncing')

    goOffline()
    expect(result.current).toBe('offline')

    goOnline()
    expect(result.current).toBe('syncing')
  })

  it('reads a provider that has no user the same way', () => {
    session.value = { uid: null }
    const { result } = renderHook(() => useConnectionState())
    theSdkRaisesItsFirstSync()

    expect(result.current).toBe('syncing')
    expect(sdk.documents).toHaveLength(0)
    expect(sdk.inSync).toHaveLength(0)
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

  // The SDK calls the error callback of a refused listener and drops the listener. It
  // raises no in sync event after that, so nothing but the probe can settle the state.
  // The SDK delivers a snapshot and the in sync event after it as two tasks, so React
  // commits between them. When the server changes the person's own document the chip must
  // not go Live, Syncing, Live, which the status region would read out each time.
  it('stays online when the server sends another snapshot of the user document', () => {
    const seen = []
    const { result } = renderHook(() => {
      const state = useConnectionState()
      seen.push(state)
      return state
    })
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')
    seen.length = 0

    documentIs(false)
    expect(result.current).toBe('online')
    everyoneCaughtUp()
    expect(result.current).toBe('online')

    expect(seen).not.toContain('syncing')
  })

  it('stays online through a write that the server has sent back, a snapshot and then another', () => {
    const seen = []
    const { result } = renderHook(() => {
      const state = useConnectionState()
      seen.push(state)
      return state
    })
    documentIs(false)
    everyoneCaughtUp()
    seen.length = 0

    documentIs(false, true)
    everyoneCaughtUp()
    documentIs(false, false)
    everyoneCaughtUp()

    expect(result.current).toBe('online')
    expect(seen).not.toContain('syncing')
  })

  it('reads syncing as soon as a snapshot comes from the cache, and until the server answers again', () => {
    const { result } = renderHook(() => useConnectionState())
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')

    documentIs(true)
    expect(result.current).toBe('syncing')
    everyoneCaughtUp()
    expect(result.current).toBe('syncing')

    documentIs(false)
    expect(result.current).toBe('syncing')
    everyoneCaughtUp()
    expect(result.current).toBe('online')
  })

  it('takes a refused listener as an answer from the server, and settles without help from the SDK', () => {
    const { result } = renderHook(() => useConnectionState())
    expect(result.current).toBe('syncing')

    act(() => liveDocument().error(new Error('permission-denied')))

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

  it('listens again for another user, and does not carry the first user answer over', async () => {
    const { result, rerender } = renderHook(() => useConnectionState())
    documentIs(false)
    everyoneCaughtUp()
    expect(result.current).toBe('online')
    const [first] = sdk.documents

    session.value = { uid: 'user-2' }
    rerender()
    await settle()

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

  it('stops listening when the component goes away', async () => {
    const { unmount } = renderHook(() => useConnectionState())
    expect(liveDocument()).toBeDefined()
    expect(liveInSync()).toBeDefined()

    unmount()
    await settle()

    expect(sdk.documents.every((listener) => !listener.live)).toBe(true)
    expect(sdk.inSync.every((listener) => !listener.live)).toBe(true)
  })

  // Each page header has a chip and each screen is a new component. A probe of a chip's
  // own would start from nothing on every navigation, read the cached copy of the
  // document first, and show Syncing until the server answered.
  describe('sharing the probe between screens', () => {
    it('starts one probe for the components that ask, and tells each of them what it hears', () => {
      const first = renderHook(() => useConnectionState())
      const second = renderHook(() => useConnectionState())
      expect(sdk.documents).toHaveLength(1)
      expect(sdk.inSync).toHaveLength(1)

      documentIs(false)
      everyoneCaughtUp()

      expect(first.result.current).toBe('online')
      expect(second.result.current).toBe('online')
    })

    it('starts a component that arrives later from what is already known, so that it never shows Syncing', () => {
      renderHook(() => useConnectionState())
      documentIs(false)
      everyoneCaughtUp()

      const seen = []
      renderHook(() => {
        const state = useConnectionState()
        seen.push(state)
        return state
      })

      expect(seen.length).toBeGreaterThan(0)
      expect(seen.every((state) => state === 'online')).toBe(true)
    })

    it('keeps the probe running when one screen replaces another', async () => {
      const screen = renderHook(() => useConnectionState())
      documentIs(false)
      everyoneCaughtUp()

      // The old screen unmounts and the new one mounts in the same commit.
      screen.unmount()
      const next = renderHook(() => useConnectionState())
      await settle()

      expect(sdk.documents).toHaveLength(1)
      expect(liveDocument()).toBeDefined()
      expect(next.result.current).toBe('online')
    })

    it('stops the probe when the last component has gone, and not before', async () => {
      const first = renderHook(() => useConnectionState())
      const second = renderHook(() => useConnectionState())

      first.unmount()
      await settle()
      expect(liveDocument()).toBeDefined()
      expect(liveInSync()).toBeDefined()

      second.unmount()
      await settle()
      expect(liveDocument()).toBeUndefined()
      expect(liveInSync()).toBeUndefined()
    })

    it('starts again from nothing for a component that asks after the probe was stopped', async () => {
      const first = renderHook(() => useConnectionState())
      documentIs(false)
      everyoneCaughtUp()
      first.unmount()
      await settle()

      const again = renderHook(() => useConnectionState())

      expect(sdk.documents).toHaveLength(2)
      expect(again.result.current).toBe('syncing')
    })
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

  // The SDK raises no in sync event after a refusal, so the probe reports the one that
  // its contract promises after a snapshot.
  it('reports a refusal as a snapshot the server sent, and then that the listeners are in sync', () => {
    const onChange = vi.fn()
    probeConnection(database, 'user-1', onChange)

    liveDocument().error(new Error('permission-denied'))

    expect(onChange.mock.calls).toEqual([
      [{ type: 'snapshot', fromCache: false }],
      [{ type: 'sync' }],
    ])
  })

  it('reads the document of the user it is given', () => {
    probeConnection(database, 'user-9', vi.fn())

    expect(sdk.documents.map((listener) => listener.ref.path)).toEqual(['users/user-9'])
    expect(sdk.inSync).toHaveLength(1)
  })

  it('registers nothing and reports nothing when it is given no user, and its stop does nothing', () => {
    const onChange = vi.fn()
    const stop = probeConnection(database, null, onChange)

    expect(sdk.documents).toHaveLength(0)
    expect(sdk.inSync).toHaveLength(0)
    expect(stop).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stops everything it started', () => {
    const stop = probeConnection(database, 'user-1', vi.fn())

    stop()

    expect(sdk.documents.every((listener) => !listener.live)).toBe(true)
    expect(sdk.inSync.every((listener) => !listener.live)).toBe(true)
  })
})
