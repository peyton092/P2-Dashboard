// Shared job-event helpers — used by the Calendar (month grid) and by the
// CommandCenter's "Upcoming Milestones" panel so they stay in sync.
//
// Event types:
//   target    — job's target completion date
//   start     — job's start date
//   pass/fail — recorded inspection outcome on a trade phase
//   scheduled — inspection booked for a future date but not yet completed

import { STATUS_COLORS } from '../components/shared'

export const EVENT_META = {
  target:    { color: STATUS_COLORS.brand,    label: 'Target completion' },
  start:     { color: STATUS_COLORS.info,     label: 'Job start' },
  scheduled: { color: '#a855f7',              label: 'Inspection scheduled' },
  pass:      { color: STATUS_COLORS.success,  label: 'Inspection passed' },
  fail:      { color: STATUS_COLORS.critical, label: 'Inspection failed' },
}

export const jobLabel = (j) => j?.name || j?.client || j?.id || ''

// Trim a value like '2025-05-15' / '2025-05-15T...' / Date down to YYYY-MM-DD.
export const isoDay = (d) => (d || '').toString().slice(0, 10)

// All scheduled events derived from a single job.
export function jobEvents(job) {
  const evs = []
  if (job.target) evs.push({ date: isoDay(job.target), type: 'target', jobId: job.id, label: `${jobLabel(job)} — target` })
  if (job.start)  evs.push({ date: isoDay(job.start),  type: 'start',  jobId: job.id, label: `${jobLabel(job)} — start` })
  const insp = job.insp || {}
  ;['electrical', 'plumbing', 'hvac'].forEach(t => {
    const tr = insp[t] || {}
    if (tr.roughInDate) evs.push({ date: isoDay(tr.roughInDate), type: tr.roughIn === 'failed' ? 'fail' : 'pass', jobId: job.id, label: `${job.id} ${t} rough-in` })
    if (tr.finalDate)   evs.push({ date: isoDay(tr.finalDate),   type: tr.final   === 'failed' ? 'fail' : 'pass', jobId: job.id, label: `${job.id} ${t} final` })
    // Forward-looking: scheduled inspections that haven't happened yet.
    // Suppressed if an outcome (pass/fail date) already exists for the phase.
    if (tr.roughInScheduled && !tr.roughInDate) {
      evs.push({ date: isoDay(tr.roughInScheduled), type: 'scheduled', jobId: job.id, label: `${job.id} ${t} rough-in scheduled` })
    }
    if (tr.finalScheduled && !tr.finalDate) {
      evs.push({ date: isoDay(tr.finalScheduled), type: 'scheduled', jobId: job.id, label: `${job.id} ${t} final scheduled` })
    }
  })
  return evs
}

// Today as YYYY-MM-DD (local clock).
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
