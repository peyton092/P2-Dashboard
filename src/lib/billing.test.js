import { describe, it, expect } from 'vitest'
import { BILLING_STATUSES, BILLING_STATUS_LABEL, BILLING_STATUS_COLOR } from './billing'

describe('BILLING_STATUSES', () => {
  it('lists the four states', () => {
    expect(BILLING_STATUSES).toEqual(['not-invoiced', 'invoiced', 'partial-pay', 'paid'])
  })
  it('has a label + color for every state', () => {
    BILLING_STATUSES.forEach(s => {
      expect(typeof BILLING_STATUS_LABEL[s]).toBe('string')
      expect(BILLING_STATUS_COLOR[s]).toMatch(/^#/)
    })
  })
})
