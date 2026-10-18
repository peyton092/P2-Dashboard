import { useState, useEffect, useMemo } from 'react'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, setDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, auth } from '../firebase'
import { functions } from '../firebase'

// Every collection hook takes the signed in user's scope first:
//   { role, tenantId, uid }
// Jobs, change orders, notifications and submissions carry a scope of their own
// (tenantId and clientUids, stamped by the Cloud Functions), and their hooks run
// the query queryFor builds, which asks for exactly what the rules let that user
// read. The other collections are staff only. A scope that may read nothing, or
// no scope at all, subscribes to nothing: the hook reports no rows, no error and
// nothing loading, and never falls back to reading the whole collection.

const isStaffRole = (role) => role === 'owner' || role === 'internal'
const isFilled = (value) => typeof value === 'string' && value !== ''

// The order and the cap each scoped list has always had.
const SCOPED_LISTS = {
  jobs: { order: ['id'], max: 200 },
  extras: { order: ['date'], max: 500 },
  notifications: { order: ['createdAt', 'desc'], max: 100 },
  submits: { order: ['createdAt', 'desc'], max: 100 },
}

// The where clauses a scope adds: none for staff, the tenant for a builder, the
// uid for a client, and null when the scope may read nothing (a builder with no
// tenant, a client with no uid, any other role, no scope).
function scopeFilter(scope) {
  const role = scope?.role
  if (isStaffRole(role)) return []
  if (role === 'builder' && isFilled(scope.tenantId)) return [where('tenantId', '==', scope.tenantId)]
  if (role === 'client' && isFilled(scope.uid)) return [where('clientUids', 'array-contains', scope.uid)]
  return null
}

// The list query this user may run on jobs, extras, notifications or submits, or
// null when they may run none. Staff read the whole collection, a builder the
// documents stamped with their tenant, and a client the documents whose
// clientUids list them: the same test the rules apply, so Firestore lets the
// query through instead of refusing it for what it might return.
export function queryFor(collectionName, scope) {
  const list = SCOPED_LISTS[collectionName]
  if (!list) throw new Error(`${collectionName} is not one of the scoped collections.`)
  const filter = scopeFilter(scope)
  if (filter === null) return null
  return query(collection(db, collectionName), ...filter, orderBy(...list.order), limit(list.max))
}

// Rows are stored with the query they came from and returned only while that
// query is current, so a changed scope never shows the rows of the one before.
// Without a query nothing is subscribed, and there are no rows, no error and
// nothing loading.
const NO_ROWS = { query: null, rows: [], error: null }

function useRows(q, toRows) {
  const [state, setState] = useState(NO_ROWS)

  useEffect(() => {
    if (!q) return
    return onSnapshot(
      q,
      snap => setState({ query: q, rows: toRows(snap), error: null }),
      err => setState(prev => ({ query: q, rows: prev.query === q ? prev.rows : [], error: err })),
    )
  }, [q, toRows])

  const current = q !== null && state.query === q
  return {
    rows: current ? state.rows : [],
    loading: q !== null && !current,
    error: current ? state.error : null,
  }
}

const docRows = (snap) => snap.docs.map(d => ({ ...d.data(), _docId: d.id }))

// One of the four scoped lists. Only the parts of the scope its query depends on
// are kept: a staff query is the whole collection, so the workspace staff choose
// in the sidebar is left out and switching it keeps the listener as it is.
function useScopedList(collectionName, scope) {
  const role = scope?.role ?? null
  const tenantId = role === 'builder' ? (scope.tenantId ?? null) : null
  const uid = role === 'client' ? (scope.uid ?? null) : null
  const q = useMemo(
    () => queryFor(collectionName, { role, tenantId, uid }),
    [collectionName, role, tenantId, uid],
  )
  return useRows(q, docRows)
}

// A staff only list: the query makeQuery builds for owner and internal staff, and
// nothing at all for anyone else.
function useStaffList(scope, makeQuery, toRows) {
  const staff = isStaffRole(scope?.role)
  const q = useMemo(() => (staff ? makeQuery() : null), [staff, makeQuery])
  return useRows(q, toRows)
}

export function useJobs(scope) {
  const { rows, loading, error } = useScopedList('jobs', scope)
  return { jobs: rows, loading, error }
}

export function useAllExtras(scope) {
  const { rows, loading, error } = useScopedList('extras', scope)
  return { extras: rows, loading, error }
}

export function useNotifications(scope) {
  const { rows, loading, error } = useScopedList('notifications', scope)
  return { notifs: rows, loading, error }
}

export function useSubmits(scope) {
  const { rows, loading, error } = useScopedList('submits', scope)
  return { submits: rows, loading, error }
}

const subsQuery = () => query(collection(db, 'subs'), limit(100))
const subsRows = (snap) => {
  const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }))
  rows.sort((a, b) => a.trade.localeCompare(b.trade) || a.name.localeCompare(b.name))
  return rows
}

export function useSubs(scope) {
  const { rows, loading, error } = useStaffList(scope, subsQuery, subsRows)
  return { subs: rows, loading, error }
}

const materialsQuery = () => query(collection(db, 'materials'), orderBy('createdAt', 'desc'), limit(200))
const materialsRows = (snap) => {
  const rows = docRows(snap)
  rows.sort((a, b) => (a.job || '').localeCompare(b.job || ''))
  return rows
}

export function useMaterials(scope) {
  const { rows, loading, error } = useStaffList(scope, materialsQuery, materialsRows)
  return { materials: rows, loading, error }
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

export async function updateNotification(docId, data) {
  await updateDoc(doc(db, 'notifications', docId), data)
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

// ── Callable Cloud Functions ──────────────────────────────────────────────────
// Sending, approving and rejecting change orders, recording inspection results
// and creating jobs are done by Cloud Functions. They check the caller's role
// and write the notification and the history entry together with the change, so
// the browser writes none of it. There is no fallback to doing the write from
// here: a failed call throws, and the caller shows the message (see
// callableMessage in lib/callableError.js).

async function callCloud(name, payload) {
  const { data } = await httpsCallable(functions, name)(payload)
  return data
}

export async function sendExtraToBuilder(docId) {
  return callCloud('sendExtraToBuilder', { extraId: docId })
}

export async function approveExtra(docId, note) {
  return callCloud('approveExtra', { extraId: docId, ...(note === undefined ? {} : { note }) })
}

export async function rejectExtra(docId, note) {
  return callCloud('rejectExtra', { extraId: docId, note })
}

export async function passInspection(jobDocId, trade, phase) {
  return callCloud('passInspection', { jobDocId, trade, phase })
}

export async function failInspection(jobDocId, trade, phase) {
  return callCloud('failInspection', { jobDocId, trade, phase })
}

export async function createJob(data) {
  return callCloud('createJob', data)
}

const dailyReportsQuery = () => query(collection(db, 'daily_reports'), orderBy('createdAt', 'desc'), limit(100))

export function useDailyReports(scope) {
  const { rows, loading, error } = useStaffList(scope, dailyReportsQuery, docRows)
  return { dailyReports: rows, loading, error }
}

const urgentItemsQuery = () => query(collection(db, 'urgent_items'), orderBy('createdAt', 'desc'), limit(100))

export function useUrgentItems(scope) {
  const { rows, loading, error } = useStaffList(scope, urgentItemsQuery, docRows)
  return { urgentItems: rows, loading, error }
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

const historyQuery = () => query(collection(db, 'history'), orderBy('createdAt', 'desc'), limit(200))

export function useHistory(scope) {
  const { rows, loading, error } = useStaffList(scope, historyQuery, docRows)
  return { history: rows, loading, error }
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

const supplierInvoicesQuery = () => query(collection(db, 'supplier_invoices'), orderBy('createdAt', 'desc'), limit(200))

export function useSupplierInvoices(scope) {
  const { rows, loading, error } = useStaffList(scope, supplierInvoicesQuery, docRows)
  return { invoices: rows, loading, error }
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
