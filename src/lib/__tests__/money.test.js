import { describe, it, expect } from 'vitest'
import {
  contractValue,
  invoiceAmount,
  fmtMoney,
  sumContracts,
  sumInvoices,
  missingNote,
} from '../money'

describe('contractValue', () => {
  it('keeps zero as a valid number', () => {
    expect(contractValue({ contractValue: 0 })).toBe(0)
  })
  it('returns null when missing', () => {
    expect(contractValue({})).toBeNull()
    expect(contractValue(null)).toBeNull()
    expect(contractValue({ contractValue: null })).toBeNull()
    expect(contractValue({ contractValue: '' })).toBeNull()
  })
  it('returns null when negative, NaN or non numeric', () => {
    expect(contractValue({ contractValue: -5 })).toBeNull()
    expect(contractValue({ contractValue: NaN })).toBeNull()
    expect(contractValue({ contractValue: 'abc' })).toBeNull()
  })
  it('accepts numeric strings', () => {
    expect(contractValue({ contractValue: '18000' })).toBe(18000)
  })
})

describe('invoiceAmount', () => {
  it('follows the same rules on invoiceAmount', () => {
    expect(invoiceAmount({ invoiceAmount: 50 })).toBe(50)
    expect(invoiceAmount({ invoiceAmount: 0 })).toBe(0)
    expect(invoiceAmount({ invoiceAmount: '12.5' })).toBe(12.5)
    expect(invoiceAmount({})).toBeNull()
    expect(invoiceAmount({ invoiceAmount: -1 })).toBeNull()
    expect(invoiceAmount({ invoiceAmount: 'x' })).toBeNull()
  })
  it('does not fall back to the contract value', () => {
    expect(invoiceAmount({ contractValue: 18000 })).toBeNull()
  })
})

describe('fmtMoney', () => {
  it('formats whole dollars', () => {
    expect(fmtMoney(18000)).toBe('$18,000')
    expect(fmtMoney(0)).toBe('$0')
  })
  it('labels missing values instead of inventing one', () => {
    expect(fmtMoney(null)).toBe('No contract value')
    expect(fmtMoney(undefined)).toBe('No contract value')
  })
})

describe('sumContracts', () => {
  it('sums known values and counts the missing ones', () => {
    expect(sumContracts([{ contractValue: 100 }, {}])).toEqual({ total: 100, missing: 1 })
  })
  it('handles an empty list and zero values', () => {
    expect(sumContracts([])).toEqual({ total: 0, missing: 0 })
    expect(sumContracts([{ contractValue: 0 }])).toEqual({ total: 0, missing: 0 })
  })
})

describe('sumInvoices', () => {
  it('sums known invoice amounts and counts the missing ones', () => {
    expect(sumInvoices([{ invoiceAmount: 50 }, { invoiceAmount: 'x' }])).toEqual({ total: 50, missing: 1 })
  })
})

describe('missingNote', () => {
  it('words the contract footnote', () => {
    expect(missingNote(1, 'contract')).toBe('1 job has no contract value and is excluded')
    expect(missingNote(3, 'contract')).toBe('3 jobs have no contract value and are excluded')
  })
  it('words the invoice footnote', () => {
    expect(missingNote(2, 'invoice')).toBe('2 jobs have no invoice amount and are excluded')
    expect(missingNote(1, 'invoice')).toBe('1 job has no invoice amount and is excluded')
  })
  it('is empty when nothing is missing', () => {
    expect(missingNote(0, 'contract')).toBe('')
  })
})
