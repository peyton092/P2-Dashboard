import { describe, it, expect } from 'vitest'
import { jobEvents, EVENT_META, jobLabel, isoDay, todayKey } from './jobEvents'

describe('jobLabel', () => {
  it('prefers name, then client, then id', () => {
    expect(jobLabel({ name: 'Maple' })).toBe('Maple')
    expect(jobLabel({ client: 'Acme' })).toBe('Acme')
    expect(jobLabel({ id: 'JOB-1' })).toBe('JOB-1')
    expect(jobLabel(null)).toBe('')
  })
})

describe('isoDay', () => {
  it('truncates to YYYY-MM-DD', () => {
    expect(isoDay('2025-05-15T12:00:00Z')).toBe('2025-05-15')
    expect(isoDay('2025-05-15')).toBe('2025-05-15')
    expect(isoDay(null)).toBe('')
  })
})

describe('todayKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    const key = todayKey()
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('EVENT_META', () => {
  it('has the four core event types', () => {
    expect(EVENT_META.target).toBeDefined()
    expect(EVENT_META.start).toBeDefined()
    expect(EVENT_META.pass).toBeDefined()
    expect(EVENT_META.fail).toBeDefined()
    expect(EVENT_META.scheduled).toBeDefined()
  })
})

describe('jobEvents', () => {
  it('emits target + start events when set', () => {
    const evs = jobEvents({ id: 'J1', target: '2025-05-15', start: '2025-01-01' })
    expect(evs.find(e => e.type === 'target')).toBeDefined()
    expect(evs.find(e => e.type === 'start')).toBeDefined()
  })
  it('emits pass for rough-in and final dates', () => {
    const evs = jobEvents({
      id: 'J1',
      insp: {
        electrical: { roughIn: 'passed', roughInDate: '2025-03-02', final: 'passed', finalDate: '2025-04-02' },
      },
    })
    expect(evs.filter(e => e.type === 'pass').length).toBe(2)
  })
  it('emits fail when status is failed', () => {
    const evs = jobEvents({
      id: 'J1',
      insp: { hvac: { roughIn: 'failed', roughInDate: '2025-03-02' } },
    })
    expect(evs.find(e => e.type === 'fail')).toBeDefined()
  })
  it('emits scheduled when scheduled date set with no outcome', () => {
    const evs = jobEvents({
      id: 'J1',
      insp: { plumbing: { roughInScheduled: '2025-05-22' } },
    })
    expect(evs.find(e => e.type === 'scheduled')).toBeDefined()
  })
  it('skips scheduled if the phase has already happened', () => {
    const evs = jobEvents({
      id: 'J1',
      insp: { plumbing: { roughIn: 'passed', roughInDate: '2025-05-01', roughInScheduled: '2025-05-22' } },
    })
    expect(evs.find(e => e.type === 'scheduled')).toBeUndefined()
  })
  it('every event has a jobId', () => {
    const evs = jobEvents({ id: 'J1', target: '2025-05-15' })
    evs.forEach(e => expect(e.jobId).toBe('J1'))
  })
})
