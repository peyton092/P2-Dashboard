import { useState, useEffect } from 'react'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, setDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp, where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase'
import { functions } from '../firebase'

// Build a scoped Firestore query for an operational collection.
//
// `scope` shape (from DataContext, derived from the signed-in user's role):
//   null                    → no scope (internal staff)
//   { tenantId: 'qbs' }     → builder portal — restrict to their tenant
//   { clientUid: '<uid>' }  → client portal — restrict to docs that array-
//                             contain the user's uid in clientUids
//
// Falls back to the unscoped collection ref when scope is null. The
// caller is responsible for orderBy / limit; we avoid combining where +
// orderBy here so the queries don't require composite Firestore indexes —
// portal payloads are small (<200 docs) and we sort client-side.
function scopedCollection(name, scope) {
  const col = collection(db, name)
  if (!scope) return col
  if (scope.tenantId) return query(col, where('tenantId', '==', scope.tenantId))
  if (scope.clientUid) return query(col, where('clientUids', 'array-contains', scope.clientUid))
  return col
}

export function useJobs(scope = null) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const tenantId = scope?.tenantId || null
  const clientUid = scope?.clientUid || null

  useEffect(() => {
    const q = scope
      ? scopedCollection('jobs', scope)
      : query(collection(db, 'jobs'), orderBy('id'), limit(200))
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      if (scope) docs.sort((a, b) => (a.id || '').localeCompare(b.id || ''))
      setJobs(docs)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, clientUid])

  return { jobs, loading }
}

export function useExtras(jobId) {
  const [extras, setExtras] = useState([])

  useEffect(() => {
    if (!jobId) return
    const q = query(collection(db, 'jobs', jobId, 'extras'), orderBy('date'))
    return onSnapshot(q, snap => {
      setExtras(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
    }, () => {})
  }, [jobId])

  return extras
}

export function useAllExtras(scope = null) {
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const tenantId = scope?.tenantId || null
  const clientUid = scope?.clientUid || null

  useEffect(() => {
    const q = scope
      ? scopedCollection('extras', scope)
      : query(collection(db, 'extras'), orderBy('date'), limit(500))
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      if (scope) docs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      setExtras(docs)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, clientUid])

  return { extras, loading }
}

export function useNotifications(scope = null) {
  const [notifs, setNotifs] = useState([])
  const [loading, setLoading] = useState(true)
  const tenantId = scope?.tenantId || null
  const clientUid = scope?.clientUid || null

  useEffect(() => {
    const q = scope
      ? scopedCollection('notifications', scope)
      : query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      if (scope) docs.sort((a, b) => {
        const ats = a.createdAt?.toMillis?.() ?? 0
        const bts = b.createdAt?.toMillis?.() ?? 0
        return bts - ats
      })
      setNotifs(docs)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, clientUid])

  return { notifs, loading }
}

export function useInspections(jobId) {
  const [inspections, setInspections] = useState([])

  useEffect(() => {
    if (!jobId) return
    const q = query(collection(db, 'jobs', jobId, 'inspections'), orderBy('date'))
    return onSnapshot(q, snap => {
      setInspections(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
    }, () => {})
  }, [jobId])

  return inspections
}

export function useSubs() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'subs'), limit(100))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }))
      rows.sort((a, b) => a.trade.localeCompare(b.trade) || a.name.localeCompare(b.name))
      setSubs(rows)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])

  return { subs, loading }
}

export function useMaterials() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'materials'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      rows.sort((a, b) => (a.job || '').localeCompare(b.job || ''))
      setMaterials(rows)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])

  return { materials, loading }
}

export function usePermits() {
  const [permits, setPermits] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'permits'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setPermits(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])

  return { permits, loading }
}

export function useSubmits(scope = null) {
  const [submits, setSubmits] = useState([])
  const [loading, setLoading] = useState(true)
  const tenantId = scope?.tenantId || null
  const clientUid = scope?.clientUid || null

  useEffect(() => {
    const q = scope
      ? scopedCollection('submits', scope)
      : query(collection(db, 'submits'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      if (scope) docs.sort((a, b) => {
        const ats = a.createdAt?.toMillis?.() ?? 0
        const bts = b.createdAt?.toMillis?.() ?? 0
        return bts - ats
      })
      setSubmits(docs)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, clientUid])

  return { submits, loading }
}

export function useJobFiles(jobDocId) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!jobDocId) return
    const q = query(collection(db, 'jobs', jobDocId, 'files'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setFiles(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [jobDocId])

  // No doc id → nothing to load; derive rather than reset state in the effect.
  return jobDocId ? { files, loading } : { files: [], loading: false }
}

export function useSubmitReplies(submitDocId) {
  const [replies, setReplies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!submitDocId) return
    const q = query(collection(db, 'submits', submitDocId, 'replies'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setReplies(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [submitDocId])

  // No doc id → nothing to load; derive rather than reset state in the effect.
  return submitDocId ? { replies, loading } : { replies: [], loading: false }
}

// ── Per-job task list (punch-list style) ──────────────────────────────────────
// All tasks for one jobId, sorted: pending first (by createdAt asc), then
// completed (by doneAt desc). No setState in effect body — the empty case
// is derived from jobId on the return.
export function useJobTasks(jobId) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!jobId) return
    // Filter at the query layer so we only download this job's tasks rather
    // than the entire collection. Requires the auto-created composite index
    // (jobId asc, createdAt asc) — Firestore prompts for it on first run.
    const q = query(
      collection(db, 'job_tasks'),
      where('jobId', '==', jobId),
      orderBy('createdAt', 'asc'),
    )
    const unsub = onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [jobId])

  return jobId ? { tasks, loading } : { tasks: [], loading: false }
}

export async function addJobTask(jobId, text) {
  return addDoc(collection(db, 'job_tasks'), {
    jobId,
    text: String(text || '').trim(),
    done: false,
    doneAt: null,
    createdAt: serverTimestamp(),
  })
}

export async function toggleJobTask(docId, done) {
  return updateDoc(doc(db, 'job_tasks', docId), {
    done,
    doneAt: done ? serverTimestamp() : null,
  })
}

export async function deleteJobTask(docId) {
  return deleteDoc(doc(db, 'job_tasks', docId))
}

// ── Basic Mutations ───────────────────────────────────────────────────────────

export async function updateJob(docId, data) {
  await updateDoc(doc(db, 'jobs', docId), data)
}

export async function addExtra(jobId, data) {
  await addDoc(collection(db, 'extras'), {
    ...data,
    job: jobId,
    createdAt: serverTimestamp(),
  })
}

export async function updateExtra(docId, data) {
  await updateDoc(doc(db, 'extras', docId), data)
}

export async function addNotification(data) {
  await addDoc(collection(db, 'notifications'), {
    ...data,
    read: false,
    createdAt: serverTimestamp(),
  })
}

export async function updateNotification(docId, data) {
  await updateDoc(doc(db, 'notifications', docId), data)
}

export async function updateInspection(jobDocId, inspDocId, data) {
  await updateDoc(doc(db, 'jobs', jobDocId, 'inspections', inspDocId), data)
}

export async function updateSub(subId, data) {
  await updateDoc(doc(db, 'subs', subId), data)
}

export async function addMaterial(data) {
  await addDoc(collection(db, 'materials'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export async function updateMaterial(docId, data) {
  await updateDoc(doc(db, 'materials', docId), data)
}

export async function addPermit(data) {
  await addDoc(collection(db, 'permits'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export async function updatePermit(jobDocId, trade, status) {
  await updateDoc(doc(db, 'jobs', jobDocId), { [`permits.${trade}`]: status })
}

export async function addSubmit(data) {
  await addDoc(collection(db, 'submits'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export async function updateSubmit(docId, data) {
  await updateDoc(doc(db, 'submits', docId), data)
}

export async function addJobFile(jobDocId, data) {
  await addDoc(collection(db, 'jobs', jobDocId, 'files'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export async function addSubmitReply(submitDocId, data) {
  await addDoc(collection(db, 'submits', submitDocId, 'replies'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

// ── Callable Cloud Functions (with Firestore fallback) ────────────────────────

export async function sendExtraToQBS(docId) {
  try {
    await httpsCallable(functions, 'sendExtraToBuilder')({ extraId: docId })
  } catch {
    await updateDoc(doc(db, 'extras', docId), { qbs: true, qbsSentAt: serverTimestamp() })
  }
}

export async function approveExtra(docId, approvedBy = 'QBS') {
  try {
    await httpsCallable(functions, 'approveExtra')({ extraId: docId, approvedBy })
  } catch {
    await updateDoc(doc(db, 'extras', docId), {
      status: 'approved',
      approvedBy,
      approvedAt: serverTimestamp(),
    })
  }
}

export async function rejectExtra(docId) {
  try {
    await httpsCallable(functions, 'rejectExtra')({ extraId: docId })
  } catch {
    await updateDoc(doc(db, 'extras', docId), {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
    })
  }
}

export async function passInspection(jobDocId, trade, phase) {
  try {
    await httpsCallable(functions, 'passInspection')({ jobId: jobDocId, trade, phase })
  } catch {
    await updateDoc(doc(db, 'jobs', jobDocId), { [`insp.${trade}.${phase}`]: 'passed' })
  }
}

export async function failInspection(jobDocId, trade, phase) {
  try {
    await httpsCallable(functions, 'failInspection')({ jobId: jobDocId, trade, phase })
  } catch {
    await updateDoc(doc(db, 'jobs', jobDocId), { [`insp.${trade}.${phase}`]: 'failed' })
  }
}

export async function createJob(data) {
  try {
    await httpsCallable(functions, 'createJob')(data)
  } catch {
    await addDoc(collection(db, 'jobs'), {
      ...data,
      createdAt: serverTimestamp(),
    })
  }
}

export function useDailyReports() {
  const [dailyReports, setDailyReports] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'daily_reports'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setDailyReports(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])
  return { dailyReports, loading }
}

export function useUrgentItems() {
  const [urgentItems, setUrgentItems] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'urgent_items'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setUrgentItems(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])
  return { urgentItems, loading }
}

export async function addUrgentItem(data) {
  await addDoc(collection(db, 'urgent_items'), {
    ...data,
    resolved: false,
    createdAt: serverTimestamp(),
  })
}

export async function resolveUrgentItem(docId, resolved) {
  await updateDoc(doc(db, 'urgent_items', docId), { resolved })
}

export async function addDailyReport(data) {
  await addDoc(collection(db, 'daily_reports'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export function useHistory(scope = null) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const tenantId = scope?.tenantId || null
  const clientUid = scope?.clientUid || null
  useEffect(() => {
    const q = scope
      ? scopedCollection('history', scope)
      : query(collection(db, 'history'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      if (scope) docs.sort((a, b) => {
        const ats = a.createdAt?.toMillis?.() ?? 0
        const bts = b.createdAt?.toMillis?.() ?? 0
        return bts - ats
      })
      setHistory(docs)
      setLoading(false)
    }, () => setLoading(false))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, clientUid])
  return { history, loading }
}

export async function addHistory(data) {
  await addDoc(collection(db, 'history'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export function useSettings() {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const ref = doc(db, 'config', 'settings')
    const unsub = onSnapshot(ref, snap => {
      setSettings(snap.exists() ? snap.data() : {})
      setLoading(false)
    }, () => { setSettings({}); setLoading(false) })
    return unsub
  }, [])
  return { settings, loading }
}

export async function updateSetting(key, value) {
  await setDoc(doc(db, 'config', 'settings'), { [key]: value }, { merge: true })
}

export function useAgentAlerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'agent_alerts'), orderBy('createdAt', 'desc'), limit(50))
    const unsub = onSnapshot(q, snap => {
      setAlerts(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => { setAlerts([]); setLoading(false) })
    return unsub
  }, [])
  return { alerts, loading }
}

export async function addAgentAlert(data) {
  await setDoc(doc(db, 'agent_alerts', data.id), { ...data, createdAt: serverTimestamp() }, { merge: true })
}

export async function updateAgentAlert(docId, data) {
  await updateDoc(doc(db, 'agent_alerts', docId), { ...data, updatedAt: serverTimestamp() })
}

export function useSupplierInvoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'supplier_invoices'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      setInvoices(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, () => { setInvoices([]); setLoading(false) })
    return unsub
  }, [])
  return { invoices, loading }
}

export async function addSupplierInvoice(data) {
  return await addDoc(collection(db, 'supplier_invoices'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateSupplierInvoice(docId, data) {
  await updateDoc(doc(db, 'supplier_invoices', docId), { ...data, updatedAt: serverTimestamp() })
}
