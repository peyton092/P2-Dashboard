import { describe, it, expect, beforeEach } from 'vitest'
import { getRecentJobs, pushRecentJob } from './recentJobs'

beforeEach(() => {
  localStorage.clear()
})

describe('recentJobs', () => {
  it('returns empty initially', () => {
    expect(getRecentJobs()).toEqual([])
  })

  it('pushRecentJob prepends the id', () => {
    pushRecentJob('A'); pushRecentJob('B'); pushRecentJob('C')
    expect(getRecentJobs()).toEqual(['C', 'B', 'A'])
  })

  it('dedupes — re-pushing moves to front', () => {
    pushRecentJob('A'); pushRecentJob('B'); pushRecentJob('A')
    expect(getRecentJobs()).toEqual(['A', 'B'])
  })

  it('caps at 6 entries', () => {
    for (let i = 0; i < 10; i++) pushRecentJob(`J${i}`)
    expect(getRecentJobs().length).toBe(6)
  })

  it('ignores empty id', () => {
    pushRecentJob('A')
    pushRecentJob(null)
    pushRecentJob('')
    expect(getRecentJobs()).toEqual(['A'])
  })
})
