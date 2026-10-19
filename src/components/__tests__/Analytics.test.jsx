import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TONE_HEX } from '@/lib/tokens'

// Recharts draws nothing useful in jsdom. These stubs keep what a chart was
// given, so the test can read the numbers and colors the screen hands over.
const mocks = vi.hoisted(() => ({ data: { jobs: [], extras: [], loading: false } }))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('recharts', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }) => h('div', null, children)
  const none = () => null
  return {
    ResponsiveContainer: box,
    PieChart: box,
    Pie: ({ data, children }) => h('div', { 'data-testid': 'pie' }, JSON.stringify(data), children),
    Cell: ({ fill }) => h('i', { 'data-cell': fill }),
    BarChart: ({ data, children }) => h('div', { 'data-testid': 'bars' }, JSON.stringify(data), children),
    Bar: ({ dataKey, fill }) => h('i', { 'data-series': dataKey, 'data-fill': fill }),
    Tooltip: none, Legend: none, XAxis: none, YAxis: none, CartesianGrid: none, LabelList: none,
  }
})

import Analytics from '../Analytics'

const extra = (job, status, amount) => ({ job, status, amount })

beforeEach(() => { mocks.data = { jobs: [], extras: [], loading: false } })
afterEach(cleanup)

// The Extras by Job chart is the second bar chart on the page.
const extrasChart = () => JSON.parse(screen.getAllByTestId('bars')[1].firstChild.textContent)
const totalExtras = () => screen.getByText('Total Extras').nextSibling.textContent

describe('Analytics change orders', () => {
  const extras = [
    extra('QBS-001', 'Sent to Builder', 1000),
    extra('QBS-001', 'pending', 500),
    extra('QBS-001', 'Approved', 2000),
    extra('QBS-001', 'approved', 250),
    extra('QBS-001', 'Rejected', 4000),
    extra('QBS-002', 'rejected', 300),
    extra('QBS-003', 'sent-to-qbs', 800),
    extra('QBS-004', 'Draft', 900),
  ]

  it('leaves rejected change orders out of the total', () => {
    mocks.data.extras = extras.filter((e) => e.job === 'QBS-001' || e.job === 'QBS-002')
    render(<Analytics />)
    // 1000 + 500 + 2000 + 250, and not the 4000 and 300 that were rejected
    expect(totalExtras()).toBe('$3,750')
  })

  it('counts a change order however its status is spelled', () => {
    mocks.data.extras = [extra('J', 'Approved', 100), extra('J', 'approved', 10), extra('J', 'Sent to Builder', 5), extra('J', 'pending', 1)]
    render(<Analytics />)
    expect(totalExtras()).toBe('$116')
  })

  it('charts approved money and money waiting on the builder, whichever way the status is written', () => {
    mocks.data.extras = extras
    render(<Analytics />)
    expect(extrasChart()).toEqual(expect.arrayContaining([
      { name: 'QBS-001', approved: 2250, pending: 1500 },
      // sent-to-qbs is an older spelling of Sent to Builder, so it waits for a decision
      { name: 'QBS-003', approved: 0, pending: 800 },
    ]))
  })

  it('leaves rejected and draft change orders out of the chart, and does not draw a job that only has those', () => {
    mocks.data.extras = extras
    render(<Analytics />)
    const names = extrasChart().map((row) => row.name)
    expect(names).not.toContain('QBS-002')
    expect(names).not.toContain('QBS-004')
    const first = extrasChart().find((row) => row.name === 'QBS-001')
    expect(first.approved + first.pending).toBe(3750)
  })

  it('draws the two series in the colors of the Approved and Sent to Builder statuses', () => {
    mocks.data.extras = extras
    render(<Analytics />)
    const fill = (series) => document.querySelector(`[data-series="${series}"]`).getAttribute('data-fill')
    expect(fill('approved')).toBe(TONE_HEX.success)
    expect(fill('pending')).toBe(TONE_HEX.info)
  })
})

describe('Analytics inspections', () => {
  it('colors each inspection status by the vocabulary', () => {
    mocks.data.jobs = [{
      id: 'J1', progress: 50,
      insp: { electrical: { roughIn: 'passed', final: 'failed' }, plumbing: { roughIn: 'scheduled', final: 'pending' }, hvac: { roughIn: 'blocked' } },
    }]
    render(<Analytics />)
    const cells = [...document.querySelectorAll('[data-cell]')].map((cell) => cell.getAttribute('data-cell'))
    expect(cells).toEqual(expect.arrayContaining([TONE_HEX.success, TONE_HEX.critical, TONE_HEX.warning, TONE_HEX.mute, TONE_HEX.info]))
  })

  it('names the job phases in plain words with no dash', () => {
    mocks.data.jobs = [{ id: 'J1', progress: 10 }, { id: 'J2', progress: 50 }, { id: 'J3', progress: 90 }]
    render(<Analytics />)
    const names = JSON.parse(screen.getAllByTestId('pie')[0].firstChild.textContent).map((row) => row.name)
    expect(names).toEqual(['Rough in', 'Mid phase', 'Final phase'])
  })
})
