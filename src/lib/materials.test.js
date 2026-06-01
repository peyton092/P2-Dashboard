import { describe, it, expect } from 'vitest'
import {
  MAT_STATUS_OPTIONS, MAT_FILTERS, normalizeMatStatus,
  matName, matJobId, matIsOpen, matIsOverdue, matIsBlocking,
  matDaysUntilNeeded, matMatchesFilter, matNextAction,
} from './materials'

const inDays = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('normalizeMatStatus', () => {
  it('maps legacy values', () => {
    expect(normalizeMatStatus('delivered')).toBe('Delivered')
    expect(normalizeMatStatus('in-transit')).toBe('In Transit')
    expect(normalizeMatStatus('ordered')).toBe('Ordered')
    expect(normalizeMatStatus('pending')).toBe('Ordered')
  })
  it('passes new values through', () => {
    expect(normalizeMatStatus('Delivered')).toBe('Delivered')
    expect(normalizeMatStatus('Cancelled')).toBe('Cancelled')
  })
  it('defaults missing input to Ordered', () => {
    expect(normalizeMatStatus(undefined)).toBe('Ordered')
    expect(normalizeMatStatus(null)).toBe('Ordered')
  })
})

describe('matName / matJobId', () => {
  it('prefers name then item', () => {
    expect(matName({ name: 'X' })).toBe('X')
    expect(matName({ item: 'Y' })).toBe('Y')
    expect(matName({})).toBe('—')
  })
  it('prefers jobId then job', () => {
    expect(matJobId({ jobId: 'J1' })).toBe('J1')
    expect(matJobId({ job: 'J2' })).toBe('J2')
    expect(matJobId({})).toBe('')
  })
})

describe('matIsOpen', () => {
  it('treats Ordered / In Transit as open', () => {
    expect(matIsOpen({ status: 'Ordered' })).toBe(true)
    expect(matIsOpen({ status: 'In Transit' })).toBe(true)
  })
  it('treats Delivered / At Job Site / Used / Cancelled as closed', () => {
    expect(matIsOpen({ status: 'Delivered' })).toBe(false)
    expect(matIsOpen({ status: 'At Job Site' })).toBe(false)
    expect(matIsOpen({ status: 'Used' })).toBe(false)
    expect(matIsOpen({ status: 'Cancelled' })).toBe(false)
  })
})

describe('matDaysUntilNeeded', () => {
  it('returns null without a date', () => {
    expect(matDaysUntilNeeded({})).toBeNull()
  })
  it('returns positive count for future dates', () => {
    expect(matDaysUntilNeeded({ dateNeeded: inDays(5) })).toBeGreaterThanOrEqual(4)
  })
  it('returns negative count for past dates', () => {
    expect(matDaysUntilNeeded({ dateNeeded: inDays(-3) })).toBeLessThanOrEqual(-2)
  })
})

describe('matIsOverdue / matIsBlocking', () => {
  it('overdue requires open + past needed', () => {
    expect(matIsOverdue({ status: 'Ordered', dateNeeded: inDays(-1) })).toBe(true)
    expect(matIsOverdue({ status: 'Delivered', dateNeeded: inDays(-1) })).toBe(false)
  })
  it('blocking requires open + needed within a week', () => {
    expect(matIsBlocking({ status: 'In Transit', dateNeeded: inDays(3) })).toBe(true)
    expect(matIsBlocking({ status: 'In Transit', dateNeeded: inDays(30) })).toBe(false)
  })
})

describe('matMatchesFilter', () => {
  it('all matches everything', () => {
    expect(matMatchesFilter({ status: 'Ordered' }, 'all')).toBe(true)
  })
  it('ordered matches Ordered-status only', () => {
    expect(matMatchesFilter({ status: 'Ordered' },    'ordered')).toBe(true)
    expect(matMatchesFilter({ status: 'In Transit' }, 'ordered')).toBe(false)
  })
  it('delivered matches At Job Site too', () => {
    expect(matMatchesFilter({ status: 'At Job Site' }, 'delivered')).toBe(true)
  })
})

describe('matNextAction', () => {
  it('returns a string for any material', () => {
    expect(typeof matNextAction({ status: 'Ordered' })).toBe('string')
    expect(typeof matNextAction({ status: 'In Transit', dateNeeded: inDays(-2) })).toBe('string')
  })
  it('flags cancelled', () => {
    expect(matNextAction({ status: 'Cancelled' })).toMatch(/cancelled/i)
  })
  it('flags used / on-site / delivered', () => {
    expect(matNextAction({ status: 'Used' })).toMatch(/used/i)
    expect(matNextAction({ status: 'At Job Site' })).toMatch(/on site/i)
    expect(matNextAction({ status: 'Delivered' })).toMatch(/pickup/i)
  })
  it('flags overdue before in-transit copy', () => {
    expect(matNextAction({ status: 'In Transit', dateNeeded: inDays(-3) }))
      .toMatch(/overdue/i)
  })
  it('flags in-transit (not overdue) as "Track delivery"', () => {
    expect(matNextAction({ status: 'In Transit', dateNeeded: inDays(7) }))
      .toMatch(/Track delivery/i)
  })
  it('flags ordered within 7 days as "Confirm with supplier"', () => {
    expect(matNextAction({ status: 'Ordered', dateNeeded: inDays(3) }))
      .toMatch(/Confirm/i)
  })
  it('flags ordered far out as "Waiting on supplier"', () => {
    expect(matNextAction({ status: 'Ordered', dateNeeded: inDays(30) }))
      .toMatch(/Waiting/i)
  })
})

describe('MAT_FILTERS / MAT_STATUS_OPTIONS', () => {
  it('every filter has an id + label', () => {
    MAT_FILTERS.forEach(f => {
      expect(typeof f.id).toBe('string')
      expect(typeof f.label).toBe('string')
    })
  })
  it('status options non-empty', () => {
    expect(MAT_STATUS_OPTIONS.length).toBeGreaterThan(0)
  })
})
