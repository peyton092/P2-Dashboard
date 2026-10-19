import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// A day that a form saved is a bare date such as 2026-11-20, and the Date constructor
// reads that as midnight UTC. In Nashville that is the evening before, so a screen that
// shows it through the constructor names the day before, all day. Each screen here has
// its own way of writing a saved day, and each is shown a project dated the 20th and
// must write the 20th, in the zone the person is in. Chicago is behind UTC, Auckland is
// ahead of it, and UTC is the control, where a wrong reading passes. The test sets the
// zone itself by assigning process.env.TZ, which Node honours at once. Everything that
// would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: null,
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ auth: {}, storage: {}, db: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
// Brand looks for logo files over the network when it mounts.
vi.mock('../brand/Brand', () => ({
  default: () => null,
  BrandMark: () => null,
}))
vi.mock('../../hooks/useFirestore', () => ({
  approveExtra: vi.fn(),
  rejectExtra: vi.fn(),
  useJobFiles: () => ({ files: [], loading: false, error: null }),
  useSubmitReplies: () => ({ replies: [], loading: false, error: null }),
  addSubmit: vi.fn(),
  addSubmitReply: vi.fn(),
  updateSubmit: vi.fn(),
  addJobFile: vi.fn(),
  updateNotification: vi.fn(),
  updateJob: vi.fn(),
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import ClientPortal from '../ClientPortal'
import QBSBuilderPortal from '../QBSBuilderPortal'
import JobDetail from '../JobDetail'
import WarRoom from '../WarRoom'
import PMDashboard from '../PMDashboard'

const ZONES = ['America/Chicago', 'Pacific/Auckland', 'UTC']

const originalZone = process.env.TZ

// Today is the 18th. The target is more than a week away, which is when the screens
// write the date and not the days to go.
const JOB = {
  id: 'QBS-003',
  _docId: 'job3',
  name: 'Lee Residence',
  client: 'Dana Lee',
  address: '123 Main St',
  status: 'active',
  tenantId: 'qbs',
  pm: 'Blake Neblett',
  qbsPM: 'Taylor Hensley',
  start: '2026-10-15',
  target: '2026-11-20',
  serviceReleaseDate: '2026-10-25',
  phase: 'service-release-passed',
  insp: { electrical: { roughIn: 'passed', roughInDate: '2026-10-18', final: 'passed', finalDate: '2026-11-02' } },
}

const portalData = (scope) => ({
  jobs: [JOB],
  extras: [],
  submits: [],
  notifs: [],
  loading: false,
  error: null,
  role: scope.role,
  tenantId: scope.tenantId,
  uid: scope.uid,
  scope,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  mocks.data = { jobs: [JOB], extras: [], materials: [], dailyReports: [], loading: false }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

// Half past nine on the evening of the 18th, when it is already the 19th in UTC.
function inZone(zone) {
  process.env.TZ = zone
  vi.setSystemTime(new Date(2026, 9, 18, 21, 30))
}

describe.each(ZONES)('in %s', (zone) => {
  it('the job page names the target, the start and each inspection by the day that was saved', () => {
    inZone(zone)
    render(<ToastContext.Provider value={mocks.toast}><JobDetail jobId="QBS-003" onBack={() => {}} /></ToastContext.Provider>)
    expect(screen.getByText('Nov 20, 2026')).toBeTruthy()
    expect(screen.getByText('Started Oct 15, 2026')).toBeTruthy()
    expect(screen.getByText('Oct 18, 2026')).toBeTruthy()
    expect(screen.getByText('Nov 2, 2026')).toBeTruthy()
  })

  it('the War Room names the target by the day that was saved', () => {
    inZone(zone)
    render(<WarRoom />)
    expect(screen.getAllByText('Due Nov 20').length).toBeGreaterThan(0)
    expect(screen.queryByText('Due Nov 19')).toBeNull()
  })

  it('the PM dashboard names the target by the day that was saved', () => {
    inZone(zone)
    render(<PMDashboard />)
    fireEvent.click(screen.getAllByRole('button').find((button) => button.hasAttribute('aria-expanded') && /Blake/.test(button.textContent)))
    expect(screen.getAllByText('Due Nov 20').length).toBeGreaterThan(0)
    expect(screen.queryByText('Due Nov 19')).toBeNull()
  })

  it('the client portal names each inspection and each milestone by the day that was saved', () => {
    inZone(zone)
    mocks.data = portalData({ role: 'client', tenantId: null, uid: 'c1' })
    render(<ToastContext.Provider value={mocks.toast}><ClientPortal clientName="Lee Homes" userName="Dana Lee" /></ToastContext.Provider>)
    expect(screen.getAllByText('Oct 18').length).toBeGreaterThan(0)
    expect(screen.queryByText('Oct 17')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: /Schedule/ })[0])
    for (const day of ['Oct 15, 2026', 'Oct 18, 2026', 'Oct 25, 2026', 'Nov 2, 2026', 'Nov 20, 2026']) {
      expect(screen.getAllByText(day).length, day).toBeGreaterThan(0)
    }
  })

  it('the builder portal names each inspection by the day that was saved', () => {
    inZone(zone)
    mocks.data = portalData({ role: 'builder', tenantId: 'qbs', uid: 'b1' })
    render(<ToastContext.Provider value={mocks.toast}><QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" /></ToastContext.Provider>)
    expect(screen.getAllByText('Oct 18').length).toBeGreaterThan(0)
    expect(screen.queryByText('Oct 17')).toBeNull()
  })
})
