import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'

// A button holds phrasing content only: words, icons and spans. A paragraph, a div or a
// heading inside one is invalid HTML, and some screen readers read each block as a line of
// its own, so the rows of the PM dashboard, the lists of the Command Center and the rows of
// the activity feed lay their lines out with spans that display as blocks. Everything that
// would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({ data: { jobs: [], extras: [], loading: false }, history: [] }))

vi.mock('../../firebase', () => ({ auth: {}, storage: {}, db: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  onSnapshot: () => () => {},
}))
vi.mock('../../hooks/useFirestore', () => ({ updateJob: vi.fn(), useHistory: () => ({ history: mocks.history }) }))
// Recharts measures its box, which jsdom does not have, and says so. The donut of the
// Command Center is drawn by plain boxes here.
vi.mock('recharts', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }) => h('div', null, children)
  return { ResponsiveContainer: box, PieChart: box, Pie: box, Cell: () => null }
})
// The chip in every page header asks this hook for the connection; the real one starts Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import PMDashboard from '../PMDashboard'
import CommandCenter from '../CommandCenter'
import Activity from '../Activity'

afterEach(cleanup)

// A job that is at risk: blocked, with a failed inspection, owned by a PM.
const JOB = {
  id: 'QBS-003',
  _docId: 'job3',
  name: 'Lee Residence',
  client: 'Dana Lee',
  address: '123 Main St',
  pm: 'Blake Neblett',
  status: 'blocked',
  progress: 40,
  insp: { electrical: { roughIn: 'failed' } },
}

const BLOCKS = 'p, div, ul, ol, li, h1, h2, h3, h4, h5, h6, section, header, footer, table'
const blocksInButtons = () =>
  screen.getAllByRole('button').flatMap((button) =>
    [...button.querySelectorAll(BLOCKS)].map((block) => `${block.tagName} in "${button.textContent.slice(0, 40)}"`),
  )

describe('the buttons of the PM dashboard', () => {
  it('hold nothing but phrasing content, closed and open', () => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
    render(<PMDashboard />)
    expect(blocksInButtons()).toEqual([])

    fireEvent.click(screen.getAllByRole('button').find((button) => button.hasAttribute('aria-expanded') && /Blake/.test(button.textContent)))
    expect(blocksInButtons()).toEqual([])
  })

  it('have no accessibility violations in a PM row', async () => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
    render(<PMDashboard />)
    const row = screen.getAllByRole('button').find((button) => button.hasAttribute('aria-expanded') && /Blake/.test(button.textContent))
    expect(await axe(row)).toHaveNoViolations()
  })
})

describe('the buttons of the Command Center', () => {
  it('hold nothing but phrasing content', () => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
    render(<CommandCenter />)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(5)
    expect(blocksInButtons()).toEqual([])
  })
})

describe('the rows of the activity feed', () => {
  // A change with a job opens it, so its row is a button; a change without one and an event
  // are rows too, switched off.
  const feed = () => {
    mocks.data = {
      jobs: [JOB],
      extras: [],
      loading: false,
      scope: { role: 'owner' },
      notifs: [{ _docId: 'n1', msg: 'CO-004 approved', type: 'info', createdAt: '2026-10-18T09:00:00' }],
    }
    mocks.history = [
      { _docId: 'h1', summary: 'QBS-003 moved to blocked', jobId: 'QBS-003', actor: 'Blake Neblett', type: 'job', createdAt: '2026-10-18T10:00:00' },
      { _docId: 'h2', summary: 'Prices updated', type: 'default', createdAt: '2026-10-18T08:00:00' },
    ]
    return render(<Activity />)
  }

  it('hold nothing but phrasing content', () => {
    feed()
    expect(screen.getByRole('button', { name: /QBS-003 moved to blocked/ })).toBeTruthy()
    expect(blocksInButtons()).toEqual([])
  })

  it('have no accessibility violations', async () => {
    const { container } = feed()
    expect(await axe(container)).toHaveNoViolations()
  })
})
