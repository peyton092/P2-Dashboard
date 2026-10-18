import { describe, it, expect } from 'vitest'
import { generateInvoicePdf, invoicePdfErrorToast } from '../generateInvoicePdf'

describe('generateInvoicePdf', () => {
  it('refuses to invent an amount when the job has no contract value', async () => {
    await expect(generateInvoicePdf({ id: 'J1', invoiceNum: '1' })).rejects.toThrow('Job has no contract value')
    await expect(generateInvoicePdf({ id: 'J1', contractValue: -1 })).rejects.toThrow('Job has no contract value')
  })
})

describe('invoicePdfErrorToast', () => {
  it('explains the missing contract value', () => {
    const t = invoicePdfErrorToast(new Error('Job has no contract value'))
    expect(t.description).toBe('Add a contract value to this job before generating an invoice.')
    expect(t.tone).toBe('error')
  })
  it('falls back to a generic message for other errors', () => {
    expect(invoicePdfErrorToast(new Error('boom')).description).toBe('Could not generate the invoice PDF. Try again.')
  })
})
