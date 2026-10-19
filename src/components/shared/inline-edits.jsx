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
  statusLabel, statusColor, statusTone, toneText,
} from '../../lib/status'
import { withAlpha } from '@/lib/tokens'

// Inline edit selects, shaped as pills, for the status fields of a job and of a
// material. Each one shows the words of the chosen status and offers the statuses
// of its menu. The status, billing and material selects also show its tone: a tint
// of the tone for the fill and the border, and the tone's text color for the words,
// which are small (see toneText). The phase select shows the words only, because a
// phase says where the work is and not how it is going. The job selects write the
// status that was picked to the job in Firestore and tell the person whether the
// write went through; the material select hands the pick to the screen, through
// onUpdate, which writes it and its history entry. The words, tones and menus come
// from status.js. A select shows the words of the chosen status itself, because the
// stored value is a key such as on-track. A list's words are its value and not its name,
// so each one is named by what it sets, and for which job: Status of QBS-003. Moved out
// of src/App.jsx in Phase 19.

// The colors of a select shaped as a pill, for a status of a map.
const pillColors = (map, key) => {
  const color = statusColor(map, key)
  return { backgroundColor: withAlpha(color, 0.13), color: toneText(statusTone(map, key)), borderColor: withAlpha(color, 0.33) }
}

export function InlineStatusSelect({ job }) {
  const { run } = useMutation()
  const handleChange = (v) => {
    if (!job._docId) return
    run(() => updateJob(job._docId, { status: v }), {
      success: `Status set to ${statusLabel(JOB_STATUS, v).toLowerCase()}.`,
      error: 'Could not change the status. Try again.',
      queue: true,
    })
  }
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={job.status} onValueChange={handleChange}>
        <SelectTrigger aria-label={job.id ? `Status of ${job.id}` : 'Job status'} className="h-auto py-0.5 px-3 text-xs font-bold border rounded-full w-auto gap-1"
          style={pillColors(JOB_STATUS, job.status)}>
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
      queue: true,
    })
  }
  // The stored value is the words and not the key. The HVAC alert reads a stored
  // service-release as the service being obtained, which choosing the phase does
  // not mean.
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={words} onValueChange={handleChange}>
        <SelectTrigger aria-label={job.id ? `Phase of ${job.id}` : 'Phase'} className="h-auto py-0.5 px-3 text-xs border rounded-full w-auto gap-1 bg-white/10 border-white/20 text-muted-foreground">
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
  const label  = statusLabel(BILLING_STATUS, status)
  const handleChange = (v) => {
    if (!job._docId) return
    run(() => updateJob(job._docId, { billingStatus: v }), {
      success: `Billing status set to ${statusLabel(BILLING_STATUS, v).toLowerCase()}.`,
      error: 'Could not change the billing status. Try again.',
      queue: true,
    })
  }
  return (
    <Select value={status} onValueChange={handleChange}>
      <SelectTrigger aria-label={job.id ? `Billing status of ${job.id}` : 'Billing status'} className="h-auto py-1 px-3 text-xs font-bold border rounded-full min-w-[7.5rem]"
        style={pillColors(BILLING_STATUS, status)}>
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

export function MatStatusBadge({ status, docId, onUpdate, label = 'Material status' }) {
  const current = normalizeMatStatus(status)
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={current} onValueChange={v => onUpdate(docId, v)}>
        <SelectTrigger aria-label={label} className="h-auto py-0.5 px-2 text-xs font-bold border rounded-full min-w-[7rem]"
          style={pillColors(MATERIAL_STATUS, current)}>
          <SelectValue>{statusLabel(MATERIAL_STATUS, current)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{statusLabel(MATERIAL_STATUS, s)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
