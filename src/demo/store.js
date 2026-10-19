import { Timestamp, isServerTimestamp, serverClock } from './timestamp'

// The demo's database: every collection the app reads, held in memory on this
// device. The Firestore shim (shims/firestore.js) turns the app's references,
// queries and snapshots into calls on this store, and the demo callables write to it
// directly, so the two see the same documents.
//
//   const store = createDemoStore({ seed, storage, version })
//
// seed is a function that gives the collections to start from, as
// { 'jobs': { [docId]: data }, 'jobs/abc/files': { ... } }, and is called whenever the
// store starts without saved state and on reset. storage is localStorage or anything
// with the same three methods, or null. version names the seed: saved state for another
// version is ignored, so a new seed is never mixed with an old one.
//
// Documents are copied on the way in and on the way out, so neither a screen that
// changes what it read nor one that changes what it wrote can change what is stored.
// A listener is first called in a macrotask after it starts, and again in a later
// macrotask after any write that changes what it sees. The callbacks of one round run
// in the order the listeners started, and then the snapshots in sync callbacks run.
//
// After every write the whole store is saved to storage under DEMO_STATE_KEY, 250 ms
// after the last write of a burst. A store that nobody wrote to saves nothing, so an
// untouched demo starts from a fresh seed, dated from today, each time it opens. Every
// call to storage is guarded, because storage can be blocked or full, and the demo
// then simply forgets on reload.

export const DEMO_STATE_KEY = 'p2-demo-state'
export const SAVE_DELAY_MS = 250

// An error with the code Firestore would give, for the screens that map codes to words.
export class DemoStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FirebaseError'
    this.code = code
  }
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// A document id as Firestore makes them: 20 letters and digits.
export function newDocId() {
  let id = ''
  for (let i = 0; i < 20; i += 1) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
  return id
}

// ── Values ────────────────────────────────────────────────────────────────────

const isMap = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Timestamp)

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// The value as it is stored: a copy, with a Date turned into a Timestamp as Firestore
// does, and serverTimestamp() replaced by stamp, the time of this write. A value
// Firestore refuses (undefined, a function, an instance of some other class) is refused
// here too, with the code Firestore uses.
function toStored(value, stamp, field) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return value
  if (isServerTimestamp(value)) return stamp
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds)
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new DemoStoreError('invalid-argument', `Unsupported field value: an invalid Date (found in field ${field}).`)
    return Timestamp.fromDate(value)
  }
  if (Array.isArray(value)) return value.map((item, index) => toStored(item, stamp, `${field}.${index}`))
  if (isPlainObject(value)) {
    const copy = {}
    for (const [key, inner] of Object.entries(value)) copy[key] = toStored(inner, stamp, field ? `${field}.${key}` : key)
    return copy
  }
  const what = value === undefined ? 'undefined' : typeof value === 'function' ? 'a function' : 'a custom object'
  throw new DemoStoreError('invalid-argument', `Unsupported field value: ${what} (found in field ${field || 'the document'}).`)
}

// A copy of a stored value, for a reader.
export function copyOf(value) {
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds)
  if (Array.isArray(value)) return value.map(copyOf)
  if (isMap(value)) {
    const copy = {}
    for (const [key, inner] of Object.entries(value)) copy[key] = copyOf(inner)
    return copy
  }
  return value
}

// A stored value as plain JSON: maps with their keys in order, and a Timestamp as
// { $timestamp: [seconds, nanoseconds] }. It is what is saved, and its text is how the
// store tells whether a document changed.
function encode(value) {
  if (value instanceof Timestamp) return { $timestamp: [value.seconds, value.nanoseconds] }
  if (Array.isArray(value)) return value.map(encode)
  if (isMap(value)) {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = encode(value[key])
    return out
  }
  return value
}

function decode(value) {
  if (Array.isArray(value)) return value.map(decode)
  if (isMap(value)) {
    const stamp = value.$timestamp
    if (Array.isArray(stamp) && stamp.length === 2 && Object.keys(value).length === 1) return new Timestamp(stamp[0], stamp[1])
    const out = {}
    for (const [key, inner] of Object.entries(value)) out[key] = decode(inner)
    return out
  }
  return value
}

// A document as the store keeps it: its data, and the text the data encodes to.
// An entry is never changed after it is made, so a snapshot can hold one.
const entryOf = (data) => Object.freeze({ data, text: JSON.stringify(encode(data)) })

// What a snapshot holds of a document: a way to read a fresh copy of it.
const viewOf = (entry) => ({ read: () => copyOf(entry.data) })

// A document's data has to be a map, as in Firestore.
function requireMap(data, what) {
  if (!isPlainObject(data)) throw new DemoStoreError('invalid-argument', `${what} needs an object of fields.`)
}

// ── Field paths and ordering ─────────────────────────────────────────────────

const pathSegments = (fieldPath) => String(fieldPath).split('.')

export function readField(data, fieldPath) {
  let value = data
  for (const key of pathSegments(fieldPath)) {
    if (!isMap(value) || !Object.hasOwn(value, key)) return undefined
    value = value[key]
  }
  return value
}

// Sets the field at a dotted path, making the maps on the way when they are missing.
function writeField(data, fieldPath, value) {
  const keys = pathSegments(fieldPath)
  let target = data
  for (const key of keys.slice(0, -1)) {
    if (!isMap(target[key])) target[key] = {}
    target = target[key]
  }
  target[keys[keys.length - 1]] = value
}

// Merges incoming into base the way setDoc with merge does: maps are merged field by
// field at every depth, and anything else, an array included, replaces what was there.
function mergeInto(base, incoming) {
  for (const [key, value] of Object.entries(incoming)) {
    base[key] = isMap(value) && isMap(base[key]) ? mergeInto(base[key], value) : value
  }
  return base
}

// Firestore's order of types: null, booleans, numbers, timestamps, strings, arrays, maps.
const TYPE_RANK = { null: 0, boolean: 1, number: 2, timestamp: 3, string: 4, array: 5, map: 6 }

function typeOf(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value instanceof Timestamp) return 'timestamp'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  return 'map'
}

const sign = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function compareValues(a, b) {
  const left = typeOf(a)
  const right = typeOf(b)
  if (left !== right) return TYPE_RANK[left] - TYPE_RANK[right]
  if (left === 'null') return 0
  if (left === 'boolean') return sign(Number(a), Number(b))
  if (left === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : -1) : 1
    return sign(a, b)
  }
  if (left === 'timestamp') return a.compareTo(b)
  if (left === 'string') return sign(a, b)
  if (left === 'array') {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const c = compareValues(a[i], b[i])
      if (c !== 0) return c
    }
    return a.length - b.length
  }
  const keysA = Object.keys(a).sort()
  const keysB = Object.keys(b).sort()
  for (let i = 0; i < Math.min(keysA.length, keysB.length); i += 1) {
    const c = sign(keysA[i], keysB[i]) || compareValues(a[keysA[i]], b[keysB[i]])
    if (c !== 0) return c
  }
  return keysA.length - keysB.length
}

const equal = (a, b) => a !== undefined && compareValues(a, b) === 0

function matches(data, { field, op, value }) {
  const found = readField(data, field)
  if (op === '==') return equal(found, value)
  if (op === 'array-contains') return Array.isArray(found) && found.some((item) => equal(item, value))
  throw new DemoStoreError('invalid-argument', `The demo store does not support the where operator ${op}.`)
}

// The documents of a collection that a query asks for, as [id, entry] pairs in its
// order. As in Firestore, ordering by a field leaves out the documents that do not
// have it, and documents that tie are ordered by id, in the direction of the last
// order (ascending when there is none).
function select(docs, { filters = [], orders = [], limit = null }) {
  let rows = [...docs.entries()]
  rows = rows.filter(([, entry]) => filters.every((filter) => matches(entry.data, filter)))
  rows = rows.filter(([, entry]) => orders.every(({ field }) => readField(entry.data, field) !== undefined))
  const lastDirection = orders.length > 0 ? orders[orders.length - 1].direction : 'asc'
  rows.sort(([idA, a], [idB, b]) => {
    for (const { field, direction } of orders) {
      const c = compareValues(readField(a.data, field), readField(b.data, field))
      if (c !== 0) return direction === 'desc' ? -c : c
    }
    const c = sign(idA, idB)
    return lastDirection === 'desc' ? -c : c
  })
  return limit === null ? rows : rows.slice(0, limit)
}

// ── The store ─────────────────────────────────────────────────────────────────

const guarded = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}

// An error in a screen's callback is thrown where the browser reports it, after the
// round, so one callback that fails does not keep the others from being called.
const reportLater = (error) => setTimeout(() => { throw error }, 0)

export function createDemoStore({ seed = () => ({}), storage = null, version = 'demo' } = {}) {
  let collections = null
  const nextStamp = serverClock()
  const listeners = new Set()
  const inSyncCallbacks = new Set()
  const dirty = new Set()
  let everythingDirty = false
  let roundScheduled = false
  let saveTimer = null

  // The collections of the seed, as entries, with any serverTimestamp in it stamped now.
  function seeded() {
    const stamp = nextStamp()
    const out = new Map()
    for (const [path, docs] of Object.entries(seed() || {})) {
      const map = new Map()
      for (const [id, data] of Object.entries(docs || {})) map.set(id, entryOf(toStored(data, stamp, '')))
      out.set(path, map)
    }
    return out
  }

  function restored() {
    const text = guarded(() => storage?.getItem(DEMO_STATE_KEY))
    if (typeof text !== 'string') return null
    let saved
    try {
      saved = JSON.parse(text)
    } catch {
      return null
    }
    if (!saved || saved.version !== version || !isMap(saved.collections)) return null
    const out = new Map()
    for (const [path, docs] of Object.entries(saved.collections)) {
      if (!isMap(docs)) continue
      const map = new Map()
      for (const [id, data] of Object.entries(docs)) {
        if (isMap(data)) map.set(id, entryOf(decode(data)))
      }
      out.set(path, map)
    }
    return out
  }

  // The collections are made the first time anything asks for them, so that loading
  // the demo reads neither the clock nor storage.
  function all() {
    if (collections === null) collections = restored() ?? seeded()
    return collections
  }

  function docsOf(path, create = false) {
    const map = all()
    if (!map.has(path) && create) map.set(path, new Map())
    return map.get(path) ?? new Map()
  }

  function save() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = null
    if (!storage || collections === null) return
    const out = {}
    for (const [path, docs] of collections) {
      if (docs.size === 0) continue
      out[path] = {}
      for (const [id, entry] of docs) out[path][id] = encode(entry.data)
    }
    guarded(() => storage.setItem(DEMO_STATE_KEY, JSON.stringify({ version, collections: out })))
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DELAY_MS)
  }

  function scheduleRound() {
    if (roundScheduled) return
    roundScheduled = true
    setTimeout(runRound, 0)
  }

  function changed(path) {
    dirty.add(path)
    scheduleRound()
    scheduleSave()
  }

  // What a listener sees now: for a document, its entry or null; for a query, the
  // [id, entry] pairs it selects. And a text that is the same exactly when what it
  // sees is the same.
  function look(target) {
    if (target.kind === 'doc') {
      const entry = docsOf(target.path).get(target.id) ?? null
      return { value: entry, text: entry ? entry.text : '' }
    }
    const rows = select(docsOf(target.path), target)
    return { value: rows, text: rows.map(([id, entry]) => `${id}\u0000${entry.text}`).join('\u0001') }
  }

  // The views a listener is given: one document, or the documents of a query in order.
  const present = (target, value) => (target.kind === 'doc'
    ? (value ? viewOf(value) : null)
    : value.map(([id, entry]) => ({ id, ...viewOf(entry) })))

  function runRound() {
    roundScheduled = false
    const paths = new Set(dirty)
    const everything = everythingDirty
    dirty.clear()
    everythingDirty = false
    for (const listener of [...listeners]) {
      if (!listener.active) continue
      if (listener.seen !== null && !everything && !paths.has(listener.target.path)) continue
      let now
      try {
        now = look(listener.target)
      } catch (error) {
        listener.active = false
        listeners.delete(listener)
        if (listener.error) {
          try { listener.error(error) } catch (thrown) { reportLater(thrown) }
        }
        continue
      }
      if (listener.seen === now.text) continue
      listener.seen = now.text
      try { listener.next(present(listener.target, now.value)) } catch (thrown) { reportLater(thrown) }
    }
    for (const callback of [...inSyncCallbacks]) {
      try { callback() } catch (thrown) { reportLater(thrown) }
    }
  }

  // ── Reads ──

  // A copy of one document's data, or undefined when it is not there.
  function get(path, id) {
    const entry = docsOf(path).get(id)
    return entry ? copyOf(entry.data) : undefined
  }

  // The documents a query selects, as [{ id, data }] with copies of the data.
  function find(path, constraints = {}) {
    return select(docsOf(path), constraints).map(([id, entry]) => ({ id, data: copyOf(entry.data) }))
  }

  // ── Writes ──

  function set(path, id, data, { merge = false } = {}) {
    requireMap(data, 'A document')
    const incoming = toStored(data, nextStamp(), '')
    const docs = docsOf(path, true)
    const before = docs.get(id)
    docs.set(id, entryOf(merge && before ? mergeInto(copyOf(before.data), incoming) : incoming))
    changed(path)
  }

  function update(path, id, patch) {
    requireMap(patch, 'An update')
    const docs = docsOf(path)
    const before = docs.get(id)
    if (!before) throw new DemoStoreError('not-found', `No document to update: ${path}/${id}`)
    const stamp = nextStamp()
    const next = copyOf(before.data)
    for (const [fieldPath, value] of Object.entries(patch)) writeField(next, fieldPath, toStored(value, stamp, fieldPath))
    docs.set(id, entryOf(next))
    changed(path)
  }

  function add(path, data) {
    const id = newDocId()
    set(path, id, data)
    return id
  }

  // ── Listening ──

  // target is { kind: 'doc', path, id } or { kind: 'query', path, filters, orders,
  // limit }. next gets a view of the document ({ read }, or null when it is not there),
  // or the views of the documents of the query ([{ id, read }]). Returns the function
  // that stops it.
  function listen(target, next, error) {
    all()
    const listener = { target, next, error, active: true, seen: null }
    listeners.add(listener)
    scheduleRound()
    return () => {
      listener.active = false
      listeners.delete(listener)
    }
  }

  function onInSync(callback) {
    all()
    inSyncCallbacks.add(callback)
    scheduleRound()
    return () => { inSyncCallbacks.delete(callback) }
  }

  // ── The device ──

  // Puts the seed back: forgets what was saved and tells every listener.
  function reset() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = null
    guarded(() => storage?.removeItem(DEMO_STATE_KEY))
    collections = seeded()
    everythingDirty = true
    scheduleRound()
  }

  // Saves now if a save is waiting, as the page does when it is hidden.
  function flush() {
    if (saveTimer !== null) save()
  }

  return { get, find, set, update, add, listen, onInSync, reset, flush }
}
