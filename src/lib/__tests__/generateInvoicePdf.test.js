import { describe, it, expect, vi, beforeEach } from 'vitest'

const texts = []
vi.mock('jspdf', () => {
  class FakeDoc {
    constructor() { texts.length = 0 }
    text(t) { texts.push(String(t)) }
    getTextWidth(t) { return String(t).length * 5 }
    save() {}
  }
  for (const m of [
    'setFillColor', 'rect', 'setFont', 'setFontSize', 'setCharSpace', 'setTextColor',
    'setDrawColor', 'setLineWidth', 'line', 'roundedRect',
  ]) FakeDoc.prototype[m] = function () {}
  return { jsPDF: FakeDoc }
})

import { generateInvoicePdf, invoicePdfErrorToast } from '../generateInvoicePdf'

beforeEach(() => { texts.length = 0 })

describe('generateInvoicePdf', () => {
  it('refuses to invent an amount when the job has no contract value', async () => {
    await expect(generateInvoicePdf({ id: 'J1', invoiceNum: '1' })).rejects.toThrow('Job has no contract value')
    await expect(generateInvoicePdf({ id: 'J1', contractValue: -1 })).rejects.toThrow('Job has no contract value')
  })

  it.each([
    ['paid', 'PAID'],
    ['invoiced', 'INVOICED'],
    ['partial-pay', 'PARTIAL PAY'],
    ['not-invoiced', 'NOT INVOICED'],
    [undefined, 'NOT INVOICED'],
  ])('badge for billingStatus %s reads %s', async (billingStatus, label) => {
    await generateInvoicePdf({ id: 'J1', contractValue: 1000, billingStatus })
    expect(texts).toContain(label)
    if (billingStatus !== 'invoiced') expect(texts).not.toContain('INVOICED')
  })

  it('omits the tax line when taxRate is not a number', async () => {
    await generateInvoicePdf({ id: 'J1', contractValue: 1000, taxRate: '0.1' })
    expect(texts.some(t => t.startsWith('Tax'))).toBe(false)
    expect(texts.filter(t => t === '$1,000.00').length).toBe(3)
  })

  it('renders the tax line and a total that includes it when taxRate is a number', async () => {
    await generateInvoicePdf({ id: 'J1', contractValue: 1000, taxRate: 0.1 })
    expect(texts).toContain('Tax (10%)')
    expect(texts).toContain('$100.00')
    expect(texts).toContain('$1,100.00')
  })

  it('renders a zero rate tax line', async () => {
    await generateInvoicePdf({ id: 'J1', contractValue: 1000, taxRate: 0 })
    expect(texts).toContain('Tax (0%)')
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
