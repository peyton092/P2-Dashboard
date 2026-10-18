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
// read. The other collections, the app settings among them, are staff only. A
// scope that may read nothing, or no scope at all, subscribes to nothing: the hook
// reports no rows (or no settings), no error and nothing loading, and never falls
// back to reading the whole collection.

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

// Listens to source, a query or a document, and keeps what toValue makes of each
// snapshot. The value is stored with the source it came from and returned only
// while that source is current, so a changed scope never shows what the one
// before it loaded; until a snapshot arrives the hook gives empty. Without a
// source nothing is subscribed, and there is empty, no error and nothing loading.
// empty is one of the frozen values below, the same on every render, so a screen
// effect keyed on it does not run again each time the screen renders.
const NOTHING_YET = { source: null, value: null, error: null }
const EMPTY_LIST = Object.freeze([])
const EMPTY_OBJECT = Object.freeze({})

function useListener(source, toValue, empty) {
  const [state, setState] = useState(NOTHING_YET)

  useEffect(() => {
    if (!source) return
    return onSnapshot(
      source,
      snap => setState({ source, value: toValue(snap), error: null }),
      err => setState(prev => ({ source, value: prev.source === source ? prev.value : null, error: err })),
    )
  }, [source, toValue])

  const current = source !== null && state.source === source
  return {
    value: current && state.value !== null ? state.value : empty,
    loading: source !== null && !current,
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
  return useListener(q, docRows, EMPTY_LIST)
}

// Something only staff read: what makeSource points at, for owner and internal
// staff, and nothing at all for anyone else, who get empty.
function useStaffOnly(scope, makeSource, toValue, empty) {
  const staff = isStaffRole(scope?.role)
  const source = useMemo(() => (staff ? makeSource() : null), [staff, makeSource])
  return useListener(source, toValue, empty)
}

const useStaffList = (scope, makeQuery, toRows) => useStaffOnly(scope, makeQuery, toRows, EMPTY_LIST)

export function useJobs(scope) {
  const { value, loading, error } = useScopedList('jobs', scope)
  return { jobs: value, loading, error }
}

export function useAllExtras(scope) {
  const { value, loading, error } = useScopedList('extras', scope)
  return { extras: value, loading, error }
}

export function useNotifications(scope) {
  const { value, loading, error } = useScopedList('notifications', scope)
  return { notifs: value, loading, error }
}

export function useSubmits(scope) {
  const { value, loading, error } = useScopedList('submits', scope)
  return { submits: value, loading, error }
}

const subsQuery = () => query(collection(db, 'subs'), limit(100))
const subsRows = (snap) => {
  const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }))
  rows.sort((a, b) => a.trade.localeCompare(b.trade) || a.name.localeCompare(b.name))
  return rows
}

export function useSubs(scope) {
  const { value, loading, error } = useStaffList(scope, subsQuery, subsRows)
  return { subs: value, loading, error }
}

const materialsQuery = () => query(collection(db, 'materials'), orderBy('createdAt', 'desc'), limit(200))
const materialsRows = (snap) => {
  const rows = docRows(snap)
  rows.sort((a, b) => (a.job || '').localeCompare(b.job || ''))
  return rows
}

export function useMaterials(scope) {
  const { value, loading, error } = useStaffList(scope, materialsQuery, materialsRows)
  return { materials: value, loading, error }
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
  const { value, loading, error } = useStaffList(scope, dailyReportsQuery, docRows)
  return { dailyReports: value, loading, error }
}

const urgentItemsQuery = () => query(collection(db, 'urgent_items'), orderBy('createdAt', 'desc'), limit(100))

export function useUrgentItems(scope) {
  const { value, loading, error } = useStaffList(scope, urgentItemsQuery, docRows)
  return { urgentItems: value, loading, error }
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
  const { value, loading, error } = useStaffList(scope, historyQuery, docRows)
  return { history: value, loading, error }
}

export async function addHistory(data) {
  await addDoc(collection(db, 'history'), withAuthor({
    ...data,
    createdAt: serverTimestamp(),
  }))
}

const settingsDoc = () => doc(db, 'config', 'settings')
const settingsOf = (snap) => (snap.exists() ? snap.data() : {})

export function useSettings(scope) {
  const { value, loading, error } = useStaffOnly(scope, settingsDoc, settingsOf, EMPTY_OBJECT)
  return { settings: value, loading, error }
}

export async function updateSetting(key, value) {
  await setDoc(doc(db, 'config', 'settings'), { [key]: value }, { merge: true })
}

const agentAlertsQuery = () => query(collection(db, 'agent_alerts'), orderBy('createdAt', 'desc'), limit(50))

export function useAgentAlerts(scope) {
  const { value, loading, error } = useStaffList(scope, agentAlertsQuery, docRows)
  return { alerts: value, loading, error }
}

export async function addAgentAlert(data) {
  await setDoc(doc(db, 'agent_alerts', data.id), { ...data, createdAt: serverTimestamp() }, { merge: true })
}

export async function updateAgentAlert(docId, data) {
  await updateDoc(doc(db, 'agent_alerts', docId), { ...data, updatedAt: serverTimestamp() })
}

const supplierInvoicesQuery = () => query(collection(db, 'supplier_invoices'), orderBy('createdAt', 'desc'), limit(200))

export function useSupplierInvoices(scope) {
  const { value, loading, error } = useStaffList(scope, supplierInvoicesQuery, docRows)
  return { invoices: value, loading, error }
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
