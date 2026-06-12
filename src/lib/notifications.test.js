import { describe, it, expect } from 'vitest'
import {
  NOTIF_FILTERS,
  notifMatchesFilter,
  notifTimestampMs,
  notifIsWithinHours,
  notifCategory,
  notifAgeLabel,
  fmtNotifTime,
} from './notifications'

const mkNotif = (over = {}) => ({
  type: 'info', msg: 'Hello', read: false, ...over,
})

describe('NOTIF_FILTERS', () => {
  it('every filter has id + label', () => {
    NOTIF_FILTERS.forEach(f => {
      expect(typeof f.id).toBe('string')
      expect(typeof f.label).toBe('string')
    })
  })
})

describe('notifMatchesFilter', () => {
  it('all matches everything', () => {
    expect(notifMatchesFilter(mkNotif(), 'all')).toBe(true)
  })
  it('unread excludes read', () => {
    expect(notifMatchesFilter(mkNotif({ read: false }), 'unread')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ read: true }),  'unread')).toBe(false)
  })
  it('action-needed matches warn / error and unread', () => {
    expect(notifMatchesFilter(mkNotif({ type: 'warn',  read: false }), 'action-needed')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ type: 'error', read: false }), 'action-needed')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ type: 'info',  read: false }), 'action-needed')).toBe(false)
    expect(notifMatchesFilter(mkNotif({ type: 'warn',  read: true  }), 'action-needed')).toBe(false)
  })
  it('"read" matches read notifications only', () => {
    expect(notifMatchesFilter(mkNotif({ read: true }),  'read')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ read: false }), 'read')).toBe(false)
  })
  it('category-based filters delegate to notifCategory', () => {
    expect(notifMatchesFilter(mkNotif({ msg: 'Invoice ready' }),       'billing')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ msg: 'Inspection passed' }),   'inspections')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ msg: 'Change order approved' }),'change-orders')).toBe(true)
    expect(notifMatchesFilter(mkNotif({ msg: 'Job J-101 stalled' }),   'billing')).toBe(false)
    expect(notifMatchesFilter(mkNotif({ msg: 'Job J-101 stalled' }),   'system')).toBe(true)
  })
  it('unknown filter falls through to true', () => {
    expect(notifMatchesFilter(mkNotif(), 'nonexistent-filter')).toBe(true)
  })
})

describe('notifTimestampMs', () => {
  it('accepts Firestore Timestamp-like { seconds }', () => {
    expect(notifTimestampMs({ createdAt: { seconds: 1700000000 } })).toBe(1700000000000)
  })
  it('falls back to a string date', () => {
    const ms = notifTimestampMs({ createdAt: '2025-05-01T00:00:00Z' })
    expect(typeof ms).toBe('number')
    expect(ms).toBeGreaterThan(0)
  })
  it('returns null when missing', () => {
    expect(notifTimestampMs({})).toBeNull()
  })
  it('returns null for an unparseable string', () => {
    expect(notifTimestampMs({ createdAt: 'not a date' })).toBeNull()
  })
  it('returns null for unknown shape', () => {
    expect(notifTimestampMs({ createdAt: 42 })).toBeNull()
  })
})

describe('notifIsWithinHours', () => {
  it('detects recent notifications', () => {
    expect(notifIsWithinHours({ createdAt: { seconds: Math.floor((Date.now() - 1000) / 1000) } }, 24)).toBe(true)
  })
  it('rejects stale notifications', () => {
    expect(notifIsWithinHours({ createdAt: { seconds: Math.floor((Date.now() - 1000 * 60 * 60 * 48) / 1000) } }, 24)).toBe(false)
  })
})

describe('notifCategory', () => {
  it('returns a string for any notification', () => {
    expect(typeof notifCategory(mkNotif())).toBe('string')
  })
})

describe('notifAgeLabel', () => {
  const at = (msAgo) => ({ createdAt: { seconds: Math.floor((Date.now() - msAgo) / 1000) } })
  it('returns empty for missing timestamp', () => {
    expect(notifAgeLabel({})).toBe('')
  })
  it('"just now" under a minute', () => {
    expect(notifAgeLabel(at(10_000))).toBe('just now')
  })
  it('minutes within an hour', () => {
    expect(notifAgeLabel(at(15 * 60_000))).toBe('15m ago')
  })
  it('hours within a day', () => {
    expect(notifAgeLabel(at(5 * 60 * 60_000))).toBe('5h ago')
  })
  it('"1d ago" exactly one day', () => {
    expect(notifAgeLabel(at(24 * 60 * 60_000))).toBe('1d ago')
  })
  it('days beyond one', () => {
    expect(notifAgeLabel(at(72 * 60 * 60_000))).toBe('3d ago')
  })
})

describe('fmtNotifTime', () => {
  it('returns empty string when nothing parseable', () => {
    expect(fmtNotifTime({})).toBe('')
  })
  it('falls back to n.time when no createdAt', () => {
    expect(fmtNotifTime({ time: '3:42 PM' })).toBe('3:42 PM')
  })
  it('formats from a Firestore-like timestamp', () => {
    const out = fmtNotifTime({ createdAt: { seconds: Math.floor(Date.parse('2025-05-15T14:30:00Z') / 1000) } })
    expect(typeof out).toBe('string')
    expect(out).toMatch(/May/)
  })
})
