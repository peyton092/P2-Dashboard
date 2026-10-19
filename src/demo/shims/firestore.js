import { DemoStoreError, copyOf, newDocId } from '../store'
import { Timestamp, serverTimestampValue } from '../timestamp'

// firebase/firestore for the demo build. vite.config.js points the package here in
// demo mode, so every screen, hook and helper that imports it runs unchanged on the
// demo store (../store.js). This is the whole of what the app imports from the
// package, and each piece behaves as the app relies on:
//
//   doc, collection, query, where, orderBy, limit   references and queries, on paths
//     of any depth. where takes == and array-contains, the two the app uses, and any
//     other operator throws an error that names it, so code that needs one fails
//     loudly in the tests instead of quietly reading the wrong documents.
//   onSnapshot, onSnapshotsInSync   listeners as the store calls them: first in a
//     macrotask, then after each write that changes what they see. Snapshots carry
//     the metadata of a server that has answered and has nothing pending.
//   getDoc, setDoc (with merge), addDoc, updateDoc (with dotted field paths),
//     serverTimestamp   writes, applied to the store at once.
//   initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
//     CACHE_SIZE_UNLIMITED   the cache settings, which mean nothing here.

export { Timestamp }

export const CACHE_SIZE_UNLIMITED = -1

export function persistentLocalCache(settings = {}) {
  return { kind: 'persistent', ...settings }
}

export function persistentMultipleTabManager() {
  return { kind: 'PersistentMultipleTab' }
}

// The database the app's db stands for. It finds its store when it is first used.
class Firestore {
  constructor(storeOf) {
    this.type = 'firestore'
    this._storeOf = storeOf
  }

  get _store() {
    return this._storeOf()
  }
}

// A database over a store, or over a function that gives one.
export function firestoreOver(store) {
  return new Firestore(typeof store === 'function' ? store : () => store)
}

// app is the demo app of shims/app.js, which carries the store of the demo.
export function initializeFirestore(app) {
  return firestoreOver(() => app.demoStore())
}

// ── References and queries ───────────────────────────────────────────────────

const invalid = (message) => new DemoStoreError('invalid-argument', message)

// The segments of a path given as pieces, each of which may itself hold slashes.
function segmentsOf(pieces) {
  const segments = pieces.flatMap((piece) => {
    if (typeof piece !== 'string') throw invalid(`A path segment must be a string, not ${typeof piece}.`)
    return piece.split('/')
  })
  if (segments.some((segment) => segment === '')) throw invalid(`The path ${pieces.join('/')} has an empty segment.`)
  return segments
}

const NO_CONSTRAINTS = Object.freeze({ filters: Object.freeze([]), orders: Object.freeze([]), limit: null })

class Query {
  constructor(firestore, collectionPath, constraints = NO_CONSTRAINTS) {
    this.type = 'query'
    this.firestore = firestore
    this._path = collectionPath
    this._constraints = constraints
  }
}

class CollectionReference extends Query {
  constructor(firestore, path) {
    super(firestore, path)
    this.type = 'collection'
    this.path = path
    this.id = path.split('/').pop()
  }

  get parent() {
    const segments = this.path.split('/')
    return segments.length > 1 ? new DocumentReference(this.firestore, segments.slice(0, -1).join('/')) : null
  }
}

class DocumentReference {
  constructor(firestore, path) {
    this.type = 'document'
    this.firestore = firestore
    this.path = path
    this.id = path.split('/').pop()
  }

  get parent() {
    return new CollectionReference(this.firestore, this.path.split('/').slice(0, -1).join('/'))
  }
}

// Where a reference or the database starts, as the database and a path.
function baseOf(parent) {
  if (parent instanceof Firestore) return { firestore: parent, path: [] }
  if (parent instanceof DocumentReference || parent instanceof CollectionReference) {
    return { firestore: parent.firestore, path: parent.path.split('/') }
  }
  throw invalid('Expected the database, a document reference or a collection reference.')
}

export function collection(parent, path, ...more) {
  const base = baseOf(parent)
  const segments = [...base.path, ...segmentsOf([path, ...more])]
  if (segments.length % 2 !== 1) throw invalid(`A collection path has an odd number of segments, and ${segments.join('/')} does not.`)
  return new CollectionReference(base.firestore, segments.join('/'))
}

export function doc(parent, ...pieces) {
  const base = baseOf(parent)
  const relative = pieces.length === 0 && parent instanceof CollectionReference ? [newDocId()] : segmentsOf(pieces)
  const segments = [...base.path, ...relative]
  if (segments.length === 0 || segments.length % 2 !== 0) throw invalid(`A document path has an even number of segments, and ${segments.join('/')} does not.`)
  return new DocumentReference(base.firestore, segments.join('/'))
}

const OPERATORS = ['==', 'array-contains']

export function where(field, op, value) {
  if (!OPERATORS.includes(op)) {
    throw invalid(`The demo store does not support the where operator ${op}. It supports == and array-contains.`)
  }
  if (value === undefined) throw invalid(`where() on ${field} was given undefined.`)
  return { type: 'where', field, op, value }
}

export function orderBy(field, direction = 'asc') {
  if (direction !== 'asc' && direction !== 'desc') throw invalid(`orderBy() takes asc or desc, not ${direction}.`)
  return { type: 'orderBy', field, direction }
}

export function limit(count) {
  if (!Number.isInteger(count) || count <= 0) throw invalid(`limit() takes a whole number above zero, not ${count}.`)
  return { type: 'limit', limit: count }
}

export function query(base, ...constraints) {
  if (!(base instanceof Query)) throw invalid('query() starts from a collection or another query.')
  let { filters, orders, limit: max } = base._constraints
  for (const constraint of constraints) {
    if (constraint?.type === 'where') filters = [...filters, constraint]
    else if (constraint?.type === 'orderBy') orders = [...orders, constraint]
    else if (constraint?.type === 'limit') max = constraint.limit
    else throw invalid('query() takes where, orderBy and limit.')
  }
  return new Query(base.firestore, base._path, Object.freeze({ filters, orders, limit: max }))
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

const METADATA = Object.freeze({
  fromCache: false,
  hasPendingWrites: false,
  isEqual: (other) => other?.fromCache === false && other?.hasPendingWrites === false,
})

class DocumentSnapshot {
  constructor(ref, view) {
    this.ref = ref
    this.id = ref.id
    this.metadata = METADATA
    this._view = view
  }

  exists() {
    return this._view !== null
  }

  data() {
    return this._view ? this._view.read() : undefined
  }

  get(fieldPath) {
    let value = this.data()
    for (const key of String(fieldPath).split('.')) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined
      value = value[key]
    }
    return value
  }
}

class QuerySnapshot {
  constructor(source, views) {
    this.query = source
    this.metadata = METADATA
    this.docs = views.map((view) => new DocumentSnapshot(new DocumentReference(source.firestore, `${source._path}/${view.id}`), view))
    this.size = this.docs.length
    this.empty = this.docs.length === 0
  }

  forEach(callback, thisArg) {
    this.docs.forEach(callback, thisArg)
  }
}

// ── Listening ─────────────────────────────────────────────────────────────────

const isObserver = (value) =>
  value !== null && typeof value === 'object' &&
  (typeof value.next === 'function' || typeof value.error === 'function' || typeof value.complete === 'function')

// onSnapshot(target, next, error), onSnapshot(target, options, next, error), and the
// same with an observer { next, error } in place of the two callbacks.
export function onSnapshot(target, ...args) {
  const rest = args[0] !== null && typeof args[0] === 'object' && !isObserver(args[0]) ? args.slice(1) : args
  const [first, second] = rest
  const next = isObserver(first) ? first.next?.bind(first) : first
  const error = isObserver(first) ? first.error?.bind(first) : second
  const store = target.firestore._store

  if (target instanceof DocumentReference) {
    const segments = target.path.split('/')
    return store.listen(
      { kind: 'doc', path: segments.slice(0, -1).join('/'), id: segments[segments.length - 1] },
      (view) => next?.(new DocumentSnapshot(target, view)),
      (err) => error?.(err),
    )
  }
  if (target instanceof Query) {
    return store.listen(
      { kind: 'query', path: target._path, ...target._constraints },
      (views) => next?.(new QuerySnapshot(target, views)),
      (err) => error?.(err),
    )
  }
  throw invalid('onSnapshot() listens to a document reference or a query.')
}

export function onSnapshotsInSync(firestore, observer) {
  const callback = typeof observer === 'function' ? observer : () => observer?.next?.()
  return firestore._store.onInSync(callback)
}

// ── Reads and writes ──────────────────────────────────────────────────────────

const requireDoc = (ref, what) => {
  if (!(ref instanceof DocumentReference)) throw invalid(`${what} takes a document reference.`)
  const segments = ref.path.split('/')
  return { store: ref.firestore._store, path: segments.slice(0, -1).join('/'), id: segments[segments.length - 1] }
}

export async function getDoc(ref) {
  const { store, path, id } = requireDoc(ref, 'getDoc()')
  const data = store.get(path, id)
  return new DocumentSnapshot(ref, data === undefined ? null : { read: () => copyOf(data) })
}

export async function setDoc(ref, data, options = {}) {
  const { store, path, id } = requireDoc(ref, 'setDoc()')
  store.set(path, id, data, { merge: options?.merge === true })
}

export async function updateDoc(ref, data) {
  const { store, path, id } = requireDoc(ref, 'updateDoc()')
  store.update(path, id, data)
}

export async function addDoc(collectionRef, data) {
  if (!(collectionRef instanceof CollectionReference)) throw invalid('addDoc() takes a collection reference.')
  const id = collectionRef.firestore._store.add(collectionRef.path, data)
  return new DocumentReference(collectionRef.firestore, `${collectionRef.path}/${id}`)
}

export const serverTimestamp = serverTimestampValue
