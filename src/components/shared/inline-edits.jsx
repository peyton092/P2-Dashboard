import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { updateJob } from '../../hooks/useFirestore'
import { useMutation } from '../../hooks/useMutation'
import { phaseLabel } from '../../lib/jobs'
import { BILLING_STATUSES } from '../../lib/billing'
import { MAT_STATUS_OPTIONS, normalizeMatStatus } from '../../lib/materials'
import {
  JOB_STATUS, BILLING_STATUS, MATERIAL_STATUS, PHASE,
  JOB_STATUS_OPTIONS, PHASE_OPTIONS,
  statusLabel, statusColor,
} from '../../lib/status'
import { withAlpha } from '@/lib/tokens'

// Inline edit selects, shaped as pills, for the status fields of a job and of a
// material. Each one shows the words and the tone of the chosen status, offers
// the statuses of its menu, and writes the status that was picked to the
// document in Firestore, and tells the person whether the write went through. The
// words, tones and menus come from status.js. A select shows the words of the
// chosen status itself, because the stored value is a key such as on-track. Moved
// out of src/App.jsx in Phase 19.

export function InlineStatusSelect({ job }) {
  const { run } = useMutation()
  const color = statusColor(JOB_STATUS, job.status)
  const handleChange = (v) => {
    if (!job._docId) return
    run(() => updateJob(job._docId, { status: v }), {
      success: `Status set to ${statusLabel(JOB_STATUS, v).toLowerCase()}.`,
      error: 'Could not change the status. Try again.',
    })
  }
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={job.status} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-3 text-xs font-bold border rounded-full w-auto gap-1"
          style={{ backgroundColor: withAlpha(color, 0.13), color, borderColor: withAlpha(color, 0.33) }}>
          <SelectValue>{statusLabel(JOB_STATUS, job.status)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {JOB_STATUS_OPTIONS.map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// The words of a stored phase. The menu below stores the words themselves
// (Service release), as it always has. Seed data and older writes hold a key such
// as rough-in-passed, or Title Case words, so the text is matched as a key first.
// Anything else shows as written, without its hyphens.
function phaseWords(stored) {
  const text = String(stored ?? '').trim()
  const key = text.toLowerCase().replace(/\s+/g, '-')
  if (Object.hasOwn(PHASE, key)) return statusLabel(PHASE, key)
  const plain = text.replace(/-/g, ' ')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

export function InlinePhaseSelect({ job }) {
  const { run } = useMutation()
  const words = phaseWords(job.phase || phaseLabel(job.progress))
  const handleChange = (v) => {
    if (!job._docId) return
    run(() => updateJob(job._docId, { phase: v }), {
      success: `Phase set to ${v.toLowerCase()}.`,
      error: 'Could not change the phase. Try again.',
    })
  }
  // The stored value is the words and not the key. The HVAC alert reads a stored
  // service-release as the service being obtained, which choosing the phase does
  // not mean.
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={words} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-3 text-xs border rounded-full w-auto gap-1 bg-white/10 border-white/20 text-muted-foreground">
          <SelectValue>{words}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PHASE_OPTIONS.map(o => (
            <SelectItem key={o.value} value={o.label}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function BillingStatusSelect({ job }) {
  const { run } = useMutation()
  const status = job.billingStatus || 'not-invoiced'
  const color  = statusColor(BILLING_STATUS, status)
  const label  = statusLabel(BILLING_STATUS, status)
  const handleChange = (v) => {
    if (!job._docId) return
    run(() => updateJob(job._docId, { billingStatus: v }), {
      success: `Billing status set to ${statusLabel(BILLING_STATUS, v).toLowerCase()}.`,
      error: 'Could not change the billing status. Try again.',
    })
  }
  return (
    <Select value={status} onValueChange={handleChange}>
      <SelectTrigger className="h-auto py-1 px-3 text-xs font-bold border rounded-full min-w-[7.5rem]"
        style={{ backgroundColor: withAlpha(color, 0.13), color, borderColor: withAlpha(color, 0.33) }}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BILLING_STATUSES.map(s => (
          <SelectItem key={s} value={s}>{statusLabel(BILLING_STATUS, s)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function MatStatusBadge({ status, docId, onUpdate }) {
  const current = normalizeMatStatus(status)
  const color = statusColor(MATERIAL_STATUS, current)
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={current} onValueChange={v => onUpdate(docId, v)}>
        <SelectTrigger className="h-auto py-0.5 px-2 text-xs font-bold border rounded-full min-w-[7rem]"
          style={{ backgroundColor: withAlpha(color, 0.13), color, borderColor: withAlpha(color, 0.33) }}>
          <SelectValue>{statusLabel(MATERIAL_STATUS, current)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{statusLabel(MATERIAL_STATUS, s)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
