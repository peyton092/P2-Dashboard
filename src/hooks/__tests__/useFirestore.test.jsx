import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const listeners = []

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path: path.join('/') }),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  query: (ref) => ref,
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: (q, onNext, onError) => {
    const entry = { path: q.path, onNext, onError, unsubscribed: false }
    listeners.push(entry)
    return () => { entry.unsubscribed = true }
  },
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
vi.mock('../../firebase', () => ({ db: {}, functions: {} }))

import {
  useJobs, useAllExtras, useNotifications, useSubs, useMaterials, usePermits, useSubmits,
  useDailyReports, useUrgentItems, useHistory, useSettings, useAgentAlerts, useSupplierInvoices,
  useJobFiles, useSubmitReplies,
} from '../useFirestore'

const snapshot = (...ids) => ({ docs: ids.map(id => ({ id, data: () => ({ name: id }) })) })
const live = (path) => listeners.filter(l => l.path === path && !l.unsubscribed).at(-1)

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
  ['usePermits', usePermits, 'permits', 'permits'],
  ['useSubmits', useSubmits, 'submits', 'submits'],
  ['useDailyReports', useDailyReports, 'dailyReports', 'daily_reports'],
  ['useUrgentItems', useUrgentItems, 'urgentItems', 'urgent_items'],
  ['useHistory', useHistory, 'history', 'history'],
  ['useSettings', useSettings, 'settings', 'config/settings'],
  ['useAgentAlerts', useAgentAlerts, 'alerts', 'agent_alerts'],
  ['useSupplierInvoices', useSupplierInvoices, 'invoices', 'supplier_invoices'],
])('%s error state', (_name, hook, key, path) => {
  it('has no error while it waits for the first snapshot', () => {
    const { result } = renderHook(() => hook())
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('returns the error Firestore gives it, stops loading, and keeps returning its data', () => {
    const { result } = renderHook(() => hook())
    const before = result.current[key]
    const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    act(() => live(path).onError(failure))
    expect(result.current.error).toBe(failure)
    expect(result.current.loading).toBe(false)
    expect(result.current[key]).toEqual(before)
  })

  it('stops listening when it unmounts', () => {
    const { unmount } = renderHook(() => hook())
    unmount()
    expect(listeners.filter(l => l.path === path && !l.unsubscribed)).toEqual([])
  })
})
