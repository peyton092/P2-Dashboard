import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// queryFor builds the list query a signed in user may run on one of the four
// scoped collections. Firestore refuses a list query unless every document it
// could return is one the rules let that user read, so the filter added for each
// role is the contract with firestore.rules (tests/rules/scoped.test.mjs runs the
// same queries in the emulator). The query builders are replaced by ones that
// record their arguments.
vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ type: 'collection', path: path.join('/') }),
  query: (ref, ...constraints) => ({ type: 'query', path: ref.path, constraints }),
  where: (...args) => ({ type: 'where', args }),
  orderBy: (...args) => ({ type: 'orderBy', args }),
  limit: (...args) => ({ type: 'limit', args }),
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
vi.mock('../../firebase', () => ({ db: {}, auth: {}, functions: {} }))

import { queryFor } from '../useFirestore'

// The order and the cap each list has always had, after any scope filter.
const TAIL = {
  jobs: [{ type: 'orderBy', args: ['id'] }, { type: 'limit', args: [200] }],
  extras: [{ type: 'orderBy', args: ['date'] }, { type: 'limit', args: [500] }],
  notifications: [{ type: 'orderBy', args: ['createdAt', 'desc'] }, { type: 'limit', args: [100] }],
  submits: [{ type: 'orderBy', args: ['createdAt', 'desc'] }, { type: 'limit', args: [100] }],
}
const COLLECTIONS = ['jobs', 'extras', 'notifications', 'submits']

const BUILDER = { role: 'builder', tenantId: 'qbs', uid: 'b1' }
const CLIENT = { role: 'client', tenantId: null, uid: 'c1' }

describe.each(COLLECTIONS)('queryFor(%s)', (name) => {
  it.each(['owner', 'internal'])('gives %s staff the whole collection, with no where clause', (role) => {
    expect(queryFor(name, { role, tenantId: 'p2-core', uid: 'u1' })).toEqual({
      type: 'query',
      path: name,
      constraints: TAIL[name],
    })
  })

  it('gives staff the whole collection whatever workspace they have chosen', () => {
    const q = queryFor(name, { role: 'internal', tenantId: 'vision', uid: 's1' })
    expect(q.constraints.filter((c) => c.type === 'where')).toEqual([])
  })

  it.each(['qbs', 'vision'])('gives a %s builder the documents of that tenant', (tenantId) => {
    expect(queryFor(name, { role: 'builder', tenantId, uid: 'b1' })).toEqual({
      type: 'query',
      path: name,
      constraints: [{ type: 'where', args: ['tenantId', '==', tenantId] }, ...TAIL[name]],
    })
  })

  it('gives a client the documents whose clientUids list them', () => {
    expect(queryFor(name, CLIENT)).toEqual({
      type: 'query',
      path: name,
      constraints: [{ type: 'where', args: ['clientUids', 'array-contains', 'c1'] }, ...TAIL[name]],
    })
  })

  it('filters a client by uid alone, whatever tenant their scope names', () => {
    const q = queryFor(name, { role: 'client', tenantId: 'qbs', uid: 'c7' })
    expect(q.constraints.filter((c) => c.type === 'where')).toEqual([
      { type: 'where', args: ['clientUids', 'array-contains', 'c7'] },
    ])
  })

  it.each([
    ['a builder whose tenant is null', { role: 'builder', tenantId: null, uid: 'b1' }],
    ['a builder whose tenant is empty', { role: 'builder', tenantId: '', uid: 'b1' }],
    ['a builder with no tenant at all', { role: 'builder', uid: 'b1' }],
    ['a client whose uid is null', { role: 'client', tenantId: null, uid: null }],
    ['a client whose uid is empty', { role: 'client', tenantId: null, uid: '' }],
    ['an unknown role', { role: 'admin', tenantId: 'qbs', uid: 'u1' }],
    ['no role', { role: null, tenantId: 'qbs', uid: 'u1' }],
    ['an empty scope', {}],
    ['a null scope', null],
    ['no scope at all', undefined],
  ])('gives %s nothing to run', (_label, scope) => {
    expect(queryFor(name, scope)).toBeNull()
  })
})

describe('queryFor and other collections', () => {
  it('refuses a collection that is not scoped, rather than read it whole', () => {
    expect(() => queryFor('subs', { role: 'owner', tenantId: 'p2-core', uid: 'o1' })).toThrow()
    expect(() => queryFor('subs', BUILDER)).toThrow()
  })
})

// Firestore in production needs a composite index for a filter combined with an
// order on another field, and refuses the query without one. The emulator does
// not, so a missing index would only show after deploying. Every scoped query a
// builder or a client runs must have its index declared.
describe('firestore.indexes.json', () => {
  const root = resolve(import.meta.dirname, '../../..')
  const readJson = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'))

  it('is the index file firebase.json deploys', () => {
    expect(readJson('firebase.json').firestore.indexes).toBe('firestore.indexes.json')
  })

  it.each(COLLECTIONS.flatMap((name) => [[name, 'builder', BUILDER], [name, 'client', CLIENT]]))(
    'declares the index the %s query of a %s needs',
    (name, _role, scope) => {
      const [filter, order] = queryFor(name, scope).constraints
      const [field, op] = filter.args
      const [orderField, direction] = order.args
      expect(readJson('firestore.indexes.json').indexes).toContainEqual({
        collectionGroup: name,
        queryScope: 'COLLECTION',
        fields: [
          op === 'array-contains'
            ? { fieldPath: field, arrayConfig: 'CONTAINS' }
            : { fieldPath: field, order: 'ASCENDING' },
          { fieldPath: orderField, order: direction === 'desc' ? 'DESCENDING' : 'ASCENDING' },
        ],
      })
    },
  )
})
