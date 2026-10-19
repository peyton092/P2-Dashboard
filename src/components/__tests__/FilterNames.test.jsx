import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// The lists beside the search box filter and sort what a screen shows. A closed list shows
// only what is picked in it, All PMs or Sort · Priority, so each one has a name that says
// what it picks. Everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({ data: { jobs: [], extras: [], loading: false } }))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({ updateJob: vi.fn() }))
// The chip in every page header asks this hook for the connection; the real one starts Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import BillingQueue from '../BillingQueue'
import WarRoom from '../WarRoom'

afterEach(cleanup)

const JOB = { id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', pm: 'Blake Neblett', status: 'active', start: '2026-10-01' }

describe.each([
  ['the billing queue', BillingQueue, ['Filter by PM', 'Sort by']],
  ['the War Room', WarRoom, ['Filter by zone', 'Sort by']],
])('the lists of %s', (_, Screen, names) => {
  it('each say what they pick', () => {
    mocks.data = { jobs: [JOB], extras: [], loading: false }
    render(<Screen />)

    for (const name of names) {
      expect(screen.getByRole('combobox', { name }).tagName, name).toBe('SELECT')
    }
  })
})
