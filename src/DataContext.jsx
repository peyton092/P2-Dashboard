import { DataContext } from './use-data'
import { useJobs, useAllExtras, useNotifications, useSubs, useMaterials, useSubmits, useDailyReports, useUrgentItems, useSettings, useAgentAlerts } from './hooks/useFirestore'

// ── Context ───────────────────────────────────────────────────────────────────

// scope is the signed in user, { role, tenantId, uid }. Every collection hook
// queries with it and the rules check the same fields, so a builder or a client
// receives only their own documents and the provider passes them on as they
// come. tenantId is the workspace: for staff, the one chosen in the sidebar.
export function DataProvider({ children, scope, tenantId = null }) {
  const { jobs: firestoreJobs, loading: jobsLoading, error: jobsError }                 = useJobs(scope)
  const { extras: firestoreExtras, loading: extrasLoading, error: extrasError }         = useAllExtras(scope)
  const { notifs: firestoreNotifs, loading: notifsLoading, error: notifsError }         = useNotifications(scope)
  const { subs: firestoreSubs, loading: subsLoading, error: subsError }                 = useSubs(scope)
  const { materials: firestoreMaterials, loading: matsLoading, error: matsError }       = useMaterials(scope)
  const { submits: firestoreSubmits, loading: submitsLoading, error: submitsError }     = useSubmits(scope)
  const { dailyReports: firestoreDailyReports, loading: drLoading, error: drError }     = useDailyReports(scope)
  const { urgentItems: firestoreUrgentItems, loading: uiLoading, error: uiError }       = useUrgentItems(scope)
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

  const role = scope?.role ?? null
  const notifs    = firestoreNotifs
  const subs      = firestoreSubs
  const materials = firestoreMaterials

  // Staff read every document. When they switch the sidebar workspace to a
  // builder tenant, the dashboard shows that tenant's jobs and what hangs off
  // them. This is a view preference, not access: builders and clients are
  // scoped by their queries and the rules, and nothing here filters for them.
  const workspace = (role === 'owner' || role === 'internal') && tenantId && tenantId !== 'p2-core'
    ? tenantId
    : null

  const jobs = workspace
    ? firestoreJobs.filter(j => (j.tenantId || 'qbs') === workspace)
    : firestoreJobs

  const jobIdSet = workspace ? new Set(jobs.map(j => j.id)) : null

  const extras = workspace ? firestoreExtras.filter(e => jobIdSet.has(e.job)) : firestoreExtras

  // A record that names no job belongs to no builder workspace, so it is hidden there.
  const inWorkspace = (rec) => {
    const id = rec?.jobId || rec?.job
    if (!id) return false
    return jobIdSet.has(id)
  }

  const dailyReports = workspace ? firestoreDailyReports.filter(inWorkspace) : firestoreDailyReports
  const urgentItems  = workspace ? firestoreUrgentItems.filter(inWorkspace)  : firestoreUrgentItems
  const submits      = workspace ? firestoreSubmits.filter(inWorkspace)      : firestoreSubmits

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
      submits,
      dailyReports,
      urgentItems,
      settings,
      agentAlerts,
      loading,
      empty,
      error,
      role,
      tenantId,
      uid: scope?.uid ?? null,
      scope,
    }}>
      {children}
    </DataContext.Provider>
  )
}
