import { describe, it, expect, beforeEach } from 'vitest'
import { getSavedViews, saveView, deleteView } from './savedViews'

beforeEach(() => {
  localStorage.clear()
})

describe('saveView / getSavedViews / deleteView', () => {
  it('returns empty when nothing saved', () => {
    expect(getSavedViews('jobs')).toEqual({})
  })

  it('round-trips a view payload', () => {
    saveView('jobs', 'Critical', { filter: 'at-risk', pmFilter: 'all' })
    const views = getSavedViews('jobs')
    expect(views.Critical?.payload).toEqual({ filter: 'at-risk', pmFilter: 'all' })
    expect(typeof views.Critical?.updatedAt).toBe('number')
  })

  it('overwrites an existing name', () => {
    saveView('jobs', 'A', { filter: 'all' })
    saveView('jobs', 'A', { filter: 'blocked' })
    expect(getSavedViews('jobs').A.payload.filter).toBe('blocked')
  })

  it('rejects empty names', () => {
    expect(saveView('jobs', '',     { filter: 'all' })).toBe(false)
    expect(saveView('jobs', '   ',  { filter: 'all' })).toBe(false)
    expect(getSavedViews('jobs')).toEqual({})
  })

  it('scopes are independent', () => {
    saveView('jobs',    'X', { a: 1 })
    saveView('billing', 'X', { b: 2 })
    expect(getSavedViews('jobs').X.payload).toEqual({ a: 1 })
    expect(getSavedViews('billing').X.payload).toEqual({ b: 2 })
  })

  it('deleteView removes a saved view', () => {
    saveView('jobs', 'Removable', { filter: 'all' })
    expect(deleteView('jobs', 'Removable')).toBe(true)
    expect(getSavedViews('jobs').Removable).toBeUndefined()
  })

  it('deleteView returns false when name unknown', () => {
    expect(deleteView('jobs', 'Nope')).toBe(false)
  })
})
