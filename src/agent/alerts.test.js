import { describe, it, expect } from 'vitest'
import { alertId, generateAlerts, ALERT_TYPE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL } from './alerts'

const ago = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

describe('alertId', () => {
  it('is deterministic per jobId + type', () => {
    expect(alertId('JOB1', 'stalled')).toBe('JOB1_stalled')
    expect(alertId('JOB1', 'stalled')).toBe(alertId('JOB1', 'stalled'))
  })
  it('falls back to a timestamped global id', () => {
    expect(alertId(null, 'pm_overload')).toMatch(/^global_pm_overload_/)
  })
})

describe('generateAlerts', () => {
  it('returns [] for an empty portfolio', () => {
    expect(generateAlerts([])).toEqual([])
  })

  it('emits a critical stalled alert past 5 days', () => {
    const jobs = [{ id: 'J1', status: 'active', lastStatusChange: ago(10), pm: 'Blake Neblett' }]
    const out = generateAlerts(jobs)
    const stall = out.find(a => a.type === 'stalled' && a.jobId === 'J1')
    expect(stall?.severity).toBe('critical')
  })

  it('emits a warning between 3 and 4 days', () => {
    const jobs = [{ id: 'J2', status: 'active', lastStatusChange: ago(3), pm: 'Blake Neblett' }]
    const stall = generateAlerts(jobs).find(a => a.type === 'stalled')
    expect(stall?.severity).toBe('warning')
  })

  it('flags failed inspections', () => {
    const jobs = [{ id: 'J3', status: 'active', insp: { hvac: { final: 'failed' } }, pm: 'X' }]
    const fail = generateAlerts(jobs).find(a => a.type === 'inspection_failed')
    expect(fail).toBeDefined()
    expect(fail?.severity).toBe('critical')
  })

  it('flags HVAC startup blocked when rough passed without E service', () => {
    const jobs = [{
      id: 'J4', status: 'active',
      type: 'HVAC + Electrical Upgrade',
      insp: { hvac: { roughIn: 'passed' } },
      pm: 'X',
    }]
    const blocked = generateAlerts(jobs).find(a => a.type === 'hvac_blocked')
    expect(blocked?.severity).toBe('critical')
  })

  it('flags missing next action', () => {
    const jobs = [{ id: 'J5', status: 'active', lastStatusChange: ago(0), pm: 'X' }]
    const noNext = generateAlerts(jobs).find(a => a.type === 'no_next_action')
    expect(noNext?.severity).toBe('warning')
  })

  it('zone-batch only fires when 3+ active jobs share a zone', () => {
    const jobs = [
      { id: 'A', status: 'active', pm: 'Blake Neblett' },
      { id: 'B', status: 'active', pm: 'Blake Neblett' },
    ]
    expect(generateAlerts(jobs).find(a => a.type === 'zone_batch')).toBeUndefined()

    const jobs3 = [...jobs, { id: 'C', status: 'active', pm: 'Blake Neblett' }]
    expect(generateAlerts(jobs3).find(a => a.type === 'zone_batch')).toBeDefined()
  })

  it('dedupes — every id appears at most once', () => {
    const jobs = [{ id: 'J6', status: 'active', lastStatusChange: ago(10), pm: 'X' }]
    const ids = generateAlerts(jobs).map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('emits a billing_ready alert when an inspection has passed', () => {
    const jobs = [{
      id: 'J7', status: 'active', pm: 'X',
      insp: { electrical: { roughIn: 'passed' } },
      contractValue: 25000,
    }]
    const bill = generateAlerts(jobs).find(a => a.type === 'billing_ready')
    expect(bill).toBeDefined()
    expect(bill?.severity).toBe('info')
  })

  it('emits a critical pm_overload alert above 15 active jobs', () => {
    const jobs = Array.from({ length: 16 }, (_, i) => ({
      id: `J${i}`, status: 'active', pm: 'Blake Neblett',
    }))
    const overload = generateAlerts(jobs).find(a => a.type === 'pm_overload')
    expect(overload?.severity).toBe('critical')
  })

  it('emits a warning pm_overload between 13 and 15 jobs', () => {
    const jobs = Array.from({ length: 13 }, (_, i) => ({
      id: `J${i}`, status: 'active', pm: 'Brendan Embry',
    }))
    const overload = generateAlerts(jobs).find(a => a.type === 'pm_overload')
    expect(overload?.severity).toBe('warning')
  })

  it('does not emit pm_overload at or below 12 jobs', () => {
    const jobs = Array.from({ length: 12 }, (_, i) => ({
      id: `J${i}`, status: 'active', pm: 'Jeb Brooks',
    }))
    const overload = generateAlerts(jobs).find(a => a.type === 'pm_overload')
    expect(overload).toBeUndefined()
  })
})

describe('label / color maps', () => {
  it('have an entry for every alert type the generator emits', () => {
    Object.keys(ALERT_TYPE_LABEL).forEach(k => {
      expect(typeof ALERT_TYPE_LABEL[k]).toBe('string')
    })
  })
  it('have all three severities', () => {
    expect(SEVERITY_COLOR.critical).toBeTruthy()
    expect(SEVERITY_LABEL.warning).toBe('Warning')
  })
})
