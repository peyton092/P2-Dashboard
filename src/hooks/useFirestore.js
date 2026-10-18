import { useState, useEffect } from 'react'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, setDoc,
  query, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, auth } from '../firebase'
import { functions } from '../firebase'

export function useJobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('id'), limit(200))
    const unsub = onSnapshot(q, snap => {
      setJobs(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { jobs, loading, error }
}

export function useAllExtras() {
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'extras'), orderBy('date'), limit(500))
    const unsub = onSnapshot(q, snap => {
      setExtras(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { extras, loading, error }
}

export function useNotifications() {
  const [notifs, setNotifs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setNotifs(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { notifs, loading, error }
}

export function useSubs() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'subs'), limit(100))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }))
      rows.sort((a, b) => a.trade.localeCompare(b.trade) || a.name.localeCompare(b.name))
      setSubs(rows)
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { subs, loading, error }
}

export function useMaterials() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'materials'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      rows.sort((a, b) => (a.job || '').localeCompare(b.job || ''))
      setMaterials(rows)
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { materials, loading, error }
}

export function usePermits() {
  const [permits, setPermits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'permits'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setPermits(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { permits, loading, error }
}

export function useSubmits() {
  const [submits, setSubmits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'submits'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setSubmits(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])

  return { submits, loading, error }
}

// Rows are stored with the id they were loaded for and only returned while that
// id is still current, so a changed id never shows the previous id's data.
const EMPTY_SNAPSHOT = { id: null, items: [], error: null }

function useSubcollection(parentCollection, parentId, subcollection, direction) {
  const [state, setState] = useState(EMPTY_SNAPSHOT)

  useEffect(() => {
    if (!parentId) return
    const q = query(
      collection(db, parentCollection, parentId, subcollection),
      orderBy('createdAt', direction),
    )
    const unsub = onSnapshot(
      q,
      snap => setState({
        id: parentId,
        items: snap.docs.map(d => ({ ...d.data(), _docId: d.id })),
        error: null,
      }),
      err => setState({ id: parentId, items: [], error: err }),
    )
    return () => {
      unsub()
      setState(EMPTY_SNAPSHOT)
    }
  }, [parentCollection, parentId, subcollection, direction])

  const current = !!parentId && state.id === parentId
  return {
    items: current ? state.items : [],
    loading: !!parentId && !current,
    error: current ? state.error : null,
  }
}

export function useJobFiles(jobDocId) {
  const { items, loading, error } = useSubcollection('jobs', jobDocId, 'files', 'desc')
  return { files: items, loading, error }
}

export function useSubmitReplies(submitDocId) {
  const { items, loading, error } = useSubcollection('submits', submitDocId, 'replies', 'asc')
  return { replies: items, loading, error }
}

// ── Basic Mutations ───────────────────────────────────────────────────────────

// Stamps a new document with the signed in author. Throws when signed out so
// no create can go through without an author.
export function withAuthor(data) {
  const user = auth.currentUser
  if (!user) throw new Error('You must be signed in.')
  return { ...data, createdBy: user.uid, createdByEmail: user.email || null }
}

export async function updateJob(docId, data) {
  await updateDoc(doc(db, 'jobs', docId), data)
}

export async function addExtra(jobId, data) {
  await addDoc(collection(db, 'extras'), withAuthor({
    ...data,
    job: jobId,
    createdAt: serverTimestamp(),
  }))
}

export async function updateExtra(docId, data) {
  await updateDoc(doc(db, 'extras', docId), data)
}

export async function addNotification(data) {
  await addDoc(collection(db, 'notifications'), withAuthor({
    ...data,
    read: false,
    createdAt: serverTimestamp(),
  }))
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
  await addDoc(collection(db, 'materials'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

export async function updateMaterial(docId, data) {
  await updateDoc(doc(db, 'materials', docId), data)
}

export async function addPermit(data) {
  await addDoc(collection(db, 'permits'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

export async function updatePermit(jobDocId, trade, status) {
  await updateDoc(doc(db, 'jobs', jobDocId), { [`permits.${trade}`]: status })
}

export async function addSubmit(data) {
  await addDoc(collection(db, 'submits'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

export async function updateSubmit(docId, data) {
  await updateDoc(doc(db, 'submits', docId), data)
}

export async function addJobFile(jobDocId, data) {
  await addDoc(collection(db, 'jobs', jobDocId, 'files'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

export async function addSubmitReply(submitDocId, data) {
  await addDoc(collection(db, 'submits', submitDocId, 'replies'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
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
  const [error, setError] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'daily_reports'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setDailyReports(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])
  return { dailyReports, loading, error }
}

export function useUrgentItems() {
  const [urgentItems, setUrgentItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'urgent_items'), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setUrgentItems(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])
  return { urgentItems, loading, error }
}

export async function addUrgentItem(data) {
  await addDoc(collection(db, 'urgent_items'), withAuthor({
    ...data,
    resolved: false,
    createdAt: serverTimestamp(),
  }))
}

export async function resolveUrgentItem(docId, resolved) {
  await updateDoc(doc(db, 'urgent_items', docId), { resolved })
}

export async function addDailyReport(data) {
  await addDoc(collection(db, 'daily_reports'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

export function useHistory() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'history'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      setHistory(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setError(err); setLoading(false) })
    return unsub
  }, [])
  return { history, loading, error }
}

export async function addHistory(data) {
  await addDoc(collection(db, 'history'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

export function useSettings() {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    const ref = doc(db, 'config', 'settings')
    const unsub = onSnapshot(ref, snap => {
      setSettings(snap.exists() ? snap.data() : {})
      setLoading(false)
    }, err => { setSettings({}); setError(err); setLoading(false) })
    return unsub
  }, [])
  return { settings, loading, error }
}

export async function updateSetting(key, value) {
  await setDoc(doc(db, 'config', 'settings'), { [key]: value }, { merge: true })
}

export function useAgentAlerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'agent_alerts'), orderBy('createdAt', 'desc'), limit(50))
    const unsub = onSnapshot(q, snap => {
      setAlerts(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setAlerts([]); setError(err); setLoading(false) })
    return unsub
  }, [])
  return { alerts, loading, error }
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
  const [error, setError] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'supplier_invoices'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      setInvoices(snap.docs.map(d => ({ ...d.data(), _docId: d.id })))
      setLoading(false)
    }, err => { setInvoices([]); setError(err); setLoading(false) })
    return unsub
  }, [])
  return { invoices, loading, error }
}

export async function addSupplierInvoice(data) {
  return await addDoc(collection(db, 'supplier_invoices'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }))
}

export async function updateSupplierInvoice(docId, data) {
  await updateDoc(doc(db, 'supplier_invoices', docId), { ...data, updatedAt: serverTimestamp() })
}
