import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const listeners = []

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path: path.join('/') }),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  query: (ref, ...constraints) => ({ path: ref.path, constraints }),
  where: (...args) => ({ where: args }),
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: (q, onNext, onError) => {
    const entry = { path: q.path, constraints: q.constraints ?? [], onNext, onError, unsubscribed: false }
    listeners.push(entry)
    return () => { entry.unsubscribed = true }
  },
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
vi.mock('../../firebase', () => ({ db: {}, functions: {} }))

import {
  useJobs, useAllExtras, useNotifications, useSubs, useMaterials, useSubmits,
  useDailyReports, useUrgentItems, useHistory, useSettings, useAgentAlerts, useSupplierInvoices,
  useJobFiles, useSubmitReplies,
} from '../useFirestore'
import * as firestoreModule from '../useFirestore'

const snapshot = (...ids) => ({ docs: ids.map(id => ({ id, data: () => ({ name: id }) })) })
const live = (path) => listeners.filter(l => l.path === path && !l.unsubscribed).at(-1)
const filters = (listener) => listener.constraints.filter(c => c?.where).map(c => c.where)

// The scope each signed in provider hands its hooks: { role, tenantId, uid }.
const STAFF = { role: 'owner', tenantId: 'p2-core', uid: 'o1' }
const BUILDER = { role: 'builder', tenantId: 'qbs', uid: 'b1' }
const CLIENT = { role: 'client', tenantId: null, uid: 'c1' }

beforeEach(() => { listeners.length = 0 })

describe.each([
  ['useJobFiles', useJobFiles, 'files', 'jobs', 'files'],
  ['useSubmitReplies', useSubmitReplies, 'replies', 'submits', 'replies'],
])('%s', (_name, hook, key, parent, sub) => {
  const path = (id) => `${parent}/${id}/${sub}`

  it('returns nothing and is not loading without an id', () => {
    const { result } = renderHook(() => hook(null))
    expect(result.current[key]).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(listeners).toHaveLength(0)
  })

  it('returns no data and loading true until the new id snapshot fires', () => {
    const { result, rerender } = renderHook(({ id }) => hook(id), { initialProps: { id: 'A' } })
    expect(result.current.loading).toBe(true)
    act(() => live(path('A')).onNext(snapshot('a1')))
    expect(result.current[key].map(r => r._docId)).toEqual(['a1'])
    expect(result.current.loading).toBe(false)

    rerender({ id: 'B' })
    expect(result.current[key]).toEqual([])
    expect(result.current.loading).toBe(true)

    act(() => live(path('B')).onNext(snapshot('b1', 'b2')))
    expect(result.current[key].map(r => r._docId)).toEqual(['b1', 'b2'])
    expect(result.current.loading).toBe(false)
  })

  it('returns no data and loading false when the new id errors', () => {
    const { result, rerender } = renderHook(({ id }) => hook(id), { initialProps: { id: 'A' } })
    act(() => live(path('A')).onNext(snapshot('a1')))
    rerender({ id: 'B' })
    act(() => live(path('B')).onError(new Error('permission-denied')))
    expect(result.current[key]).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('does not resurface old data when going A to null to A', () => {
    const { result, rerender } = renderHook(({ id }) => hook(id), { initialProps: { id: 'A' } })
    act(() => live(path('A')).onNext(snapshot('a1')))
    rerender({ id: null })
    expect(result.current[key]).toEqual([])
    rerender({ id: 'A' })
    expect(result.current[key]).toEqual([])
    expect(result.current.loading).toBe(true)
  })

  it('has no error without an id, while loading, or after rows arrive', () => {
    const { result, rerender } = renderHook(({ id }) => hook(id), { initialProps: { id: null } })
    expect(result.current.error).toBeNull()
    rerender({ id: 'A' })
    expect(result.current.error).toBeNull()
    act(() => live(path('A')).onNext(snapshot('a1')))
    expect(result.current.error).toBeNull()
  })

  it('returns the error of the id that failed, and no error once the id changes', () => {
    const rendered = []
    const { result, rerender } = renderHook(({ id }) => {
      const value = hook(id)
      rendered.push(value)
      return value
    }, { initialProps: { id: 'A' } })
    const failure = new Error('permission-denied')
    act(() => live(path('A')).onError(failure))
    expect(result.current.error).toBe(failure)
    expect(result.current.loading).toBe(false)

    // Every render after the id changes, the first of them included, which comes
    // before the old subscription is cleaned up, must be free of A's error.
    rendered.length = 0
    rerender({ id: 'B' })
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.every(value => value.error === null)).toBe(true)
    expect(result.current.loading).toBe(true)

    rerender({ id: 'A' })
    expect(result.current.error).toBeNull()
  })
})

// A subscription that fails ends for good: Firestore does not retry it, so the
// hook has to say so, or the screen shows an empty list as if nothing was there.
describe.each([
  ['useJobs', useJobs, 'jobs', 'jobs'],
  ['useAllExtras', useAllExtras, 'extras', 'extras'],
  ['useNotifications', useNotifications, 'notifs', 'notifications'],
  ['useSubs', useSubs, 'subs', 'subs'],
  ['useMaterials', useMaterials, 'materials', 'materials'],
  ['useSubmits', useSubmits, 'submits', 'submits'],
  ['useDailyReports', useDailyReports, 'dailyReports', 'daily_reports'],
  ['useUrgentItems', useUrgentItems, 'urgentItems', 'urgent_items'],
  ['useHistory', useHistory, 'history', 'history'],
  ['useSettings', useSettings, 'settings', 'config/settings'],
  ['useAgentAlerts', useAgentAlerts, 'alerts', 'agent_alerts'],
  ['useSupplierInvoices', useSupplierInvoices, 'invoices', 'supplier_invoices'],
])('%s error state', (_name, hook, key, path) => {
  it('has no error while it waits for the first snapshot', () => {
    const { result } = renderHook(() => hook(STAFF))
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('returns the error Firestore gives it, stops loading, and keeps returning its data', () => {
    const { result } = renderHook(() => hook(STAFF))
    const before = result.current[key]
    const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    act(() => live(path).onError(failure))
    expect(result.current.error).toBe(failure)
    expect(result.current.loading).toBe(false)
    expect(result.current[key]).toEqual(before)
  })

  it('stops listening when it unmounts', () => {
    const { unmount } = renderHook(() => hook(STAFF))
    unmount()
    expect(listeners.filter(l => l.path === path && !l.unsubscribed)).toEqual([])
  })
})

// A scope that can read nothing must never fall back to an unscoped query: the
// rules would refuse it, and a refused listener is an error on the screen.
const NO_ACCESS = [
  ['a builder whose tenant is null', { role: 'builder', tenantId: null, uid: 'b1' }],
  ['a builder whose tenant is empty', { role: 'builder', tenantId: '', uid: 'b1' }],
  ['a client whose uid is null', { role: 'client', tenantId: null, uid: null }],
  ['an unknown role', { role: 'admin', tenantId: 'p2-core', uid: 'u1' }],
  ['an empty scope', {}],
  ['a null scope', null],
  ['no scope at all', undefined],
]

// Jobs, change orders, notifications and submissions carry a scope, and the query
// each hook runs is the one queryFor builds for the signed in user.
describe.each([
  ['useJobs', useJobs, 'jobs', 'jobs'],
  ['useAllExtras', useAllExtras, 'extras', 'extras'],
  ['useNotifications', useNotifications, 'notifs', 'notifications'],
  ['useSubmits', useSubmits, 'submits', 'submits'],
])('%s scope', (_name, hook, key, path) => {
  it('listens to the documents of a builder\'s tenant', () => {
    renderHook(() => hook(BUILDER))
    expect(filters(live(path))).toEqual([['tenantId', '==', 'qbs']])
  })

  it('listens to the documents whose clientUids list a client', () => {
    renderHook(() => hook(CLIENT))
    expect(filters(live(path))).toEqual([['clientUids', 'array-contains', 'c1']])
  })

  it('listens to the whole collection for staff', () => {
    renderHook(() => hook({ role: 'internal', tenantId: 'qbs', uid: 's1' }))
    expect(filters(live(path))).toEqual([])
  })

  it.each(NO_ACCESS)('listens to nothing for %s, and reports no rows, no error and nothing loading', (_label, scope) => {
    const { result } = renderHook(() => hook(scope))
    expect(listeners).toHaveLength(0)
    expect(result.current).toEqual({ [key]: [], loading: false, error: null })
  })

  it('keeps its listener when given an equal scope again, as each render of the app does', () => {
    const { rerender } = renderHook(({ scope }) => hook(scope), { initialProps: { scope: { ...BUILDER } } })
    const first = live(path)
    rerender({ scope: { ...BUILDER } })
    expect(live(path)).toBe(first)
    expect(listeners).toHaveLength(1)
  })

  it('keeps its listener and its rows when staff switch workspace', () => {
    const { result, rerender } = renderHook(({ scope }) => hook(scope), {
      initialProps: { scope: { role: 'internal', tenantId: 'p2-core', uid: 's1' } },
    })
    const first = live(path)
    act(() => first.onNext(snapshot('a1')))
    rerender({ scope: { role: 'internal', tenantId: 'qbs', uid: 's1' } })
    expect(live(path)).toBe(first)
    expect(listeners).toHaveLength(1)
    expect(result.current[key].map(r => r._docId)).toEqual(['a1'])
    expect(result.current.loading).toBe(false)
  })

  it('starts over, showing none of the old rows, when the scope changes', () => {
    const { result, rerender } = renderHook(({ scope }) => hook(scope), { initialProps: { scope: BUILDER } })
    act(() => live(path).onNext(snapshot('q1')))
    expect(result.current[key].map(r => r._docId)).toEqual(['q1'])

    rerender({ scope: { ...BUILDER, tenantId: 'vision' } })
    expect(result.current[key]).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(filters(live(path))).toEqual([['tenantId', '==', 'vision']])
    expect(listeners.filter(l => !l.unsubscribed)).toHaveLength(1)

    act(() => live(path).onNext(snapshot('v1')))
    expect(result.current[key].map(r => r._docId)).toEqual(['v1'])
  })

  it('keeps the rows it had when its listener fails later', () => {
    const { result } = renderHook(() => hook(CLIENT))
    act(() => live(path).onNext(snapshot('c1row')))
    const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    act(() => live(path).onError(failure))
    expect(result.current[key].map(r => r._docId)).toEqual(['c1row'])
    expect(result.current.error).toBe(failure)
  })
})

// Subcontractors, materials, daily reports, urgent items, history, supplier
// invoices, the app settings and the agent alerts are staff only. For anyone else
// the hooks listen to nothing at all, and give an empty list (or no settings).
describe.each([
  ['useSubs', useSubs, 'subs', 'subs', []],
  ['useMaterials', useMaterials, 'materials', 'materials', []],
  ['useDailyReports', useDailyReports, 'dailyReports', 'daily_reports', []],
  ['useUrgentItems', useUrgentItems, 'urgentItems', 'urgent_items', []],
  ['useHistory', useHistory, 'history', 'history', []],
  ['useSupplierInvoices', useSupplierInvoices, 'invoices', 'supplier_invoices', []],
  ['useSettings', useSettings, 'settings', 'config/settings', {}],
  ['useAgentAlerts', useAgentAlerts, 'alerts', 'agent_alerts', []],
])('%s for staff only', (_name, hook, key, path, empty) => {
  it.each(['owner', 'internal'])('listens for %s staff', (role) => {
    renderHook(() => hook({ role, tenantId: 'p2-core', uid: 'u1' }))
    expect(live(path)).toBeDefined()
    expect(filters(live(path))).toEqual([])
  })

  it.each([
    ['a builder', BUILDER],
    ['a client', CLIENT],
    ...NO_ACCESS,
  ])('listens to nothing for %s, and reports no rows, no error and nothing loading', (_label, scope) => {
    const { result } = renderHook(() => hook(scope))
    expect(listeners).toHaveLength(0)
    expect(result.current).toEqual({ [key]: empty, loading: false, error: null })
  })

  it('keeps its listener when staff switch workspace', () => {
    const { rerender } = renderHook(({ scope }) => hook(scope), {
      initialProps: { scope: { role: 'internal', tenantId: 'p2-core', uid: 's1' } },
    })
    const first = live(path)
    rerender({ scope: { role: 'internal', tenantId: 'vision', uid: 's1' } })
    expect(live(path)).toBe(first)
    expect(listeners).toHaveLength(1)
  })
})

// While a hook waits for its first snapshot, and when it may read nothing, it gives
// the same frozen empty value on every render, so a screen effect keyed on that value
// does not run again each time the screen renders.
describe.each([
  ['useJobs', useJobs, 'jobs', []],
  ['useSubs', useSubs, 'subs', []],
  ['useAgentAlerts', useAgentAlerts, 'alerts', []],
  ['useSettings', useSettings, 'settings', {}],
])('%s empty value', (_name, hook, key, empty) => {
  it.each([
    ['while it waits', STAFF],
    ['without access', null],
  ])('is the same frozen value on every render %s', (_label, scope) => {
    const { result, rerender } = renderHook(() => hook(scope))
    const first = result.current[key]
    expect(first).toEqual(empty)
    rerender()
    expect(result.current[key]).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })
})

// The table above covers each hook in detail. This one walks everything the
// module exports, so a hook added later that swallows its error fails here too.
describe('every hook the module exports', () => {
  const hookNames = Object.keys(firestoreModule).filter(name => /^use[A-Z]/.test(name))
  // Hooks that listen to one record take its id. Every other hook takes the signed
  // in user's scope first, and staff may read everything.
  const RECORD_HOOKS = ['useJobFiles', 'useSubmitReplies']
  const argumentFor = (name) => (RECORD_HOOKS.includes(name) ? 'some-id' : STAFF)

  it('includes the ones this test is meant to cover', () => {
    expect(hookNames).toContain('useJobs')
    expect(hookNames).toContain('useSubmitReplies')
  })

  it.each(hookNames)('%s returns the error its subscription fails with', (name) => {
    const { result } = renderHook(() => firestoreModule[name](argumentFor(name)))
    expect(listeners.length).toBeGreaterThan(0)
    const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    act(() => { for (const listener of listeners) listener.onError(failure) })
    expect(result.current.error).toBe(failure)
  })
})
