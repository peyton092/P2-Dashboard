import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDemoStore, DEMO_STATE_KEY } from '../store'
import {
  firestoreOver, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  CACHE_SIZE_UNLIMITED, collection, doc, query, where, orderBy, limit,
  onSnapshot, onSnapshotsInSync, getDoc, setDoc, addDoc, updateDoc, serverTimestamp, Timestamp,
} from '../shims/firestore'

// The demo build swaps firebase/firestore for this shim, so every screen reads and
// writes an in memory store. These tests pin the part of the Firestore contract the
// app relies on: the queries it builds, how listeners are called, the write
// semantics, and that the store is kept on the device and can be put back.
//
// Every test runs on fake timers. A listener is first called in a macrotask, and the
// store is saved 250 ms after a write, so the tests move the clock themselves.

// A stand in for localStorage that keeps its strings in a Map and counts the writes.
function memoryStorage() {
  const map = new Map()
  return {
    map,
    writes: 0,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem(key, value) { this.writes += 1; map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

// A storage that refuses every call, like a blocked or full localStorage.
const brokenStorage = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('full') },
  removeItem() { throw new Error('blocked') },
}

const seed = () => ({
  jobs: {
    j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], progress: 40, insp: { electrical: { roughIn: 'passed' } }, createdAt: Timestamp.fromMillis(3000) },
    j2: { id: 'QBS-002', tenantId: 'vision', clientUids: [], progress: 75, insp: { electrical: { roughIn: 'failed' } }, createdAt: Timestamp.fromMillis(1000) },
    j3: { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1', 'c2'], progress: 5, insp: { electrical: { roughIn: 'pending' } }, createdAt: Timestamp.fromMillis(2000) },
    j4: { id: 'QBS-004', tenantId: 'qbs', clientUids: [] },
  },
  'jobs/j1/files': { f1: { name: 'Panel schedule.pdf' } },
  config: { settings: { emailDigests: true, nested: { a: 1, b: 2 } } },
})

let storage
let store
let db

// Runs the macrotask that delivers snapshots, and the microtasks around it.
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0, 0))
  storage = memoryStorage()
  store = createDemoStore({ seed, storage, version: 'test-1' })
  db = firestoreOver(store)
})

afterEach(() => {
  vi.useRealTimers()
})

// The ids a query gives back, in its order, through a listener as the app reads them.
async function idsOf(q) {
  let ids = null
  const stop = onSnapshot(q, (snap) => { ids = snap.docs.map((d) => d.id) })
  await flush()
  stop()
  return ids
}

describe('queries', () => {
  const jobs = () => collection(db, 'jobs')

  it('reads a whole collection in document id order', async () => {
    expect(await idsOf(jobs())).toEqual(['j1', 'j2', 'j3', 'j4'])
  })

  it('filters with ==', async () => {
    expect(await idsOf(query(jobs(), where('tenantId', '==', 'qbs')))).toEqual(['j1', 'j3', 'j4'])
    expect(await idsOf(query(jobs(), where('tenantId', '==', 'p2-core')))).toEqual([])
  })

  it('filters with array-contains', async () => {
    expect(await idsOf(query(jobs(), where('clientUids', 'array-contains', 'c1')))).toEqual(['j1', 'j3'])
    expect(await idsOf(query(jobs(), where('clientUids', 'array-contains', 'c2')))).toEqual(['j3'])
  })

  it('orders by a number in both directions, and leaves out documents without the field as Firestore does', async () => {
    expect(await idsOf(query(jobs(), orderBy('progress')))).toEqual(['j3', 'j1', 'j2'])
    expect(await idsOf(query(jobs(), orderBy('progress', 'desc')))).toEqual(['j2', 'j1', 'j3'])
  })

  it('orders by a string and by a timestamp', async () => {
    expect(await idsOf(query(jobs(), orderBy('id', 'desc')))).toEqual(['j4', 'j3', 'j2', 'j1'])
    expect(await idsOf(query(jobs(), orderBy('createdAt', 'desc')))).toEqual(['j1', 'j3', 'j2'])
    expect(await idsOf(query(jobs(), orderBy('createdAt')))).toEqual(['j2', 'j3', 'j1'])
  })

  it('filters and orders on a nested field path', async () => {
    expect(await idsOf(query(jobs(), where('insp.electrical.roughIn', '==', 'failed')))).toEqual(['j2'])
    expect(await idsOf(query(jobs(), orderBy('insp.electrical.roughIn')))).toEqual(['j2', 'j1', 'j3'])
  })

  it('applies a filter, an order and a limit together', async () => {
    const q = query(jobs(), where('tenantId', '==', 'qbs'), orderBy('createdAt', 'desc'), limit(1))
    expect(await idsOf(q)).toEqual(['j1'])
    expect(await idsOf(query(jobs(), orderBy('progress'), limit(2)))).toEqual(['j3', 'j1'])
  })

  it('reads a subcollection by its path', async () => {
    expect(await idsOf(collection(db, 'jobs', 'j1', 'files'))).toEqual(['f1'])
    expect(await idsOf(collection(doc(db, 'jobs', 'j2'), 'files'))).toEqual([])
  })

  it('refuses a where operator it does not support, naming it, so code that needs one fails here', () => {
    expect(() => where('progress', '>', 10)).toThrow(/>/)
    expect(() => where('id', 'in', ['QBS-001'])).toThrow(/\bin\b/)
    expect(() => where('id', 'array-contains-any', ['x'])).toThrow(/array-contains-any/)
    expect(() => where('id', '!=', 'x')).toThrow(/!=/)
  })
})

describe('listeners', () => {
  it('calls back first in a macrotask, not at once and not in a microtask', async () => {
    const next = vi.fn()
    onSnapshot(collection(db, 'jobs'), next)
    expect(next).not.toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
    expect(next).not.toHaveBeenCalled()
    await flush()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('gives a query snapshot the parts the app reads', async () => {
    let snap
    onSnapshot(query(collection(db, 'jobs'), where('tenantId', '==', 'qbs')), (s) => { snap = s })
    await flush()
    expect(snap.size).toBe(3)
    expect(snap.empty).toBe(false)
    expect(snap.metadata).toMatchObject({ fromCache: false, hasPendingWrites: false })
    const seen = []
    snap.forEach((d) => seen.push(d.id))
    expect(seen).toEqual(['j1', 'j3', 'j4'])
    expect(snap.docs[0].data()).toMatchObject({ id: 'QBS-001', progress: 40 })
    expect(snap.docs[0].ref.path).toBe('jobs/j1')
  })

  it('gives a document snapshot the parts the app reads, for a document there and one that is not', async () => {
    const seen = []
    onSnapshot(doc(db, 'config', 'settings'), (s) => seen.push(s))
    onSnapshot(doc(db, 'users', 'nobody'), { includeMetadataChanges: true }, (s) => seen.push(s))
    await flush()
    const [settings, missing] = seen
    expect(settings.exists()).toBe(true)
    expect(settings.id).toBe('settings')
    expect(settings.ref.path).toBe('config/settings')
    expect(settings.data()).toEqual({ emailDigests: true, nested: { a: 1, b: 2 } })
    expect(settings.metadata).toMatchObject({ fromCache: false, hasPendingWrites: false })
    expect(missing.exists()).toBe(false)
    expect(missing.data()).toBeUndefined()
    expect(missing.metadata.fromCache).toBe(false)
  })

  it('calls back again after a write that changes the result, and not for one that does not', async () => {
    const next = vi.fn()
    onSnapshot(query(collection(db, 'jobs'), where('tenantId', '==', 'qbs')), next)
    await flush()
    expect(next).toHaveBeenCalledTimes(1)

    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 55 })
    await flush()
    expect(next).toHaveBeenCalledTimes(2)
    expect(next.mock.lastCall[0].docs[0].data().progress).toBe(55)

    await updateDoc(doc(db, 'jobs', 'j2'), { progress: 80 })
    await setDoc(doc(db, 'config', 'settings'), { emailDigests: false })
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 55 })
    await flush()
    expect(next).toHaveBeenCalledTimes(2)

    await updateDoc(doc(db, 'jobs', 'j2'), { tenantId: 'qbs' })
    await flush()
    expect(next).toHaveBeenCalledTimes(3)
    expect(next.mock.lastCall[0].docs.map((d) => d.id)).toEqual(['j1', 'j2', 'j3', 'j4'])
  })

  it('calls listeners in the order they started, and the snapshots in sync callback after each round', async () => {
    const calls = []
    onSnapshot(doc(db, 'jobs', 'j1'), () => calls.push('first'))
    onSnapshot(collection(db, 'jobs'), () => calls.push('second'))
    onSnapshotsInSync(db, () => calls.push('in sync'))
    await flush()
    expect(calls).toEqual(['first', 'second', 'in sync'])

    calls.length = 0
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 41 })
    await flush()
    expect(calls).toEqual(['first', 'second', 'in sync'])
  })

  it('stops calling back once unsubscribed, also when that happens before the first call', async () => {
    const before = vi.fn()
    const after = vi.fn()
    const stopBefore = onSnapshot(collection(db, 'jobs'), before)
    stopBefore()
    const stopAfter = onSnapshot(collection(db, 'jobs'), after)
    await flush()
    expect(before).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)

    stopAfter()
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 99 })
    await flush()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('takes the next and error callbacks as an observer too', async () => {
    const observer = { next: vi.fn(), error: vi.fn() }
    onSnapshot(doc(db, 'jobs', 'j1'), observer)
    await flush()
    expect(observer.next).toHaveBeenCalledTimes(1)
    expect(observer.error).not.toHaveBeenCalled()
  })
})

describe('writes', () => {
  it('reads a document with getDoc', async () => {
    const there = await getDoc(doc(db, 'jobs', 'j3'))
    expect(there.exists()).toBe(true)
    expect(there.data().id).toBe('QBS-003')
    const gone = await getDoc(doc(db, 'jobs', 'nope'))
    expect(gone.exists()).toBe(false)
  })

  it('updates dotted field paths without touching the fields beside them', async () => {
    await updateDoc(doc(db, 'jobs', 'j1'), {
      'insp.electrical.roughInDate': '2026-10-19',
      'insp.hvac.final': 'passed',
      'subsStatus.electrical': 'complete',
    })
    const job = (await getDoc(doc(db, 'jobs', 'j1'))).data()
    expect(job.insp).toEqual({
      electrical: { roughIn: 'passed', roughInDate: '2026-10-19' },
      hvac: { final: 'passed' },
    })
    expect(job.subsStatus).toEqual({ electrical: 'complete' })
    expect(job.tenantId).toBe('qbs')
  })

  it('refuses to update a document that is not there, with the code a screen maps', async () => {
    await expect(updateDoc(doc(db, 'jobs', 'nope'), { progress: 1 })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('replaces a document with setDoc, and merges into it with merge', async () => {
    const ref = doc(db, 'config', 'settings')
    await setDoc(ref, { nested: { b: 3, c: 4 }, smsNotifications: true }, { merge: true })
    expect((await getDoc(ref)).data()).toEqual({ emailDigests: true, smsNotifications: true, nested: { a: 1, b: 3, c: 4 } })
    await setDoc(ref, { emailDigests: false })
    expect((await getDoc(ref)).data()).toEqual({ emailDigests: false })
  })

  it('creates a document with setDoc, merge or not, in a path of any depth', async () => {
    await setDoc(doc(db, 'users', 'u1', 'termsAcceptances', 'v1'), { version: 'v1' }, { merge: true })
    expect((await getDoc(doc(db, 'users', 'u1', 'termsAcceptances', 'v1'))).data()).toEqual({ version: 'v1' })
  })

  it('adds a document under a random id of 20 letters and digits', async () => {
    const ref = await addDoc(collection(db, 'history'), { summary: 'Added' })
    expect(ref.id).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(ref.path).toBe(`history/${ref.id}`)
    const other = await addDoc(collection(db, 'history'), { summary: 'Added again' })
    expect(other.id).not.toBe(ref.id)
    expect((await getDoc(ref)).data()).toEqual({ summary: 'Added' })
  })

  it('stamps serverTimestamp at the write, later writes later, even in the same millisecond', async () => {
    const refs = []
    for (const summary of ['one', 'two', 'three']) {
      refs.push(await addDoc(collection(db, 'history'), { summary, createdAt: serverTimestamp() }))
    }
    const stamps = await Promise.all(refs.map(async (ref) => (await getDoc(ref)).data().createdAt))
    expect(stamps.every((s) => s instanceof Timestamp)).toBe(true)
    expect(stamps[0].toMillis()).toBe(new Date(2026, 9, 19, 9, 0, 0).getTime())
    expect(stamps[0].toDate()).toEqual(new Date(2026, 9, 19, 9, 0, 0))
    expect(stamps[0].isEqual(stamps[0])).toBe(true)
    expect(stamps[0].isEqual(stamps[1])).toBe(false)
    expect(stamps[1].seconds * 1e9 + stamps[1].nanoseconds).toBeGreaterThan(stamps[0].seconds * 1e9 + stamps[0].nanoseconds)
    expect(stamps[2].seconds * 1e9 + stamps[2].nanoseconds).toBeGreaterThan(stamps[1].seconds * 1e9 + stamps[1].nanoseconds)

    const newest = query(collection(db, 'history'), orderBy('createdAt', 'desc'))
    const ids = await idsOf(newest)
    expect(ids).toEqual([refs[2].id, refs[1].id, refs[0].id])

    vi.setSystemTime(new Date(2026, 9, 19, 10, 0, 0))
    await updateDoc(refs[0], { updatedAt: serverTimestamp() })
    expect((await getDoc(refs[0])).data().updatedAt.toDate()).toEqual(new Date(2026, 9, 19, 10, 0, 0))
  })

  it('keeps its own copies, so changing what was written or what was read changes nothing stored', async () => {
    const data = { list: [1, 2], inner: { x: 1 } }
    const ref = doc(db, 'scratch', 'one')
    await setDoc(ref, data)
    data.list.push(3)
    data.inner.x = 2

    const first = (await getDoc(ref)).data()
    expect(first).toEqual({ list: [1, 2], inner: { x: 1 } })
    first.inner.x = 5
    const second = (await getDoc(ref)).data()
    expect(second).toEqual({ list: [1, 2], inner: { x: 1 } })
    expect(second).not.toBe(first)
  })

  it('refuses a value Firestore refuses, such as undefined', async () => {
    await expect(setDoc(doc(db, 'scratch', 'two'), { a: undefined })).rejects.toMatchObject({ code: 'invalid-argument' })
    expect((await getDoc(doc(db, 'scratch', 'two'))).exists()).toBe(false)
  })
})

describe('keeping the store on the device', () => {
  it('saves every collection 250 ms after the last write, once for writes close together', async () => {
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 41 })
    await vi.advanceTimersByTimeAsync(100)
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 42 })
    await vi.advanceTimersByTimeAsync(249)
    expect(storage.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(storage.writes).toBe(1)
    const saved = JSON.parse(storage.map.get(DEMO_STATE_KEY))
    expect(saved.version).toBe('test-1')
    expect(saved.collections.jobs.j1.progress).toBe(42)
  })

  it('does not save what nobody changed, so an untouched demo is seeded fresh each time', async () => {
    onSnapshot(collection(db, 'jobs'), () => {})
    await vi.advanceTimersByTimeAsync(1000)
    expect(storage.writes).toBe(0)
  })

  it('restores what was saved, timestamps included, in a store started later on the same device', async () => {
    await addDoc(collection(db, 'history'), { summary: 'Kept', createdAt: serverTimestamp() })
    await updateDoc(doc(db, 'jobs', 'j2'), { progress: 90 })
    await vi.advanceTimersByTimeAsync(250)

    const later = firestoreOver(createDemoStore({ seed, storage, version: 'test-1' }))
    expect((await getDoc(doc(later, 'jobs', 'j2'))).data().progress).toBe(90)
    let kept
    onSnapshot(collection(later, 'history'), (snap) => { kept = snap.docs.map((d) => d.data()) })
    await flush()
    expect(kept).toHaveLength(1)
    expect(kept[0].summary).toBe('Kept')
    expect(kept[0].createdAt).toBeInstanceOf(Timestamp)
    expect(kept[0].createdAt.toDate()).toEqual(new Date(2026, 9, 19, 9, 0, 0))
    expect((await getDoc(doc(later, 'jobs', 'j1'))).data().createdAt.toMillis()).toBe(3000)
  })

  it('keeps the day the seed was dated for with what it saves, and restores it on that day', async () => {
    const seedOf = vi.fn(seed)
    const today = firestoreOver(createDemoStore({ seed: seedOf, storage, version: 'test-1' }))
    await updateDoc(doc(today, 'jobs', 'j1'), { progress: 55 })
    await vi.advanceTimersByTimeAsync(250)
    expect(seedOf).toHaveBeenCalledTimes(1)
    expect(seedOf.mock.calls[0][0]).toEqual(new Date(2026, 9, 19, 9, 0, 0))
    expect(JSON.parse(storage.map.get(DEMO_STATE_KEY))).toMatchObject({ version: 'test-1', day: '2026-10-19' })

    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 0))
    const evening = firestoreOver(createDemoStore({ seed: seedOf, storage, version: 'test-1' }))
    expect((await getDoc(doc(evening, 'jobs', 'j1'))).data().progress).toBe(55)
    expect(seedOf).toHaveBeenCalledTimes(1)
  })

  it('starts again from a seed dated today on a later day, and forgets the old state but not the role', async () => {
    storage.setItem('p2-demo-role', 'builder')
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 55 })
    await vi.advanceTimersByTimeAsync(250)

    vi.setSystemTime(new Date(2026, 9, 20, 7, 30, 0))
    const seedOf = vi.fn(seed)
    const tomorrow = firestoreOver(createDemoStore({ seed: seedOf, storage, version: 'test-1' }))
    expect((await getDoc(doc(tomorrow, 'jobs', 'j1'))).data().progress).toBe(40)
    expect(seedOf).toHaveBeenCalledTimes(1)
    expect(seedOf.mock.calls[0][0]).toEqual(new Date(2026, 9, 20, 7, 30, 0))
    expect(storage.map.has(DEMO_STATE_KEY)).toBe(false)
    expect(storage.getItem('p2-demo-role')).toBe('builder')
  })

  it('starts again from the seed when what was saved came from another build', async () => {
    const built = (date) => createDemoStore({ seed, storage, version: `demo-seed-1 built ${date}` })
    await updateDoc(doc(firestoreOver(built('2026-10-18')), 'jobs', 'j1'), { progress: 55 })
    await vi.advanceTimersByTimeAsync(250)
    expect((await getDoc(doc(firestoreOver(built('2026-10-18')), 'jobs', 'j1'))).data().progress).toBe(55)
    expect((await getDoc(doc(firestoreOver(built('2026-10-19')), 'jobs', 'j1'))).data().progress).toBe(40)
  })

  it('starts from the seed when what was saved is for another seed version, or cannot be read', async () => {
    storage.setItem(DEMO_STATE_KEY, JSON.stringify({ version: 'test-0', collections: { jobs: {} } }))
    const stale = firestoreOver(createDemoStore({ seed, storage, version: 'test-1' }))
    expect((await getDoc(doc(stale, 'jobs', 'j1'))).exists()).toBe(true)

    storage.setItem(DEMO_STATE_KEY, '{ not json')
    const garbled = firestoreOver(createDemoStore({ seed, storage, version: 'test-1' }))
    expect((await getDoc(doc(garbled, 'jobs', 'j1'))).exists()).toBe(true)
  })

  it('works when the storage refuses every call', async () => {
    const refusing = createDemoStore({ seed, storage: brokenStorage, version: 'test-1' })
    const offline = firestoreOver(refusing)
    await updateDoc(doc(offline, 'jobs', 'j1'), { progress: 12 })
    await vi.advanceTimersByTimeAsync(250)
    expect((await getDoc(doc(offline, 'jobs', 'j1'))).data().progress).toBe(12)
    expect(() => refusing.flush()).not.toThrow()
    expect(() => refusing.reset()).not.toThrow()
    expect((await getDoc(doc(offline, 'jobs', 'j1'))).data().progress).toBe(40)
  })

  it('saves at once when asked, as the page does when it is hidden', async () => {
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 43 })
    store.flush()
    expect(storage.writes).toBe(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(storage.writes).toBe(1)
  })

  it('puts the seed back on reset, forgets what was saved, and tells every listener', async () => {
    const next = vi.fn()
    const inSync = vi.fn()
    onSnapshot(doc(db, 'jobs', 'j1'), next)
    onSnapshotsInSync(db, inSync)
    await flush()
    await updateDoc(doc(db, 'jobs', 'j1'), { progress: 77 })
    await addDoc(collection(db, 'history'), { summary: 'Gone after reset' })
    await vi.advanceTimersByTimeAsync(250)
    expect(storage.map.has(DEMO_STATE_KEY)).toBe(true)
    next.mockClear()
    inSync.mockClear()

    store.reset()
    expect(storage.map.has(DEMO_STATE_KEY)).toBe(false)
    await flush()
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.lastCall[0].data().progress).toBe(40)
    expect(inSync).toHaveBeenCalled()
    expect(await idsOf(collection(db, 'history'))).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(storage.map.has(DEMO_STATE_KEY)).toBe(false)
  })
})

describe('what the app imports for its settings', () => {
  it('has the cache settings, which do nothing here', () => {
    expect(typeof CACHE_SIZE_UNLIMITED).toBe('number')
    expect(() => persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED })).not.toThrow()
  })

  it('gives initializeFirestore the store of the demo app it is handed', async () => {
    const fromApp = initializeFirestore({ demoStore: () => store }, { localCache: persistentLocalCache({}) })
    expect((await getDoc(doc(fromApp, 'jobs', 'j1'))).data().id).toBe('QBS-001')
  })
})
