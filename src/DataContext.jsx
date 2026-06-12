import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { collection, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'
import { useJobs, useAllExtras, useNotifications, useSubs, useMaterials, useSubmits, useDailyReports, useUrgentItems, useSettings, useAgentAlerts } from './hooks/useFirestore'

// ── Seed / migrate Firestore — NEVER overwrites user-edited fields ────────────

async function seedFirestore() {
  const snap = await getDocs(collection(db, 'jobs'))

  if (!snap.empty) {
    console.log('[seed] Jobs already exist — skipping seed')
    return
  }

  console.log('[seed] Empty collection — running first-time seed')
  // Dynamic-import keeps ~900 lines of static fixture data out of the eager
  // DataContext chunk. It only loads the first time the database is empty.
  const {
    STATIC_JOBS, STATIC_EXTRAS, STATIC_NOTIFS, STATIC_SUBS, STATIC_MATERIALS,
    agentFields,
  } = await import('./lib/seedData')

  const batch = writeBatch(db)

  STATIC_JOBS.forEach(job => {
    const ref = doc(collection(db, 'jobs'))
    batch.set(ref, { ...job, ...agentFields(job), _seeded: true, createdAt: serverTimestamp() })
  })

  STATIC_EXTRAS.forEach(extra => {
    const ref = doc(collection(db, 'extras'))
    batch.set(ref, { ...extra, createdAt: serverTimestamp() })
  })
  STATIC_NOTIFS.forEach(n => {
    const ref = doc(collection(db, 'notifications'))
    batch.set(ref, { type: n.type, msg: n.msg, read: n.read, createdAt: serverTimestamp() })
  })
  STATIC_SUBS.forEach(sub => {
    batch.set(doc(db, 'subs', sub.id), sub)
  })
  STATIC_MATERIALS.forEach(m => {
    batch.set(doc(db, 'materials', m.id), { ...m, createdAt: serverTimestamp() })
  })

  await batch.commit()
}

// ── Context ───────────────────────────────────────────────────────────────────

const DataContext = createContext(null)

export function DataProvider({ children, tenantId = null, role = null, clientJobIds = null }) {
  // Per-role Firestore-side scoping (audit C-1, phase 2). Builders see only
  // their tenant's docs; clients see only docs that array-contain their uid in
  // clientUids (populated by the backfillScoping Cloud Function). Internal
  // staff stays unscoped — rules + JS still cover them.
  const scope = useMemo(() => {
    if (role === 'builder' && tenantId) return { tenantId }
    if (role === 'client'  && auth.currentUser?.uid) return { clientUid: auth.currentUser.uid }
    return null
  }, [role, tenantId])

  const { jobs: firestoreJobs, loading: jobsLoading }               = useJobs(scope)
  const { extras: firestoreExtras, loading: extrasLoading }         = useAllExtras(scope)
  const { notifs: firestoreNotifs, loading: notifsLoading }         = useNotifications(scope)
  const { subs: firestoreSubs, loading: subsLoading }               = useSubs()
  const { materials: firestoreMaterials, loading: matsLoading }     = useMaterials()
  const { submits: firestoreSubmits, loading: submitsLoading }       = useSubmits(scope)
  const { dailyReports: firestoreDailyReports, loading: drLoading } = useDailyReports()
  const { urgentItems: firestoreUrgentItems, loading: uiLoading }   = useUrgentItems()
  const { settings }                                                 = useSettings()
  const { alerts: agentAlerts }                                      = useAgentAlerts()
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    seedFirestore()
      .then(() => setSeeded(true))
      .catch(() => setSeeded(true))
  }, [])

  const loading = jobsLoading || extrasLoading || notifsLoading || subsLoading || matsLoading || submitsLoading || drLoading || uiLoading

  // Firestore is the source of truth. The previous STATIC_* fallback was a
  // holdover from pre-backend days; seedFirestore populates these collections
  // on first run, and `loading` above covers the initial-fetch window.
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

  // Memoize the context value so consumers re-render only when an underlying
  // slice actually changes identity. Firestore snapshots already produce new
  // arrays per update, so this is correct; the goal is to avoid forcing every
  // consumer to re-render on unrelated parent re-renders.
  const value = useMemo(() => ({
    jobs, extras, notifs,
    subs,
    materials,
    submits: submitsScoped,
    dailyReports,
    urgentItems,
    settings,
    agentAlerts,
    loading,
    seeded,
  }), [
    jobs, extras, notifs, subs, materials, submitsScoped,
    dailyReports, urgentItems, settings, agentAlerts, loading, seeded,
  ])

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  return useContext(DataContext)
}
