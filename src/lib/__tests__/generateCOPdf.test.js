import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'

// A stand in for jsPDF that keeps what was drawn, in order, so the test can read
// the color the status text was set in.
const calls = []
vi.mock('jspdf', () => {
  class FakeDoc {
    constructor() { calls.length = 0 }
    text(t) { calls.push(['text', String(t)]) }
    setTextColor(...rgb) { calls.push(['color', rgb]) }
    splitTextToSize(t) { return [String(t)] }
    getTextWidth(t) { return String(t).length * 5 }
    save() {}
  }
  for (const m of [
    'setFillColor', 'rect', 'setFont', 'setFontSize', 'setCharSpace',
    'setDrawColor', 'setLineWidth', 'line', 'roundedRect', 'addPage',
  ]) FakeDoc.prototype[m] = function () {}
  return { jsPDF: FakeDoc }
})

import { generateCOPdf } from '../generateCOPdf'

beforeEach(() => { calls.length = 0 })

// The status is printed under the STATUS heading, in the color set just before it.
async function printed(co) {
  await generateCOPdf({ coNumber: 'CO-2026-001', job: 'QBS-003', date: '2026-10-01', lineItems: [], ...co }, 'QBS-003 Lee Residence')
  const index = calls.findIndex(([kind, value]) => kind === 'text' && /^(DRAFT|SENT TO BUILDER|APPROVED|REJECTED)$/.test(value))
  expect(index, 'the status is printed').toBeGreaterThan(-1)
  const color = calls.slice(0, index).reverse().find(([kind]) => kind === 'color')
  return { words: calls[index][1], rgb: color[1] }
}

describe('generateCOPdf status', () => {
  it.each([
    ['Draft', 'DRAFT', 'mute'],
    ['Sent to Builder', 'SENT TO BUILDER', 'info'],
    ['Approved', 'APPROVED', 'success'],
    ['Rejected', 'REJECTED', 'critical'],
  ])('prints status %s as %s in the color of the %s tone', async (status, words, tone) => {
    expect(await printed({ status })).toEqual({ words, rgb: hexToRgb(TONE_HEX[tone]) })
  })

  it('prints an older lower case status as the one it stands for', async () => {
    expect(await printed({ status: 'approved' })).toEqual({ words: 'APPROVED', rgb: hexToRgb(TONE_HEX.success) })
    expect(await printed({ status: 'pending' })).toEqual({ words: 'SENT TO BUILDER', rgb: hexToRgb(TONE_HEX.info) })
  })

  it('prints a change order with no status as a draft', async () => {
    expect(await printed({})).toEqual({ words: 'DRAFT', rgb: hexToRgb(TONE_HEX.mute) })
  })
})
