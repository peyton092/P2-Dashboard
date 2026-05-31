import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { updateJob } from '../../hooks/useFirestore'
import { phaseLabel } from '../../lib/jobs'
import { BILLING_STATUSES, BILLING_STATUS_LABEL, BILLING_STATUS_COLOR } from '../../lib/billing'
import { MAT_STATUS_OPTIONS, MAT_STATUS_COLOR } from '../../lib/materials'
import { useToast } from '../ui/toast'

// Inline-edit pill-shaped Select primitives. Each one wraps a status field
// on a job/material document and persists changes to Firestore on change.
// Firestore's local cache makes the UI feel instant — the toast surfaces only
// when the server write actually fails (offline / permission / quota).

const O = '#F47920' // Brand orange — kept local to avoid coupling to App.jsx.

// Run an updateJob (or any promise-returning fn) and toast on error. Returns
// a thenable so callers can chain if they need to.
function tryUpdate(promise, toast, field) {
  return Promise.resolve(promise).catch(err => {
    toast({ tone: 'error', title: `Couldn't update ${field}`, description: err?.message || 'Try again.' })
  })
}

const JOB_STATUS_OPTIONS = [
  { value: 'on-track',     label: 'On Track',     color: '#22c55e' },
  { value: 'needs-action', label: 'Needs Action', color: O         },
  { value: 'at-risk',      label: 'At Risk',      color: '#eab308' },
  { value: 'blocked',      label: 'Blocked',      color: '#ef4444' },
  { value: 'complete',     label: 'Complete',     color: '#22c55e' },
  { value: 'active',       label: 'Active',       color: O         },
  { value: 'hold',         label: 'On Hold',      color: '#ef4444' },
  { value: 'completed',    label: 'Completed',    color: '#22c55e' },
  { value: 'pending',      label: 'Pending',      color: '#6b7280' },
]

const PHASE_OPTIONS = ['Precon', 'Rough-In', 'Service Release', 'Trim', 'Final', 'Closeout', 'Complete']

export function InlineStatusSelect({ job }) {
  const toast = useToast()
  const opt = JOB_STATUS_OPTIONS.find(o => o.value === job.status) || JOB_STATUS_OPTIONS[5]
  const handleChange = (v) => { if (job._docId) tryUpdate(updateJob(job._docId, { status: v }), toast, 'status') }
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={job.status} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-3 text-xs font-bold border rounded-full w-auto gap-1"
          style={{ backgroundColor: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {JOB_STATUS_OPTIONS.slice(0, 5).map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function InlinePhaseSelect({ job }) {
  const toast = useToast()
  const current = job.phase || phaseLabel(job.progress)
  const handleChange = (v) => { if (job._docId) tryUpdate(updateJob(job._docId, { phase: v }), toast, 'phase') }
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={current} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-3 text-xs border rounded-full w-auto gap-1 bg-white/10 border-white/20 text-muted-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PHASE_OPTIONS.map(p => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function BillingStatusSelect({ job }) {
  const toast = useToast()
  const status = job.billingStatus || 'not-invoiced'
  const color  = BILLING_STATUS_COLOR[status] || '#6b7280'
  const label  = BILLING_STATUS_LABEL[status]  || 'Not Invoiced'
  return (
    <Select
      value={status}
      onValueChange={v => job._docId && tryUpdate(updateJob(job._docId, { billingStatus: v }), toast, 'billing status')}
    >
      <SelectTrigger className="h-auto py-1 px-3 text-xs font-bold border rounded-full min-w-[7.5rem]"
        style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BILLING_STATUSES.map(s => (
          <SelectItem key={s} value={s}>{BILLING_STATUS_LABEL[s]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function MatStatusBadge({ status, docId, onUpdate }) {
  const toast = useToast()
  const color = MAT_STATUS_COLOR[status] || '#6b7280'
  const handleChange = (v) => tryUpdate(onUpdate(docId, v), toast, 'material status')
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={status || 'Ordered'} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-2 text-xs font-bold border rounded-full min-w-[7rem]"
          style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
