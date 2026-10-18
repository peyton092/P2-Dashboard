import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const state = vi.hoisted(() => ({ loading: false }))

vi.mock('../hooks/useFirestore', () => ({
  useJobs: () => ({ jobs: [], loading: state.loading }),
  useAllExtras: () => ({ extras: [], loading: state.loading }),
  useNotifications: () => ({ notifs: [], loading: state.loading }),
  useSubs: () => ({ subs: [], loading: state.loading }),
  useMaterials: () => ({ materials: [], loading: state.loading }),
  useSubmits: () => ({ submits: [], loading: state.loading }),
  useDailyReports: () => ({ dailyReports: [], loading: state.loading }),
  useUrgentItems: () => ({ urgentItems: [], loading: state.loading }),
  useSettings: () => ({ settings: null, loading: state.loading }),
  useAgentAlerts: () => ({ alerts: [], loading: state.loading }),
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
