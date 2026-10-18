import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const listeners = []

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path: path.join('/') }),
  doc: vi.fn(),
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

import { useJobFiles, useSubmitReplies } from '../useFirestore'

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
})
