import { ZapIcon, WrenchIcon, HammerIcon } from 'lucide-react'

// Inspection vocabulary + per-trade metadata. Pure data + pure helpers, no
// React or Firestore dependency. Moved out of src/App.jsx in Phase 18.

const O = '#F47920' // Brand orange — kept local to avoid coupling to App.jsx.

export const INSP_STATUSES = ['pending', 'scheduled', 'passed', 'failed', 'blocked', 'n/a']

export const TRADE_META = {
  electrical: { label: 'Electrical (3-Phase)',          color: O,         Icon: ZapIcon,    phases: ['roughIn', 'trim', 'final'] },
  plumbing:   { label: 'Plumbing (2-Phase)',            color: '#06b6d4', Icon: WrenchIcon, phases: ['roughIn', 'final'] },
  hvac:       { label: 'HVAC (2-Phase · Blocking)',     color: '#3b82f6', Icon: HammerIcon, phases: ['roughIn', 'final'] },
}

export const PHASE_LABEL = { roughIn: 'Rough-In', trim: 'Trim', final: 'Final' }

// Inspection status → Pill tone in the Phase 1 palette.
export function inspectionStatusTone(status) {
  if (status === 'passed')                                            return 'success'
  if (status === 'failed')                                            return 'critical'
  if (status === 'scheduled')                                         return 'warning'
  if (status === 'blocked')                                           return 'info'
  if (status === 'pending' || status === 'pending-verification')      return 'mute'
  if (status === 'n/a')                                               return 'neutral'
  return 'neutral'
}

export function inspectionStatusLabel(status) {
  if (status === 'passed')                return 'Passed'
  if (status === 'failed')                return 'Failed'
  if (status === 'scheduled')             return 'Scheduled'
  if (status === 'blocked')               return 'Blocked'
  if (status === 'pending')               return 'Pending'
  if (status === 'pending-verification')  return 'Verify'
  if (status === 'n/a')                   return 'N/A'
  return (status || 'Pending').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Job status → Pill tone
export function inspJobStatusTone(status) {
  if (status === 'on-track' || status === 'complete' || status === 'completed') return 'success'
  if (status === 'needs-action' || status === 'active') return 'brand'
  if (status === 'at-risk') return 'warning'
  if (status === 'blocked' || status === 'hold') return 'critical'
  if (status === 'pending') return 'mute'
  return 'neutral'
}
