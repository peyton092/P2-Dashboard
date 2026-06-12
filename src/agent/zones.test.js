import { describe, it, expect } from 'vitest'
import { ZONES, PM_TO_ZONE, getZoneId, getZone, getZoneName } from './zones'

describe('ZONES / PM_TO_ZONE', () => {
  it('all zones have id + name + color', () => {
    Object.values(ZONES).forEach(z => {
      expect(z.id).toBeTruthy()
      expect(z.name).toBeTruthy()
      expect(z.color).toMatch(/^#/)
    })
  })
  it('each PM mapping resolves to a known zone', () => {
    Object.values(PM_TO_ZONE).forEach(zoneId => {
      expect(ZONES[zoneId]).toBeDefined()
    })
  })
})

describe('getZoneId', () => {
  it('prefers explicit zoneId on the job', () => {
    expect(getZoneId({ zoneId: 'zone-4', pm: 'Tim King' })).toBe('zone-4')
  })
  it('falls back to PM mapping', () => {
    expect(getZoneId({ pm: 'Blake Neblett' })).toBe('zone-1')
  })
  it('tries qbsPM next', () => {
    expect(getZoneId({ qbsPM: 'Derek Powers' })).toBe('zone-6')
  })
  it('defaults to zone-7 when nothing matches', () => {
    expect(getZoneId({})).toBe('zone-7')
  })
})

describe('getZone / getZoneName', () => {
  it('getZone returns the full zone record', () => {
    const z = getZone({ pm: 'Jeb Brooks' })
    expect(z.id).toBe('zone-3')
    expect(z.area).toContain('Murfreesboro')
  })
  it('getZoneName resolves known ids', () => {
    expect(getZoneName('zone-1')).toBe('Zone 1')
  })
  it('getZoneName degrades safely', () => {
    expect(getZoneName('nope')).toBe('Zone ?')
  })
})
