// Materials vocabulary, status normalisation, and pure derivation helpers.
// No React or Firestore dependency. Moved out of src/App.jsx in Phase 18.

export const MAT_STATUS_OPTIONS = ['Ordered', 'In Transit', 'Delivered', 'At Job Site', 'Used', 'Cancelled']

export const MAT_STATUS_COLOR = {
  'Ordered':    '#3b82f6',
  'In Transit': '#eab308',
  'Delivered':  '#22c55e',
  'At Job Site':'#22c55e',
  'Used':       '#6b7280',
  'Cancelled':  '#6b7280',
  // legacy
  'delivered':  '#22c55e',
  'in-transit': '#eab308',
  'ordered':    '#3b82f6',
  'pending':    '#6b7280',
}

export const MAT_UNITS = ['ea', 'roll', 'stick', 'box', 'bag', 'pallet', 'ft', 'lf']

export function normalizeMatStatus(s) {
  if (!s) return 'Ordered'
  const map = { 'delivered': 'Delivered', 'in-transit': 'In Transit', 'ordered': 'Ordered', 'pending': 'Ordered' }
  return map[s] || s
}

export const MAT_STATUS_TONE = {
  'Ordered':    'info',
  'In Transit': 'warning',
  'Delivered':  'success',
  'At Job Site':'success',
  'Used':       'mute',
  'Cancelled':  'mute',
}

export const MAT_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'urgent',    label: 'Urgent' },
  { id: 'blocking',  label: 'Blocking' },
  { id: 'needed',    label: 'Needed' },
  { id: 'ordered',   label: 'Ordered' },
  { id: 'delivered', label: 'Delivered' },
]

export const matName    = (m) => m.name || m.item || '—'
export const matJobId   = (m) => m.jobId || m.job || ''
export const matOrdered = (m) => m.dateOrdered || m.eta || ''

export function matDaysUntilNeeded(m) {
  if (!m.dateNeeded) return null
  const d = new Date(m.dateNeeded)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((d.getTime() - today.getTime()) / 86400000)
}

export function matIsOpen(m) {
  const s = normalizeMatStatus(m.status)
  return !['Delivered', 'At Job Site', 'Used', 'Cancelled'].includes(s)
}

export function matIsOverdue(m) {
  if (!matIsOpen(m)) return false
  const days = matDaysUntilNeeded(m)
  return days !== null && days < 0
}

export function matIsBlocking(m) {
  if (!matIsOpen(m)) return false
  const days = matDaysUntilNeeded(m)
  return days !== null && days <= 7
}

export function matIsRecent(m) {
  const ts = m.createdAt
  if (!ts) return false
  const ms = ts.seconds ? ts.seconds * 1000
           : typeof ts === 'string' ? Date.parse(ts) : null
  if (!ms || isNaN(ms)) return false
  return (Date.now() - ms) <= 86400000 // last 24 hours
}

export function matNextAction(m) {
  const s = normalizeMatStatus(m.status)
  if (s === 'Cancelled')   return 'Order cancelled'
  if (s === 'Used')        return 'Used on job'
  if (s === 'At Job Site') return 'On site — ready for install'
  if (s === 'Delivered')   return 'Ready for pickup'
  if (matIsOverdue(m))     return 'Follow up today — overdue'
  if (s === 'In Transit')  return 'Track delivery — in transit'
  const days = matDaysUntilNeeded(m)
  if (s === 'Ordered' && days !== null && days <= 7) return 'Confirm with supplier'
  if (s === 'Ordered')     return 'Waiting on supplier'
  return 'Continue tracking'
}

export function matMatchesFilter(m, filter) {
  if (filter === 'all')       return true
  if (filter === 'urgent')    return matIsOverdue(m)
  if (filter === 'blocking')  return matIsBlocking(m)
  if (filter === 'needed')    return matIsOpen(m)
  if (filter === 'ordered')   return normalizeMatStatus(m.status) === 'Ordered'
  if (filter === 'delivered') {
    const s = normalizeMatStatus(m.status)
    return s === 'Delivered' || s === 'At Job Site'
  }
  return true
}

export function fmtMatDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const MAT_FORM_INITIAL = {
  name: '', qty: 1, unit: 'ea', jobId: '',
  status: 'Ordered', vendor: '', dateOrdered: '', dateNeeded: '', notes: '',
}
