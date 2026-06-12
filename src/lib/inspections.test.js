import { describe, it, expect } from 'vitest'
import {
  INSP_STATUSES, TRADE_META, PHASE_LABEL,
  inspectionStatusTone, inspectionStatusLabel, inspJobStatusTone,
} from './inspections'

describe('inspectionStatusTone', () => {
  it('maps each known status to a tone', () => {
    expect(inspectionStatusTone('passed')).toBe('success')
    expect(inspectionStatusTone('failed')).toBe('critical')
    expect(inspectionStatusTone('scheduled')).toBe('warning')
    expect(inspectionStatusTone('blocked')).toBe('info')
    expect(inspectionStatusTone('pending')).toBe('mute')
    expect(inspectionStatusTone('pending-verification')).toBe('mute')
    expect(inspectionStatusTone('n/a')).toBe('neutral')
  })
  it('falls back to neutral for unknown', () => {
    expect(inspectionStatusTone('weird')).toBe('neutral')
    expect(inspectionStatusTone(undefined)).toBe('neutral')
  })
})

describe('inspectionStatusLabel', () => {
  it('returns human-readable strings', () => {
    expect(inspectionStatusLabel('passed')).toBe('Passed')
    expect(inspectionStatusLabel('failed')).toBe('Failed')
    expect(inspectionStatusLabel('n/a')).toBe('N/A')
  })
  it('title-cases unknown values', () => {
    expect(inspectionStatusLabel('quality-check')).toBe('Quality Check')
  })
  it('defaults missing to Pending', () => {
    expect(inspectionStatusLabel(undefined)).toBe('Pending')
  })
})

describe('inspJobStatusTone', () => {
  it('success for completion + on-track', () => {
    expect(inspJobStatusTone('complete')).toBe('success')
    expect(inspJobStatusTone('on-track')).toBe('success')
    expect(inspJobStatusTone('completed')).toBe('success')
  })
  it('critical for blocked/hold', () => {
    expect(inspJobStatusTone('blocked')).toBe('critical')
    expect(inspJobStatusTone('hold')).toBe('critical')
  })
  it('brand for needs-action / active', () => {
    expect(inspJobStatusTone('needs-action')).toBe('brand')
    expect(inspJobStatusTone('active')).toBe('brand')
  })
  it('warning for at-risk', () => {
    expect(inspJobStatusTone('at-risk')).toBe('warning')
  })
  it('mute for pending', () => {
    expect(inspJobStatusTone('pending')).toBe('mute')
  })
  it('neutral for unknown values', () => {
    expect(inspJobStatusTone('whatever')).toBe('neutral')
    expect(inspJobStatusTone(undefined)).toBe('neutral')
  })
})

describe('static maps', () => {
  it('TRADE_META has the three trades with phases', () => {
    expect(Object.keys(TRADE_META).sort()).toEqual(['electrical', 'hvac', 'plumbing'])
    expect(TRADE_META.electrical.phases).toEqual(['roughIn', 'trim', 'final'])
    expect(TRADE_META.plumbing.phases).toEqual(['roughIn', 'final'])
  })
  it('PHASE_LABEL covers three phases', () => {
    expect(PHASE_LABEL.roughIn).toBe('Rough-In')
    expect(PHASE_LABEL.final).toBe('Final')
  })
  it('INSP_STATUSES non-empty and unique', () => {
    expect(INSP_STATUSES.length).toBeGreaterThan(0)
    expect(new Set(INSP_STATUSES).size).toBe(INSP_STATUSES.length)
  })
})
