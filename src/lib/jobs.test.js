import { describe, it, expect } from 'vitest'
import {
  jobName, phaseLabel, isJobComplete, jobStaleness, jobMatchesFilter,
  JOB_FILTERS, JOB_FORM_INITIAL,
} from './jobs'

describe('jobName', () => {
  it('prefers name', () => {
    expect(jobName({ name: 'Maple', client: 'Acme Holdings', id: 'J1' })).toBe('Maple')
  })
  it('falls back to client first word', () => {
    expect(jobName({ client: 'Acme Holdings', id: 'J1' })).toBe('Acme')
  })
})

describe('phaseLabel', () => {
  it('buckets progress into phases', () => {
    expect(phaseLabel(0)).toBe('Rough-In Phase')
    expect(phaseLabel(33)).toBe('Rough-In Phase')
    expect(phaseLabel(34)).toBe('Mid Phase')
    expect(phaseLabel(66)).toBe('Mid Phase')
    expect(phaseLabel(67)).toBe('Final Phase')
    expect(phaseLabel(100)).toBe('Final Phase')
  })
})

describe('isJobComplete', () => {
  it('recognizes both spellings', () => {
    expect(isJobComplete({ status: 'complete' })).toBe(true)
    expect(isJobComplete({ status: 'completed' })).toBe(true)
    expect(isJobComplete({ status: 'active' })).toBe(false)
  })
})

describe('jobMatchesFilter', () => {
  const fresh = { status: 'active', insp: {} }
  const failed = { status: 'active', insp: { hvac: { final: 'failed' } } }
  const complete = { status: 'complete', insp: {} }

  it('all matches everything', () => {
    expect(jobMatchesFilter(fresh, 'all')).toBe(true)
    expect(jobMatchesFilter(complete, 'all')).toBe(true)
  })
  it('active excludes complete', () => {
    expect(jobMatchesFilter(fresh, 'active')).toBe(true)
    expect(jobMatchesFilter(complete, 'active')).toBe(false)
  })
  it('complete matches only complete', () => {
    expect(jobMatchesFilter(complete, 'complete')).toBe(true)
    expect(jobMatchesFilter(fresh, 'complete')).toBe(false)
  })
  it('blocked matches failed inspection', () => {
    expect(jobMatchesFilter(failed, 'blocked')).toBe(true)
  })
  it('needs-action matches failed inspection too', () => {
    expect(jobMatchesFilter(failed, 'needs-action')).toBe(true)
  })
})

describe('JOB_FILTERS', () => {
  it('every filter has id + label', () => {
    JOB_FILTERS.forEach(f => {
      expect(typeof f.id).toBe('string')
      expect(typeof f.label).toBe('string')
    })
  })
})

describe('JOB_FORM_INITIAL', () => {
  it('starts empty for required fields', () => {
    expect(JOB_FORM_INITIAL.id).toBe('')
    expect(JOB_FORM_INITIAL.address).toBe('')
    expect(JOB_FORM_INITIAL.client).toBe('')
  })
})

describe('jobStaleness', () => {
  it('returns null when no dates set', () => {
    expect(jobStaleness({})).toBeNull()
  })
  it('uses lastStatusChange when present', () => {
    const d = new Date(); d.setDate(d.getDate() - 5)
    const s = jobStaleness({ lastStatusChange: d.toISOString().slice(0, 10) })
    expect(s).toBeGreaterThanOrEqual(4)
  })
})
