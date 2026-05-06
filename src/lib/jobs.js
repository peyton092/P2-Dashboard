import { classifyRisk, hasFailedInspection, isBillingReady, daysSince } from '../agent/scoring'

// Job-level helpers. Pure data + pure derivation. No React or Firestore
// dependency. Moved out of src/App.jsx in Phase 18.

export const jobName = (j) => j.name || j.client.split(' ')[0]

export const phaseLabel = (p) => p >= 67 ? 'Final Phase' : p >= 34 ? 'Mid Phase' : 'Rough-In Phase'

export const JOB_FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'active',       label: 'Active' },
  { id: 'complete',     label: 'Complete' },
  { id: 'at-risk',      label: 'At risk' },
  { id: 'needs-action', label: 'Needs action' },
  { id: 'blocked',      label: 'Blocked' },
  { id: 'stale',        label: 'Stale' },
]

export const JOB_FORM_INITIAL = {
  id: '', address: '', city: '', client: '', type: 'Full MEP Renovation',
  pm: 'Blake Neblett', target: '', permitNumber: '',
  subElectrical: '', subPlumbing: '', subHvac: '',
}

export function isJobComplete(j) {
  return ['complete', 'completed'].includes(j.status)
}

export function jobStaleness(j) {
  return daysSince(j.lastStatusChange || j.start)
}

export function jobMatchesFilter(j, filter) {
  if (filter === 'all')      return true
  if (filter === 'active')   return !isJobComplete(j)
  if (filter === 'complete') return isJobComplete(j)
  if (filter === 'blocked')  return !isJobComplete(j) && (j.status === 'blocked' || j.status === 'hold' || hasFailedInspection(j))
  if (filter === 'needs-action') return !isJobComplete(j) && (j.status === 'needs-action' || hasFailedInspection(j))
  if (filter === 'stale') {
    if (isJobComplete(j)) return false
    const s = jobStaleness(j)
    return s !== null && s >= 7
  }
  if (filter === 'at-risk') {
    if (isJobComplete(j)) return false
    const r = classifyRisk(j)
    return r?.level === 'critical'
        || r?.level === 'warning'
        || j.status === 'at-risk'
        || j.status === 'needs-action'
        || j.status === 'blocked'
        || j.status === 'hold'
        || hasFailedInspection(j)
  }
  return true
}

// Job-level next-action microcopy. Operational language only.
export function jobNextAction(j) {
  if (isJobComplete(j))            return 'Closeout'
  if (hasFailedInspection(j))      return 'Coordinate rework — inspection failed'
  if (j.status === 'blocked')      return 'Unblock job'
  if (j.status === 'hold')         return 'Release hold'
  if (j.status === 'needs-action') return 'Resolve open item'
  const risk = classifyRisk(j)
  if (risk?.level === 'critical')  return 'Triage — high risk'
  const stale = jobStaleness(j)
  if (stale !== null && stale >= 7) return 'Field update needed'
  if (stale !== null && stale >= 3) return 'Daily status check-in'
  if (isBillingReady(j))           return 'Submit invoice — milestone earned'
  return 'Continue scheduled work'
}

// Job-level risk pill metadata
export function jobRiskMeta(j) {
  if (isJobComplete(j)) return null
  const r = classifyRisk(j)
  if (!r) return null
  if (r.level === 'critical') return { tone: 'critical', label: 'High risk' }
  if (r.level === 'warning')  return { tone: 'warning',  label: 'Medium risk' }
  if (r.level === 'info')     return { tone: 'info',     label: 'Watch' }
  return null
}

export function fmtJobDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
