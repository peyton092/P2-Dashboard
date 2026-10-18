import {
  AlertCircleIcon, AlertTriangleIcon, InfoIcon, CheckCircleIcon,
  DollarSignIcon, FilePenLineIcon, BadgeCheckIcon,
} from 'lucide-react'
import { NOTIF_TYPE, statusLabel, statusTone, statusColor } from './status'

// Notification vocabulary, category derivation, and time helpers. Pure data
// + pure functions. Moved out of src/App.jsx in Phase 18.

const NOTIF_TYPE_ICON = {
  error:   AlertCircleIcon,
  warn:    AlertTriangleIcon,
  info:    InfoIcon,
  success: CheckCircleIcon,
}

// Per notification type: the words, tone and color from status.js (NOTIF_TYPE),
// and the icon, which only this screen needs.
export const NOTIF_TYPE_META = Object.fromEntries(Object.keys(NOTIF_TYPE).map((type) => [type, {
  tone:  statusTone(NOTIF_TYPE, type),
  label: statusLabel(NOTIF_TYPE, type),
  Icon:  NOTIF_TYPE_ICON[type],
  color: statusColor(NOTIF_TYPE, type),
}]))

export const NOTIF_FILTERS = [
  { id: 'all',           label: 'All' },
  { id: 'unread',        label: 'Unread' },
  { id: 'action-needed', label: 'Action needed' },
  { id: 'billing',       label: 'Billing' },
  { id: 'change-orders', label: 'Change orders' },
  { id: 'inspections',   label: 'Inspections' },
  { id: 'system',        label: 'System' },
  { id: 'read',          label: 'Read' },
]

export const NOTIF_CATEGORY_LABEL = {
  billing:         'Billing update',
  'change-orders': 'Change order update',
  inspections:     'Inspection update',
  system:          'System update',
}

export const NOTIF_CATEGORY_ICON = {
  billing:         DollarSignIcon,
  'change-orders': FilePenLineIcon,
  inspections:     BadgeCheckIcon,
  system:          InfoIcon,
}

// Derive an operational bucket from the notification message + type. There is
// no `category` field on the document — this is pure derivation, no schema
// change. Order matters: billing is checked before change-orders so that a
// "CO invoiced" message reads as billing, while a "CO approved" message reads
// as a change-order update.
export function notifCategory(n) {
  const m = (n.msg || '').toLowerCase()
  if (/(invoice|bill\b|collection|outstanding|paid|payment)/.test(m)) return 'billing'
  if (/(change order|\bco-|extras|approved|rejected|revision)/.test(m))  return 'change-orders'
  if (/(inspection|passed|failed|rough[- ]?in|trim|final)/.test(m))      return 'inspections'
  return 'system'
}

export function notifMatchesFilter(n, filter) {
  if (filter === 'all')           return true
  if (filter === 'unread')        return !n.read
  if (filter === 'read')          return !!n.read
  if (filter === 'action-needed') return !n.read && (n.type === 'error' || n.type === 'warn')
  if (filter === 'billing')       return notifCategory(n) === 'billing'
  if (filter === 'change-orders') return notifCategory(n) === 'change-orders'
  if (filter === 'inspections')   return notifCategory(n) === 'inspections'
  if (filter === 'system')        return notifCategory(n) === 'system'
  return true
}

// Firestore Timestamp ({ seconds }), ISO string, or undefined — normalised.
export function notifTimestampMs(n) {
  const v = n.createdAt
  if (!v) return null
  if (v.seconds) return v.seconds * 1000
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return isNaN(ms) ? null : ms
  }
  return null
}

export function fmtNotifTime(n) {
  const ms = notifTimestampMs(n)
  if (ms === null) return n.time || ''
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function notifAgeLabel(n) {
  const ms = notifTimestampMs(n)
  if (ms === null) return ''
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d === 1)  return '1d ago'
  return `${d}d ago`
}

export function notifIsWithinHours(n, hours) {
  const ms = notifTimestampMs(n)
  if (ms === null) return false
  return (Date.now() - ms) / 3600000 <= hours
}
