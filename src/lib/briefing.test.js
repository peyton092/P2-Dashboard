import { describe, it, expect } from 'vitest'
import {
  BRIEF_CATEGORY_META, SEVERITY_RANK,
  severityTone, severityColor, buildBriefingItems,
} from './briefing'

const ago = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const inDays = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('severityTone / severityColor', () => {
  it('maps critical / warning / info', () => {
    expect(severityTone('critical')).toBe('critical')
    expect(severityTone('warning')).toBe('warning')
    expect(severityTone('info')).toBe('info')
    expect(severityTone('whatever')).toBe('info')
  })
  it('returns hex colors per severity', () => {
    expect(severityColor('critical')).toMatch(/^#/)
    expect(severityColor('warning')).toMatch(/^#/)
    expect(severityColor('info')).toMatch(/^#/)
  })
})

describe('static maps', () => {
  it('BRIEF_CATEGORY_META has the seven categories with label + Icon + accent', () => {
    const keys = Object.keys(BRIEF_CATEGORY_META).sort()
    expect(keys).toEqual(['billing', 'co', 'inspections', 'job-risk', 'materials', 'pm', 'subs'])
    Object.values(BRIEF_CATEGORY_META).forEach(meta => {
      expect(meta.label).toBeTruthy()
      expect(meta.Icon).toBeTruthy()
      expect(meta.accent).toMatch(/^#/)
    })
  })
  it('SEVERITY_RANK orders critical < warning < info', () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.warning)
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.info)
  })
})

describe('buildBriefingItems', () => {
  const empty = { jobs: [], extras: [], materials: [], subs: [] }

  it('returns [] for empty input', () => {
    expect(buildBriefingItems(empty)).toEqual([])
  })

  it('emits a critical failed-inspection item', () => {
    const jobs = [{
      id: 'J1', status: 'active', pm: 'Blake',
      insp: { hvac: { final: 'failed' } },
    }]
    const items = buildBriefingItems({ ...empty, jobs })
    const fail = items.find(i => i.category === 'job-risk' && i.jobId === 'J1')
    expect(fail?.severity).toBe('critical')
  })

  it('emits a billing-hold item', () => {
    const jobs = [{ id: 'J2', status: 'active', pm: 'X', billingStatus: 'hold' }]
    const items = buildBriefingItems({ ...empty, jobs })
    const hold = items.find(i => i.category === 'billing' && i.jobId === 'J2')
    expect(hold?.severity).toBe('critical')
  })

  it('emits an aging-CO escalation', () => {
    const extras = [{
      id: 'CO-1', job: 'J3', status: 'Sent to Builder',
      sentAt: ago(10), coNumber: 'CO-1',
    }]
    const items = buildBriefingItems({ ...empty, extras })
    const co = items.find(i => i.category === 'co')
    expect(co?.severity).toBe('critical')
  })

  it('emits an overdue-material critical item', () => {
    const materials = [{
      id: 'M1', status: 'Ordered', dateNeeded: ago(2),
      name: 'Wire', qty: 5, unit: 'spools',
    }]
    const items = buildBriefingItems({ ...empty, materials })
    const mat = items.find(i => i.category === 'materials')
    expect(mat?.severity).toBe('critical')
  })

  it('emits a sub insurance-expired critical', () => {
    const subs = [{ id: 's1', name: 'Tony', insExp: ago(1), w9: true }]
    const items = buildBriefingItems({ ...empty, subs })
    const sub = items.find(i => i.category === 'subs')
    expect(sub?.severity).toBe('critical')
  })

  it('emits a sub W-9 missing critical', () => {
    const subs = [{ id: 's2', name: 'Mike', w9: false, insExp: inDays(120), licExp: inDays(120) }]
    const items = buildBriefingItems({ ...empty, subs })
    const sub = items.find(i => i.id.startsWith('sub_w9_'))
    expect(sub?.severity).toBe('critical')
  })

  it('emits a PM workload pressure when ≥10 active jobs', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({
      id: `J${i}`, status: 'active', pm: 'Blake',
    }))
    const items = buildBriefingItems({ ...empty, jobs })
    const pm = items.find(i => i.category === 'pm')
    expect(pm).toBeDefined()
  })

  it('sorts critical items before warnings before info', () => {
    const jobs = [
      { id: 'J-c', status: 'active', pm: 'X', billingStatus: 'hold' },        // critical billing
      { id: 'J-w', status: 'needs-action', pm: 'X' },                          // warning risk
    ]
    const items = buildBriefingItems({ ...empty, jobs })
    const firstRank  = SEVERITY_RANK[items[0].severity]
    const secondRank = SEVERITY_RANK[items[items.length - 1].severity]
    expect(firstRank).toBeLessThanOrEqual(secondRank)
  })
})
