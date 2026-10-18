import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const state = vi.hoisted(() => ({ loading: false, errors: {} }))

vi.mock('../hooks/useFirestore', () => ({
  useJobs: () => ({ jobs: [], loading: state.loading, error: state.errors.jobs ?? null }),
  useAllExtras: () => ({ extras: [], loading: state.loading, error: state.errors.extras ?? null }),
  useNotifications: () => ({ notifs: [], loading: state.loading, error: state.errors.notifs ?? null }),
  useSubs: () => ({ subs: [], loading: state.loading, error: state.errors.subs ?? null }),
  useMaterials: () => ({ materials: [], loading: state.loading, error: state.errors.materials ?? null }),
  useSubmits: () => ({ submits: [], loading: state.loading, error: state.errors.submits ?? null }),
  useDailyReports: () => ({ dailyReports: [], loading: state.loading, error: state.errors.dailyReports ?? null }),
  useUrgentItems: () => ({ urgentItems: [], loading: state.loading, error: state.errors.urgentItems ?? null }),
  useSettings: () => ({ settings: null, loading: state.loading, error: state.errors.settings ?? null }),
  useAgentAlerts: () => ({ alerts: [], loading: state.loading, error: state.errors.alerts ?? null }),
}))

import { DataProvider } from '../DataContext'
import { useData } from '../use-data'

function renderValue() {
  let value
  function Probe() {
    value = useData()
    return null
  }
  render(
    <DataProvider>
      <Probe />
    </DataProvider>,
  )
  return value
}

beforeEach(() => {
  state.loading = false
  state.errors = {}
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
