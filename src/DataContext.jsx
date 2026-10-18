import { DataContext } from './use-data'
import { useJobs, useAllExtras, useNotifications, useSubs, useMaterials, useSubmits, useDailyReports, useUrgentItems, useSettings, useAgentAlerts } from './hooks/useFirestore'

// ── Context ───────────────────────────────────────────────────────────────────

export function DataProvider({ children, tenantId = null, role = null, clientJobIds = null }) {
  const { jobs: firestoreJobs, loading: jobsLoading, error: jobsError }                 = useJobs()
  const { extras: firestoreExtras, loading: extrasLoading, error: extrasError }         = useAllExtras()
  const { notifs: firestoreNotifs, loading: notifsLoading, error: notifsError }         = useNotifications()
  const { subs: firestoreSubs, loading: subsLoading, error: subsError }                 = useSubs()
  const { materials: firestoreMaterials, loading: matsLoading, error: matsError }       = useMaterials()
  const { submits: firestoreSubmits, loading: submitsLoading, error: submitsError }     = useSubmits()
  const { dailyReports: firestoreDailyReports, loading: drLoading, error: drError }     = useDailyReports()
  const { urgentItems: firestoreUrgentItems, loading: uiLoading, error: uiError }       = useUrgentItems()
  const { settings, error: settingsError }                                              = useSettings()
  const { alerts: agentAlerts, error: alertsError }                                     = useAgentAlerts()

  const loading = jobsLoading || extrasLoading || notifsLoading || subsLoading || matsLoading || submitsLoading || drLoading || uiLoading

  // The first subscription that failed, in the order above, or null. A failed
  // listener is not restarted, so its collection stays empty until this provider
  // mounts again; a screen can use this to say so rather than show nothing.
  const error = [
    jobsError, extrasError, notifsError, subsError, matsError,
    submitsError, drError, uiError, settingsError, alertsError,
  ].find(e => e != null) ?? null

  const allJobs   = firestoreJobs
  const allExtras = firestoreExtras
  const notifs    = firestoreNotifs
  const subs      = firestoreSubs
  const materials = firestoreMaterials
  const submits   = firestoreSubmits

  // Client portal: scope strictly to the explicit set of job IDs the client owns.
  const isClient = role === 'client'
  const clientJobIdSet = isClient ? new Set(Array.isArray(clientJobIds) ? clientJobIds : []) : null

  const shouldFilter = !isClient && tenantId && (role === 'builder' || (role === 'internal' && tenantId !== 'p2-core'))

  const jobs = isClient
    ? allJobs.filter(j => clientJobIdSet.has(j.id))
    : shouldFilter
      ? allJobs.filter(j => (j.tenantId || 'qbs') === tenantId)
      : allJobs

  // Once jobs are scoped (builder tenancy OR client ownership), everything else
  // hangs off the visible job-id set.
  const scoped = isClient || shouldFilter
  const jobIdSet = scoped ? new Set(jobs.map(j => j.id)) : null

  const extras = scoped ? allExtras.filter(e => jobIdSet.has(e.job)) : allExtras

  const matchesScopedJob = (rec) => {
    if (!jobIdSet) return true
    const id = rec?.jobId || rec?.job
    // Records with no job association are internal-only — hide them in any scoped portal.
    if (!id) return false
    return jobIdSet.has(id)
  }

  const dailyReports = scoped ? firestoreDailyReports.filter(matchesScopedJob) : firestoreDailyReports
  const urgentItems  = scoped ? firestoreUrgentItems.filter(matchesScopedJob)  : firestoreUrgentItems
  const submitsScoped = scoped ? submits.filter(matchesScopedJob) : submits

  // True only once every collection has finished loading and none holds a document.
  const empty = !loading
    && firestoreJobs.length === 0
    && firestoreExtras.length === 0
    && firestoreNotifs.length === 0
    && firestoreSubs.length === 0
    && firestoreMaterials.length === 0
    && firestoreSubmits.length === 0
    && firestoreDailyReports.length === 0
    && firestoreUrgentItems.length === 0

  return (
    <DataContext.Provider value={{
      jobs, extras, notifs,
      subs,
      materials,
      submits: submitsScoped,
      dailyReports,
      urgentItems,
      settings,
      agentAlerts,
      loading,
      empty,
      error,
    }}>
      {children}
    </DataContext.Provider>
  )
}
