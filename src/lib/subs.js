import { daysSince } from '../agent/scoring'

// Subcontractor compliance vocabulary + pure derivation helpers. No React or
// Firestore dependency. Moved out of src/App.jsx in Phase 18.

export const SUB_STATUS_OPTIONS = ['active', 'done', 'issue']
export const SUB_STATUS_COLOR   = { active: '#22c55e', done: '#6b7280', issue: '#ef4444' }

export const SUB_FILTERS = [
  { id: 'all',            label: 'All' },
  { id: 'approved',       label: 'Approved' },
  { id: 'pending',        label: 'Pending' },
  { id: 'blocked',        label: 'Blocked' },
  { id: 'missing-docs',   label: 'Missing docs' },
  { id: 'expired',        label: 'Expired insurance' },
  { id: 'expiring-soon',  label: 'Expiring soon' },
]

export const TRADE_FILTERS = [
  { id: 'all',        label: 'All trades' },
  { id: 'Electrical', label: 'Electrical' },
  { id: 'Plumbing',   label: 'Plumbing' },
  { id: 'HVAC',       label: 'HVAC' },
]

// Date utility — null when missing/invalid; integer days otherwise (negative = expired).
export function daysUntilDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((d.getTime() - today.getTime()) / 86400000)
}

export function subInsuranceState(s) {
  const days = daysUntilDate(s.insExp)
  if (days === null) return 'unknown'
  if (days < 0)      return 'expired'
  if (days < 30)     return 'expiring-30'
  if (days < 60)     return 'expiring-60'
  return 'valid'
}

export function subLicenseState(s) {
  const days = daysUntilDate(s.licExp)
  if (days === null) return 'unknown'
  if (days < 0)      return 'expired'
  if (days < 60)     return 'expiring-60'
  return 'valid'
}

export function subHasMissingDocs(s) {
  return !s.w9
}
export function subInsuranceExpired(s) {
  return subInsuranceState(s) === 'expired'
}
export function subInsuranceExpiringSoon(s) {
  const st = subInsuranceState(s)
  return st === 'expiring-30' || st === 'expiring-60'
}
export function subLicenseExpired(s) {
  return subLicenseState(s) === 'expired'
}

// Compliance verdict for the sub. Order matters: blocked > pending > approved.
export function subComplianceVerdict(s) {
  if (subHasMissingDocs(s) || subInsuranceExpired(s) || subLicenseExpired(s)) {
    return { tone: 'critical', label: 'Do not assign' }
  }
  if (subInsuranceExpiringSoon(s) || subLicenseState(s) === 'expiring-60') {
    return { tone: 'warning', label: 'Compliance review needed' }
  }
  if ((s.score ?? 100) < 80) {
    return { tone: 'warning', label: 'Compliance review needed' }
  }
  return { tone: 'success', label: 'Approved for work' }
}

export function subMatchesFilter(s, filter) {
  if (filter === 'all')           return true
  const v = subComplianceVerdict(s)
  if (filter === 'approved')      return v.label === 'Approved for work'
  if (filter === 'pending')       return v.label === 'Compliance review needed'
  if (filter === 'blocked')       return v.label === 'Do not assign'
  if (filter === 'missing-docs')  return subHasMissingDocs(s)
  if (filter === 'expired')       return subInsuranceExpired(s) || subLicenseExpired(s)
  if (filter === 'expiring-soon') return subInsuranceExpiringSoon(s)
  return true
}

// Single most important next action per sub.
export function subNextAction(s) {
  if (subHasMissingDocs(s))            return 'Collect W-9 — cannot assign'
  if (subInsuranceExpired(s))          return 'Insurance expired — do not assign'
  if (subLicenseExpired(s))            return 'License expired — do not assign'
  if (subInsuranceState(s) === 'expiring-30') return 'Insurance expiring within 30 days — request renewal'
  if (subInsuranceState(s) === 'expiring-60') return 'Insurance expiring soon — flag for follow-up'
  if (subLicenseState(s) === 'expiring-60')   return 'License expiring soon — flag for follow-up'
  const days = daysSince(s.lastUpdate)
  if (days !== null && days > 5)       return 'Field update needed'
  if ((s.score ?? 100) < 80)           return 'Compliance review needed'
  return 'Ready to assign — no compliance issues'
}

export function fmtSubDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Map a sub to the trade-key form found on job documents (e.g. "P2 In-House"
// for the in-house sub vs. first-name slug for outside subs).
export function subJobKey(s) {
  return s.id === 'p2' ? 'P2 In-House' : (s.name || '').split(' ')[0]
}
