import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// The hooks are replaced by stand ins that record the scope they were called
// with and return the rows a test sets.
const state = vi.hoisted(() => ({ loading: false, errors: {}, rows: {}, scopes: {} }))

vi.mock('../hooks/useFirestore', () => {
  const hook = (name) => (scope) => {
    state.scopes[name] = scope
    return { [name]: state.rows[name] ?? [], loading: state.loading, error: state.errors[name] ?? null }
  }
  return {
    useJobs: hook('jobs'),
    useAllExtras: hook('extras'),
    useNotifications: hook('notifs'),
    useSubs: hook('subs'),
    useMaterials: hook('materials'),
    useSubmits: hook('submits'),
    useDailyReports: hook('dailyReports'),
    useUrgentItems: hook('urgentItems'),
    useSettings: () => ({ settings: null, loading: state.loading, error: state.errors.settings ?? null }),
    useAgentAlerts: () => ({ alerts: [], loading: state.loading, error: state.errors.alerts ?? null }),
  }
})

import { DataProvider } from '../DataContext'
import { useData } from '../use-data'

function renderValue(props = {}) {
  let value
  function Probe() {
    value = useData()
    return null
  }
  render(
    <DataProvider {...props}>
      <Probe />
    </DataProvider>,
  )
  return value
}

const SCOPED_HOOKS = ['jobs', 'extras', 'notifs', 'subs', 'materials', 'submits', 'dailyReports', 'urgentItems']

beforeEach(() => {
  state.loading = false
  state.errors = {}
  state.rows = {}
  state.scopes = {}
})

describe('DataProvider', () => {
  it('exposes empty collections and empty=true when nothing exists after loading', () => {
    state.loading = false
    const value = renderValue()
    expect(value.loading).toBe(false)
    expect(value.jobs.length).toBe(0)
    expect(value.extras.length).toBe(0)
    expect(value.notifs.length).toBe(0)
    expect(value.subs.length).toBe(0)
    expect(value.materials.length).toBe(0)
    expect(value.empty).toBe(true)
    expect('seeded' in value).toBe(false)
  })

  it('reports loading with no jobs and empty=false while collections load', () => {
    state.loading = true
    const value = renderValue()
    expect(value.loading).toBe(true)
    expect(value.jobs.length).toBe(0)
    expect(value.empty).toBe(false)
  })
})

describe('DataProvider error', () => {
  it('is null when no collection failed', () => {
    expect(renderValue().error).toBeNull()
  })

  it.each([
    'jobs', 'extras', 'notifs', 'subs', 'materials', 'submits', 'dailyReports', 'urgentItems', 'settings', 'alerts',
  ])('is the error of the %s subscription when that one failed', (name) => {
    const failure = new Error(`${name} denied`)
    state.errors = { [name]: failure }
    expect(renderValue().error).toBe(failure)
  })

  it('is the first error when several collections failed', () => {
    const extrasFailure = new Error('extras denied')
    const alertsFailure = new Error('alerts denied')
    state.errors = { alerts: alertsFailure, extras: extrasFailure }
    expect(renderValue().error).toBe(extrasFailure)
  })
})

describe('DataProvider scope', () => {
  it('hands the scope it was given to every collection hook', () => {
    const scope = { role: 'builder', tenantId: 'qbs', uid: 'b1' }
    renderValue({ scope, tenantId: 'qbs' })
    for (const name of SCOPED_HOOKS) expect(state.scopes[name], name).toBe(scope)
  })

  it('exposes the role, the tenant, the uid and the scope', () => {
    const scope = { role: 'builder', tenantId: 'vision', uid: 'b2' }
    const value = renderValue({ scope, tenantId: 'vision' })
    expect(value.role).toBe('builder')
    expect(value.tenantId).toBe('vision')
    expect(value.uid).toBe('b2')
    expect(value.scope).toBe(scope)
  })

  it('exposes no role, tenant or uid without a scope', () => {
    const value = renderValue()
    expect(value.role).toBeNull()
    expect(value.tenantId).toBeNull()
    expect(value.uid).toBeNull()
  })

  // The queries and the rules decide what a client receives, so the provider passes
  // it on as it came, a job no list names and a submission with no job included.
  it('passes a client\'s documents through as the queries returned them', () => {
    state.rows = {
      jobs: [{ id: 'QBS-001', tenantId: 'qbs' }, { id: 'VIS-002', tenantId: 'vision' }],
      extras: [{ job: 'QBS-001' }, { job: 'QBS-404' }],
      notifs: [{ jobId: 'QBS-001' }, { msg: 'No job' }],
      submits: [{ jobId: 'QBS-001' }, { subject: 'No job' }],
    }
    const value = renderValue({ scope: { role: 'client', tenantId: null, uid: 'c1' } })
    expect(value.jobs).toEqual(state.rows.jobs)
    expect(value.extras).toEqual(state.rows.extras)
    expect(value.notifs).toEqual(state.rows.notifs)
    expect(value.submits).toEqual(state.rows.submits)
    expect(value.role).toBe('client')
    expect(value.tenantId).toBeNull()
  })

  it('passes a builder\'s documents through as the queries returned them', () => {
    state.rows = {
      jobs: [{ id: 'QBS-001', tenantId: 'qbs' }, { id: 'QBS-002' }],
      extras: [{ job: 'QBS-001' }, { job: 'QBS-404' }],
      submits: [{ jobId: 'QBS-001' }, { subject: 'No job' }],
    }
    const value = renderValue({ scope: { role: 'builder', tenantId: 'vision', uid: 'b2' }, tenantId: 'vision' })
    expect(value.jobs).toEqual(state.rows.jobs)
    expect(value.extras).toEqual(state.rows.extras)
    expect(value.submits).toEqual(state.rows.submits)
  })

  // Staff read every document; the workspace they choose in the sidebar narrows what
  // the dashboard shows, a view preference rather than access.
  it.each(['owner', 'internal'])('still narrows %s staff to the workspace they chose', (role) => {
    state.rows = {
      jobs: [{ id: 'QBS-001', tenantId: 'qbs' }, { id: 'QBS-002' }, { id: 'VIS-001', tenantId: 'vision' }],
      extras: [{ job: 'QBS-001' }, { job: 'VIS-001' }],
      notifs: [{ jobId: 'VIS-001' }],
      submits: [{ jobId: 'QBS-002' }, { jobId: 'VIS-001' }, { subject: 'No job' }],
      dailyReports: [{ jobId: 'QBS-001' }, { job: 'VIS-001' }],
      urgentItems: [{ jobId: 'VIS-001' }, { job: 'QBS-001' }, { title: 'No job' }],
    }
    const value = renderValue({ scope: { role, tenantId: 'qbs', uid: 's1' }, tenantId: 'qbs' })
    // A job with no tenant is one of the legacy QBS jobs.
    expect(value.jobs.map(j => j.id)).toEqual(['QBS-001', 'QBS-002'])
    expect(value.extras).toEqual([{ job: 'QBS-001' }])
    expect(value.submits).toEqual([{ jobId: 'QBS-002' }])
    expect(value.dailyReports).toEqual([{ jobId: 'QBS-001' }])
    expect(value.urgentItems).toEqual([{ job: 'QBS-001' }])
    expect(value.notifs).toEqual([{ jobId: 'VIS-001' }])
  })

  it('shows staff in the p2-core workspace everything', () => {
    state.rows = {
      jobs: [{ id: 'QBS-001', tenantId: 'qbs' }, { id: 'VIS-001', tenantId: 'vision' }],
      submits: [{ jobId: 'VIS-001' }, { subject: 'No job' }],
    }
    const value = renderValue({ scope: { role: 'internal', tenantId: 'p2-core', uid: 's1' }, tenantId: 'p2-core' })
    expect(value.jobs).toEqual(state.rows.jobs)
    expect(value.submits).toEqual(state.rows.submits)
  })
})
