import { describe, it, expect } from 'vitest'
import { agentFields, STATIC_JOBS, STATIC_EXTRAS, STATIC_SUBS, STATIC_MATERIALS } from './seedData'

describe('agentFields', () => {
  it('maps a known PM to their zone', () => {
    const f = agentFields({ pm: 'Blake Neblett', type: 'Full MEP Renovation' })
    expect(f.zoneId).toBe('zone-1')
  })

  it('falls back to zone-7 for an unknown PM', () => {
    expect(agentFields({ pm: 'Nobody Real' }).zoneId).toBe('zone-7')
    expect(agentFields({}).zoneId).toBe('zone-7')
  })

  it('uses a sensible default contract value', () => {
    const f = agentFields({})
    expect(typeof f.contractValue).toBe('number')
    expect(f.contractValue).toBeGreaterThan(0)
  })

  it('initializes the agent state fields', () => {
    const f = agentFields({})
    expect(f.nextAction).toBe('')
    expect(f.nextActionDue).toBeNull()
    expect(f.nextActionAssignedTo).toBeNull()
    expect(f.materialStatus).toBe('unknown')
    expect(f.gcReadyConfirmed).toBeNull()
  })

  it('stamps a seed version', () => {
    const f = agentFields({})
    expect(typeof f._seedVersion).toBe('number')
  })
})

describe('static fixtures', () => {
  it('every static collection is a non-empty array', () => {
    expect(Array.isArray(STATIC_JOBS) && STATIC_JOBS.length > 0).toBe(true)
    expect(Array.isArray(STATIC_EXTRAS) && STATIC_EXTRAS.length > 0).toBe(true)
    expect(Array.isArray(STATIC_SUBS) && STATIC_SUBS.length > 0).toBe(true)
    expect(Array.isArray(STATIC_MATERIALS) && STATIC_MATERIALS.length > 0).toBe(true)
  })

  it('every seeded job has an id and a status', () => {
    STATIC_JOBS.forEach(j => {
      expect(typeof j.id).toBe('string')
      expect(j.id.length).toBeGreaterThan(0)
      expect(typeof j.status).toBe('string')
    })
  })

  it('every seeded sub has a name and a trade', () => {
    STATIC_SUBS.forEach(s => {
      expect(typeof s.name).toBe('string')
      expect(typeof s.trade).toBe('string')
    })
  })
})
