import {
  TriangleAlertIcon, BadgeCheckIcon, DollarSignIcon, FilePenLineIcon,
  PackageIcon, ShieldCheckIcon, UserRoundCogIcon,
} from 'lucide-react'
import { classifyRisk, hasFailedInspection, isBillingReady, isHvacStartupBlocked, daysSince } from '../agent/scoring'
import { jobName } from './jobs'
import { matIsOpen, matIsOverdue, matIsBlocking, matDaysUntilNeeded } from './materials'
import { subInsuranceExpired, subInsuranceExpiringSoon, subHasMissingDocs } from './subs'

// Read-only daily operating brief data layer. Surfaces the most important
// things to review before the day starts. No write paths — only read
// derivations from useData(). Moved out of src/App.jsx in Phase 18.

const O = '#F47920' // Brand orange — kept local to avoid coupling to App.jsx.

export const BRIEF_CATEGORY_META = {
  'job-risk':    { label: 'Job Risk',         Icon: TriangleAlertIcon, accent: '#ef4444' },
  'inspections': { label: 'Inspections',      Icon: BadgeCheckIcon,    accent: '#3b82f6' },
  'billing':     { label: 'Billing',          Icon: DollarSignIcon,    accent: '#22c55e' },
  'co':          { label: 'Change Orders',    Icon: FilePenLineIcon,   accent: '#eab308' },
  'materials':   { label: 'Materials',        Icon: PackageIcon,       accent: O },
  'subs':        { label: 'Subs Compliance',  Icon: ShieldCheckIcon,   accent: '#06b6d4' },
  'pm':          { label: 'PM Workload',      Icon: UserRoundCogIcon,  accent: '#a78bfa' },
}

export const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 }

export function severityTone(sev) {
  if (sev === 'critical') return 'critical'
  if (sev === 'warning')  return 'warning'
  return 'info'
}
export function severityColor(sev) {
  if (sev === 'critical') return '#ef4444'
  if (sev === 'warning')  return '#eab308'
  return '#3b82f6'
}

// Generate the full set of briefing items from the live data set. Each item
// is independent and self-describing so the priority list and the grouped
// section panels both render the same shape.
export function buildBriefingItems({ jobs, extras, materials, subs }) {
  const items = []
  const activeJobs = jobs.filter(j => !['complete', 'completed'].includes(j.status))

  // Job risk — failed inspections, blocked, on-hold, critical-risk, stale.
  for (const j of activeJobs) {
    const risk = classifyRisk(j)
    const stale = daysSince(j.lastStatusChange || j.start)
    if (hasFailedInspection(j)) {
      items.push({
        id: `risk_failed_${j.id}`,
        category: 'job-risk',
        severity: 'critical',
        jobId: j.id,
        title: `${jobName(j)} — failed inspection`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Coordinate rework — inspection failed',
        age: stale,
      })
      continue
    }
    if (j.status === 'blocked' || isHvacStartupBlocked(j)) {
      items.push({
        id: `risk_blocked_${j.id}`,
        category: 'job-risk',
        severity: 'critical',
        jobId: j.id,
        title: `${jobName(j)} — blocked`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: isHvacStartupBlocked(j) ? 'HVAC startup blocked — release E service' : 'Unblock job',
        age: stale,
      })
      continue
    }
    if (j.status === 'hold') {
      items.push({
        id: `risk_hold_${j.id}`,
        category: 'job-risk',
        severity: 'critical',
        jobId: j.id,
        title: `${jobName(j)} — on hold`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Release hold',
        age: stale,
      })
      continue
    }
    if (risk?.level === 'critical') {
      items.push({
        id: `risk_crit_${j.id}`,
        category: 'job-risk',
        severity: 'critical',
        jobId: j.id,
        title: `${jobName(j)} — high risk`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: risk.reason ? `Triage — ${risk.reason}` : 'Triage — high risk',
        age: stale,
      })
      continue
    }
    if (j.status === 'needs-action') {
      items.push({
        id: `risk_needs_${j.id}`,
        category: 'job-risk',
        severity: 'warning',
        jobId: j.id,
        title: `${jobName(j)} — needs action`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Resolve open item',
        age: stale,
      })
      continue
    }
    if (risk?.level === 'warning') {
      items.push({
        id: `risk_warn_${j.id}`,
        category: 'job-risk',
        severity: 'warning',
        jobId: j.id,
        title: `${jobName(j)} — at risk`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: risk.reason ? `Follow up — ${risk.reason}` : 'Follow up — at risk',
        age: stale,
      })
      continue
    }
    if (stale !== null && stale >= 7) {
      items.push({
        id: `risk_stale_${j.id}`,
        category: 'job-risk',
        severity: 'warning',
        jobId: j.id,
        title: `${jobName(j)} — ${stale}d since update`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Field update needed',
        age: stale,
      })
    }
  }

  // Inspections — scheduled (next call-in) and pending-verification.
  for (const j of activeJobs) {
    const insp = j.insp || {}
    for (const trade of ['electrical', 'plumbing', 'hvac']) {
      const t = insp[trade] || {}
      for (const phase of ['roughIn', 'trim', 'final']) {
        const v = t[phase]
        if (v === 'scheduled' || v === 'pending-verification') {
          const phaseLabelText = phase === 'roughIn' ? 'rough-in' : phase
          items.push({
            id: `insp_${j.id}_${trade}_${phase}`,
            category: 'inspections',
            severity: v === 'scheduled' ? 'info' : 'warning',
            jobId: j.id,
            title: `${jobName(j)} — ${trade} ${phaseLabelText}`,
            owner: j.pm ? `PM ${j.pm}${j.subs?.[trade] ? ` · Sub ${j.subs[trade]}` : ''}` : null,
            nextAction: v === 'scheduled' ? 'Confirm with inspector' : 'Verify last result',
            age: null,
          })
        }
      }
    }
  }

  // Billing — holds, missing-permit on bill-ready jobs, overdue invoices.
  const pendingCOByJob = new Map()
  extras.forEach(e => {
    if (e.status === 'pending' || e.status === 'Sent to Builder' || e.status === 'Draft') {
      if (e.job) pendingCOByJob.set(e.job, (pendingCOByJob.get(e.job) || 0) + 1)
    }
  })
  for (const j of jobs) {
    const ready = isBillingReady(j, extras)
    if (j.billingStatus === 'hold') {
      items.push({
        id: `bill_hold_${j.id}`,
        category: 'billing',
        severity: 'critical',
        jobId: j.id,
        title: `${jobName(j)} — billing on hold`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Resolve hold reason',
        age: null,
      })
      continue
    }
    if (ready && !j.permitNumber) {
      items.push({
        id: `bill_perm_${j.id}`,
        category: 'billing',
        severity: 'warning',
        jobId: j.id,
        title: `${jobName(j)} — billable, missing permit`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Add permit number',
        age: null,
      })
      continue
    }
    if (ready && (pendingCOByJob.get(j.id) || 0) > 0) {
      items.push({
        id: `bill_co_${j.id}`,
        category: 'billing',
        severity: 'warning',
        jobId: j.id,
        title: `${jobName(j)} — billable, CO pending`,
        owner: j.pm ? `PM ${j.pm}` : null,
        nextAction: 'Confirm CO before billing',
        age: null,
      })
    }
  }

  // Change Orders — pending or sent-to-builder, especially aging ones.
  for (const e of extras) {
    if (e.status !== 'pending' && e.status !== 'Sent to Builder') continue
    const sentTs = e.sentAt?.toDate?.() || (e.sentAt ? new Date(e.sentAt) : null)
    const dateTs = e.date ? new Date(e.date) : null
    const created = e.createdAt?.toDate?.() || (e.createdAt ? new Date(e.createdAt) : null)
    const t = sentTs || dateTs || created
    const age = t && !isNaN(t.getTime()) ? Math.floor((Date.now() - t.getTime()) / 86400000) : null
    let severity = 'info'
    let nextAction = 'Awaiting builder approval'
    if (age != null && age >= 7) { severity = 'critical'; nextAction = 'Escalate — long pending' }
    else if (age != null && age >= 3) { severity = 'warning'; nextAction = 'Follow up with builder' }
    items.push({
      id: `co_${e._docId || e.id}`,
      category: 'co',
      severity,
      jobId: e.job || null,
      title: `${e.coNumber || e.id || 'CO'} — ${e.desc || 'change order'}`,
      owner: e.pm ? `PM ${e.pm}` : null,
      nextAction,
      age,
    })
  }

  // Materials — overdue or blocking-soon.
  for (const m of materials) {
    if (!matIsOpen(m)) continue
    const overdue = matIsOverdue(m)
    const blocking = matIsBlocking(m)
    if (!overdue && !blocking) continue
    const days = matDaysUntilNeeded(m)
    const matNameLocal = m.name || m.item || '—'
    const matJobIdLocal = m.jobId || m.job || null
    items.push({
      id: `mat_${m._docId || m.id}_${matNameLocal}`,
      category: 'materials',
      severity: overdue ? 'critical' : 'warning',
      jobId: matJobIdLocal,
      title: `${matNameLocal} — ${m.qty || 0} ${m.unit || 'ea'}`,
      owner: m.vendor ? `Vendor ${m.vendor}` : null,
      nextAction: overdue
        ? 'Follow up today — overdue'
        : days !== null ? `Due in ${days}d — confirm with supplier` : 'Confirm with supplier',
      age: overdue && days !== null ? Math.abs(days) : null,
    })
  }

  // Subs / Compliance — expired insurance, missing W-9.
  for (const s of subs) {
    if (subInsuranceExpired(s)) {
      items.push({
        id: `sub_insexp_${s.id}`,
        category: 'subs',
        severity: 'critical',
        jobId: null,
        title: `${s.name} — insurance expired`,
        owner: s.trade ? `${s.trade} sub` : null,
        nextAction: 'Insurance expired — do not assign',
        age: null,
      })
      continue
    }
    if (subHasMissingDocs(s)) {
      items.push({
        id: `sub_w9_${s.id}`,
        category: 'subs',
        severity: 'critical',
        jobId: null,
        title: `${s.name} — W-9 missing`,
        owner: s.trade ? `${s.trade} sub` : null,
        nextAction: 'Collect W-9 — cannot assign',
        age: null,
      })
      continue
    }
    if (subInsuranceExpiringSoon(s)) {
      items.push({
        id: `sub_insexp_soon_${s.id}`,
        category: 'subs',
        severity: 'warning',
        jobId: null,
        title: `${s.name} — insurance expiring`,
        owner: s.trade ? `${s.trade} sub` : null,
        nextAction: 'Insurance expiring soon — request renewal',
        age: null,
      })
    }
  }

  // PM Workload — PMs with critical risk OR ≥10 active jobs.
  const pmMap = new Map()
  for (const j of activeJobs) {
    const pm = j.pm
    if (!pm) continue
    if (!pmMap.has(pm)) pmMap.set(pm, { pm, jobs: 0, critical: 0, warning: 0, blocked: 0 })
    const entry = pmMap.get(pm)
    entry.jobs += 1
    const r = classifyRisk(j)
    if (r?.level === 'critical') entry.critical += 1
    else if (r?.level === 'warning') entry.warning += 1
    if (j.status === 'blocked' || hasFailedInspection(j)) entry.blocked += 1
  }
  for (const entry of pmMap.values()) {
    if (entry.critical >= 1 || entry.blocked >= 2) {
      items.push({
        id: `pm_help_${entry.pm}`,
        category: 'pm',
        severity: 'critical',
        jobId: null,
        title: `${entry.pm} — help needed`,
        owner: `${entry.jobs} active job${entry.jobs === 1 ? '' : 's'}`,
        nextAction: entry.critical > 0
          ? `${entry.critical} high-risk job${entry.critical === 1 ? '' : 's'} — triage today`
          : `${entry.blocked} blocked job${entry.blocked === 1 ? '' : 's'} — clear blockers`,
        age: null,
      })
    } else if (entry.warning >= 3 || entry.jobs >= 10) {
      items.push({
        id: `pm_load_${entry.pm}`,
        category: 'pm',
        severity: 'warning',
        jobId: null,
        title: `${entry.pm} — workload pressure`,
        owner: `${entry.jobs} active job${entry.jobs === 1 ? '' : 's'}`,
        nextAction: entry.warning >= 3
          ? `${entry.warning} at-risk jobs — follow up`
          : 'Volume risk — watch for dropped items',
        age: null,
      })
    }
  }

  // Sort: severity first, then age desc (older items surface first).
  items.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 9
    const sb = SEVERITY_RANK[b.severity] ?? 9
    if (sa !== sb) return sa - sb
    return (b.age ?? -1) - (a.age ?? -1)
  })

  return items
}
