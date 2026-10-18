import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = vi.hoisted(() => ({ currentUser: null }))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: vi.fn(),
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
vi.mock('../../firebase', () => ({ db: {}, functions: {}, auth: mockAuth }))

import { withAuthor } from '../useFirestore'

beforeEach(() => { mockAuth.currentUser = null })

describe('withAuthor', () => {
  it('throws when signed out', () => {
    expect(() => withAuthor({ a: 1 })).toThrow('You must be signed in.')
  })

  it('adds the author fields and preserves existing keys', () => {
    mockAuth.currentUser = { uid: 'u1', email: 'a@b.c' }
    expect(withAuthor({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x', createdBy: 'u1', createdByEmail: 'a@b.c' })
  })

  it('records a null email when the user has none', () => {
    mockAuth.currentUser = { uid: 'u2', email: '' }
    expect(withAuthor({}).createdByEmail).toBeNull()
  })
})
