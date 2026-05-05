import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import {
  scoreJob, classifyRisk, daysSince,
  hasFailedInspection, isBillingReady, isHvacStartupBlocked,
} from '../agent/scoring'
import { ZONES, PM_TO_ZONE } from '../agent/zones'
import { updateJob } from '../hooks/useFirestore'
import {
  PageHeader,
  MetricTile,
  DataPanel,
  Pill,
  EmptyState,
  AllClearState,
  LoadingState,
  FilterBar,
} from './shared'
import {
  UserRoundCogIcon, TriangleAlertIcon, ActivityIcon,
  FilePenLineIcon, ReceiptIcon, BadgeCheckIcon,
  ChevronDownIcon, MapPinIcon, AlertCircleIcon, BanIcon,
  CheckCircleIcon,
} from 'lucide-react'

const O = '#F47920'
const TODAY = new Date()

// Roster — preserved from prior implementation. These are the six QBS PMs;
// any additional PM names that appear in active job data are merged in too,
// so unexpected assignments still show up on the board.
const QBS_PMS = [
  'Blake Neblett',
  'Brendan Embry',
  'Jeb Brooks',
  'Taylor Hensley',
  'Tim King',
  'Derek Powers',
]

const isComplete = (j) => ['complete', 'completed'].includes(j.status)
const jobLabel   = (j) => j.name || j.client?.split?.(' ')?.[0] || j.id

function hasUpcomingInspection(job) {
  const insp = job.insp || {}
  return Object.values(insp).some(t =>
    Object.values(t || {}).some(s => s === 'scheduled' || s === 'pending-verification'),
  )
}

function hasPermit(job) {
  return Boolean(job.permitNumber && String(job.permitNumber).trim())
}

function jobBillingBlocker(job, pendingCOCount) {
  if (job.billingStatus === 'hold')           return 'On hold'
  if (isBillingReady(job) && !hasPermit(job)) return 'Missing permit'
  if (isBillingReady(job) && pendingCOCount > 0) return 'CO pending'
  return null
}

function jobNextAction(job) {
  if (job.nextAction?.trim()) return job.nextAction.trim()
  if (hasFailedInspection(job))    return 'Coordinate rework'
  if (isHvacStartupBlocked(job))   return 'Push electrical service release'
  if (job.status === 'blocked')    return 'Unblock & re-plan'
  if (job.status === 'needs-action') return 'Resolve open item'
  if (hasUpcomingInspection(job))  return 'Confirm upcoming inspection'
  if (isBillingReady(job) && !hasPermit(job)) return 'Add permit number'
  if (isBillingReady(job))         return 'Submit invoice — milestone earned'
  const stale = daysSince(job.lastStatusChange || job.start)
  if (stale !== null && stale >= 7) return 'Field update needed'
  if (stale !== null && stale >= 3) return 'Daily status check-in'
  return 'Continue scheduled work'
}

function fmtDateShort(date) {
  if (!date) return null
  try {
    const d = date?.toDate ? date.toDate() : new Date(date)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return null }
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - TODAY.getTime()) / 86400000)
}

// ── PM workload summary ──────────────────────────────────────────────────────
//
// Reduces a PM's active job list + relevant change orders into a single
// manager-readable workload snapshot. Thresholds here are operational rules
// of thumb — they don't change the underlying risk model in agent/scoring.js.

function summarizePM(pm, allJobs, allExtras) {
  const jobs = allJobs.filter(j => j.pm === pm && !isComplete(j))

  // Map of jobId → count of in-flight change orders blocking that job.
  const pendingCOByJob = new Map()
  allExtras.forEach(e => {
    const inFlight = e.status === 'pending'
                  || e.status === 'Sent to Builder'
                  || e.status === 'Draft'
    if (inFlight && e.job) {
      pendingCOByJob.set(e.job, (pendingCOByJob.get(e.job) || 0) + 1)
    }
  })

  let critical = 0, warning = 0, blocked = 0
  let failedInsp = 0, upcomingInsp = 0
  let billingBlockers = 0
  let stale7 = 0
  let openCOs = 0

  jobs.forEach(j => {
    const r = classifyRisk(j)
    if (r?.level === 'critical') critical += 1
    else if (r?.level === 'warning') warning += 1

    if (j.status === 'blocked' || hasFailedInspection(j) || isHvacStartupBlocked(j)) {
      blocked += 1
    }
    if (hasFailedInspection(j))    failedInsp += 1
    if (hasUpcomingInspection(j))  upcomingInsp += 1
    if (jobBillingBlocker(j, pendingCOByJob.get(j.id) || 0)) billingBlockers += 1

    const stale = daysSince(j.lastStatusChange || j.start)
    if (stale !== null && stale >= 7) stale7 += 1

    openCOs += pendingCOByJob.get(j.id) || 0
  })

  // Workload pressure tier — order matters: blocked/failed wins over volume.
  let pressure
  if (jobs.length === 0) {
    pressure = { tone: 'mute',     label: 'No active assignments' }
  } else if (failedInsp > 0 || blocked >= 2 || critical >= 1) {
    pressure = { tone: 'critical', label: 'Help needed' }
  } else if (warning >= 3 || jobs.length >= 10) {
    pressure = { tone: 'warning',  label: 'Workload pressure' }
  } else if (warning >= 1 || jobs.length >= 6) {
    pressure = { tone: 'brand',    label: 'Heavy load' }
  } else if (jobs.length >= 3) {
    pressure = { tone: 'info',     label: 'Steady' }
  } else {
    pressure = { tone: 'success',  label: 'On track' }
  }

  // Single most important PM-level next action.
  let nextAction
  if (failedInsp > 0) {
    nextAction = `Coordinate rework on ${failedInsp} job${failedInsp === 1 ? '' : 's'}`
  } else if (blocked > 0) {
    nextAction = `Unblock ${blocked} job${blocked === 1 ? '' : 's'} — help needed`
  } else if (billingBlockers > 0) {
    nextAction = `Resolve ${billingBlockers} billing blocker${billingBlockers === 1 ? '' : 's'}`
  } else if (warning >= 3) {
    nextAction = `Triage ${warning} at-risk job${warning === 1 ? '' : 's'} — workload pressure`
  } else if (warning >= 1) {
    nextAction = `Follow up on ${warning} at-risk job${warning === 1 ? '' : 's'}`
  } else if (upcomingInsp > 0) {
    nextAction = `Confirm ${upcomingInsp} upcoming inspection${upcomingInsp === 1 ? '' : 's'}`
  } else if (openCOs > 0) {
    nextAction = `Push ${openCOs} change order${openCOs === 1 ? '' : 's'} for approval`
  } else if (stale7 > 0) {
    nextAction = `Field update needed on ${stale7} job${stale7 === 1 ? '' : 's'}`
  } else if (jobs.length === 0) {
    nextAction = 'No active assignments'
  } else {
    nextAction = 'No PM issues requiring action'
  }

  return {
    pm,
    jobs,
    activeCount: jobs.length,
    atRisk: critical + warning,
    critical,
    warning,
    blocked,
    failedInsp,
    upcomingInsp,
    billingBlockers,
    openCOs,
    stale7,
    pressure,
    nextAction,
    pendingCOByJob,
  }
}

// ── Filter chips ─────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',         label: 'All PMs' },
  { id: 'overloaded',  label: 'Overloaded' },
  { id: 'at-risk',     label: 'At risk' },
  { id: 'blocked',     label: 'Blocked' },
  { id: 'billing',     label: 'Billing' },
  { id: 'inspections', label: 'Inspections' },
]

function pmMatchesFilter(s, filter) {
  if (filter === 'all')         return true
  if (filter === 'overloaded')  return s.pressure.tone === 'critical' || s.pressure.tone === 'warning' || s.activeCount >= 6
  if (filter === 'at-risk')     return s.atRisk > 0
  if (filter === 'blocked')     return s.blocked > 0
  if (filter === 'billing')     return s.billingBlockers > 0
  if (filter === 'inspections') return s.upcomingInsp > 0 || s.failedInsp > 0
  return true
}

// Pressure-tone → fg color (used for the action microcopy line).
const TONE_COLOR = {
  critical: '#ef4444',
  warning:  '#eab308',
  brand:    O,
  success:  '#22c55e',
  info:     '#3b82f6',
  mute:     '#9ca3af',
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PMDashboard() {
  const { jobs = [], extras = [], loading } = useData()
  const [filter, setFilter]     = useState('all')
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState({})

  // Roster + any other PM that owns active work, so nothing disappears when
  // an unexpected assignment hits Firestore.
  const allPMs = useMemo(() => {
    const set = new Set(QBS_PMS)
    jobs.forEach(j => {
      if (j.pm && !isComplete(j)) set.add(j.pm)
    })
    return Array.from(set)
  }, [jobs])

  const summaries = useMemo(
    () => allPMs.map(pm => summarizePM(pm, jobs, extras)),
    [allPMs, jobs, extras],
  )

  // Aggregate KPI counts across the entire roster.
  const kpis = useMemo(() => {
    const activePMs = summaries.filter(s => s.activeCount > 0).length
    const needsAction = summaries.reduce((sum, s) =>
      sum + s.jobs.filter(j =>
        j.status === 'needs-action'
        || j.status === 'blocked'
        || hasFailedInspection(j)
        || isHvacStartupBlocked(j),
      ).length, 0)
    const atRisk          = summaries.reduce((sum, s) => sum + s.atRisk,          0)
    const openCOs         = summaries.reduce((sum, s) => sum + s.openCOs,         0)
    const billingBlockers = summaries.reduce((sum, s) => sum + s.billingBlockers, 0)
    const upcomingInsp    = summaries.reduce((sum, s) => sum + s.upcomingInsp,    0)
    const totalActive     = summaries.reduce((sum, s) => sum + s.activeCount,     0)
    return { activePMs, needsAction, atRisk, openCOs, billingBlockers, upcomingInsp, totalActive }
  }, [summaries])

  // Apply filter + search, then sort: critical tone first, then volume.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const toneRank = { critical: 0, warning: 1, brand: 2, info: 3, success: 4, mute: 5 }
    return summaries
      .filter(s => pmMatchesFilter(s, filter))
      .filter(s => !q || s.pm.toLowerCase().includes(q))
      .sort((a, b) => {
        const t = (toneRank[a.pressure.tone] ?? 6) - (toneRank[b.pressure.tone] ?? 6)
        if (t !== 0) return t
        return b.atRisk - a.atRisk || b.activeCount - a.activeCount
      })
  }, [summaries, filter, search])

  const chipCounts = useMemo(() => {
    const out = {}
    FILTERS.forEach(f => { out[f.id] = summaries.filter(s => pmMatchesFilter(s, f.id)).length })
    return out
  }, [summaries])

  const filterChips = FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || search.trim() !== ''

  function toggleExpand(pm) {
    setExpanded(prev => ({ ...prev, [pm]: !prev[pm] }))
  }

  // ── Loading branch ──────────────────────────────────────────────────────────
  if (loading && jobs.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="PM Dashboard"
          title="Manager accountability & workload control"
          subtitle="Loading PM workload board…"
        />
        <LoadingState label="Loading PM workload…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PM Dashboard"
        title="Manager accountability & workload control"
        subtitle="Who is overloaded, who owns risk, and what each PM should do next."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.activePMs} of {allPMs.length} PMs with active work</span>
            <span>{kpis.totalActive} active assignments</span>
          </>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="PM accountability"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Active PMs"
          value={kpis.activePMs}
          Icon={UserRoundCogIcon}
          sub={`${allPMs.length} on roster`}
        />
        <MetricTile
          label="Jobs Needing Action"
          value={kpis.needsAction}
          Icon={TriangleAlertIcon}
          emphasis={kpis.needsAction > 0 ? 'warning' : 'success'}
          sub={kpis.needsAction > 0 ? 'Failed inspection or blocked' : 'No PM issues today'}
        />
        <MetricTile
          label="At-Risk Jobs"
          value={kpis.atRisk}
          Icon={ActivityIcon}
          emphasis={kpis.atRisk > 0 ? 'critical' : 'success'}
          sub={kpis.atRisk > 0 ? 'Stalled or warning level' : 'No at-risk jobs'}
        />
        <MetricTile
          label="Open Change Orders"
          value={kpis.openCOs}
          Icon={FilePenLineIcon}
          emphasis={kpis.openCOs > 0 ? 'warning' : 'mute'}
          sub={kpis.openCOs > 0 ? 'Pending or sent to builder' : 'No COs in flight'}
        />
        <MetricTile
          label="Billing Blockers"
          value={kpis.billingBlockers}
          Icon={ReceiptIcon}
          emphasis={kpis.billingBlockers > 0 ? 'critical' : 'success'}
          sub={kpis.billingBlockers > 0 ? 'Hold, missing docs, or CO' : 'Clean billing pipe'}
        />
      </section>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search PM name…"
        chips={filterChips}
        trailing={hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setFilter('all'); setSearch('') }}
            className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
          >
            Clear
          </button>
        )}
      />

      {/* Workload board */}
      <DataPanel
        title="Workload Board"
        description={
          visible.length === 0
            ? 'No PMs match the current filters.'
            : `${visible.length} of ${summaries.length} PM${summaries.length === 1 ? '' : 's'}`
        }
        Icon={UserRoundCogIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <PMEmptyState filter={filter} hasSearch={Boolean(search.trim())} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(s => (
              <li key={s.pm}>
                <PMRow
                  s={s}
                  expanded={!!expanded[s.pm]}
                  onToggle={() => toggleExpand(s.pm)}
                />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PMEmptyState({ filter, hasSearch }) {
  if (hasSearch) {
    return (
      <EmptyState
        Icon={UserRoundCogIcon}
        title="No PMs match"
        description="Adjust the search above or clear filters to see the whole roster."
      />
    )
  }
  if (filter === 'overloaded') {
    return (
      <AllClearState
        title="No PM is overloaded"
        description="No critical pressure or volume warnings on the roster right now."
      />
    )
  }
  if (filter === 'at-risk') {
    return (
      <AllClearState
        title="No PM owns at-risk work"
        description="Every active job is on track."
      />
    )
  }
  if (filter === 'blocked') {
    return (
      <AllClearState
        title="Nothing blocked"
        description="No failed inspections or hard blockers on any PM's queue."
      />
    )
  }
  if (filter === 'billing') {
    return (
      <AllClearState
        title="Clean billing pipe"
        description="No PM has billing holds, missing docs, or pending COs blocking invoices."
      />
    )
  }
  if (filter === 'inspections') {
    return (
      <AllClearState
        title="No inspections to coordinate"
        description="No upcoming or failed inspections across the roster."
      />
    )
  }
  return <EmptyState title="No PM activity" description="PMs with active work will appear here." />
}

function PMRow({ s, expanded, onToggle }) {
  const zone = ZONES[PM_TO_ZONE[s.pm]] || ZONES['zone-7']
  const initials = s.pm.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const accent = zone.color || O
  const nextColor = TONE_COLOR[s.pressure.tone] || TONE_COLOR.mute

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-white/[0.025] transition-colors"
      >
        {/* Avatar */}
        <div
          className="shrink-0 mt-0.5 flex items-center justify-center rounded-full text-[11px] font-bold"
          style={{
            width: 36,
            height: 36,
            backgroundColor: accent + '22',
            color: accent,
          }}
        >
          {initials}
        </div>

        {/* Identity + workload */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white truncate">{s.pm}</p>
            {zone?.pm && (
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                <MapPinIcon size={10} />
                {zone.name} · {zone.area}
              </span>
            )}
            <Pill tone={s.pressure.tone} size="xs">{s.pressure.label}</Pill>
          </div>

          {/* Per-PM stat strip — wraps cleanly on mobile */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
            <PMStat label="active"      value={s.activeCount}                          tone="brand" />
            <PMStat label="at risk"     value={s.atRisk}                               tone={s.atRisk > 0 ? 'warning' : 'mute'} />
            <PMStat label="blocked"     value={s.blocked}                              tone={s.blocked > 0 ? 'critical' : 'mute'} />
            <PMStat label="open COs"    value={s.openCOs}                              tone={s.openCOs > 0 ? 'warning' : 'mute'} />
            <PMStat label="billing"     value={s.billingBlockers}                      tone={s.billingBlockers > 0 ? 'critical' : 'mute'} />
            <PMStat label="inspections" value={s.upcomingInsp + s.failedInsp}          tone={s.failedInsp > 0 ? 'critical' : s.upcomingInsp > 0 ? 'info' : 'mute'} />
          </div>

          {/* PM-level next action */}
          <div className="flex items-start gap-1.5 mt-2.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-px">Next</span>
            <p
              className="text-[12px] font-semibold leading-snug min-w-0 truncate"
              style={{ color: nextColor }}
              title={s.nextAction}
            >
              {s.nextAction}
            </p>
          </div>
        </div>

        {/* Expand chevron */}
        <ChevronDownIcon
          size={16}
          className="shrink-0 text-zinc-400 mt-1.5 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {expanded && <PMDetail s={s} />}
    </div>
  )
}

function PMStat({ label, value, tone }) {
  const color = TONE_COLOR[tone] || TONE_COLOR.mute
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-bold tabular-nums" style={{ color }}>{value}</span>
      <span className="text-zinc-400">{label}</span>
    </span>
  )
}

function PMDetail({ s }) {
  if (s.activeCount === 0) {
    return (
      <div className="px-4 pb-4">
        <AllClearState
          title="No active assignments"
          description="This PM doesn't currently own any active jobs."
        />
      </div>
    )
  }

  const ranked = [...s.jobs]
    .map(j => ({
      job: j,
      score: scoreJob(j),
      risk: classifyRisk(j),
      pendingCOs: s.pendingCOByJob.get(j.id) || 0,
    }))
    .sort((a, b) => b.score - a.score)

  return (
    <div className="px-3 sm:px-4 pb-4">
      <div className="border border-white/5 rounded-xl bg-white/[0.015] divide-y divide-white/5 overflow-hidden">
        {ranked.map(item => (
          <PMJobRow
            key={item.job._docId || item.job.id}
            job={item.job}
            risk={item.risk}
            score={item.score}
            pendingCOs={item.pendingCOs}
          />
        ))}
      </div>
    </div>
  )
}

function PMJobRow({ job, risk, score, pendingCOs }) {
  const phaseLabel = (job.phase || job.status || '—')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
  const stale = daysSince(job.lastStatusChange || job.start)
  const tDays = daysUntil(job.target)
  const billing = jobBillingBlocker(job, pendingCOs)

  const insp = job.insp || {}
  const failedTrade = ['electrical', 'plumbing', 'hvac'].find(t =>
    Object.values(insp[t] || {}).some(v => v === 'failed'),
  )
  const upcomingTrade = ['electrical', 'plumbing', 'hvac'].find(t =>
    Object.values(insp[t] || {}).some(v => v === 'scheduled' || v === 'pending-verification'),
  )

  const cleanQuiet = !failedTrade && !upcomingTrade && !pendingCOs && !billing
  const recommended = jobNextAction(job)

  return (
    <div className="px-3 py-2.5 sm:px-4 sm:py-3">
      {/* Header row — id, name, score, risk */}
      <div className="flex items-start gap-2 mb-1.5 flex-wrap">
        <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
          {job.id}
        </span>
        <span className="text-sm font-semibold text-zinc-100 truncate min-w-0 flex-1">
          {jobLabel(job)}
        </span>
        {score >= 30 && (
          <Pill tone={score >= 80 ? 'critical' : score >= 60 ? 'brand' : 'warning'} size="xs">
            <span className="tabular-nums">{score}</span>
          </Pill>
        )}
        {risk && (
          <Pill
            tone={risk.level === 'critical' ? 'critical' : risk.level === 'warning' ? 'warning' : 'info'}
            size="xs"
          >
            {risk.level === 'critical' ? 'High' : risk.level === 'warning' ? 'Medium' : 'Low'}
          </Pill>
        )}
      </div>

      {/* Phase + freshness + target */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 mb-1.5">
        <span className="font-semibold text-zinc-300 truncate">{phaseLabel}</span>
        {stale != null && (
          <span
            className={
              stale >= 7 ? 'font-semibold text-red-400'
              : stale >= 3 ? 'font-semibold text-amber-300'
              : ''
            }
          >
            {stale === 0 ? 'updated today' : stale === 1 ? '1d since update' : `${stale}d since update`}
          </span>
        )}
        {tDays !== null && (
          tDays < 0 ? (
            <span className="font-semibold" style={{ color: '#ef4444' }}>{Math.abs(tDays)}d overdue</span>
          ) : tDays <= 7 ? (
            <span className="font-semibold" style={{ color: '#eab308' }}>Due in {tDays}d</span>
          ) : (
            <span>Due {fmtDateShort(job.target)}</span>
          )
        )}
        {risk?.reason && (
          <span className="truncate max-w-full" title={risk.reason}>{risk.reason}</span>
        )}
      </div>

      {/* Status chips — only what's actionable for this job */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {failedTrade && (
          <Pill tone="critical" size="xs" Icon={AlertCircleIcon}>
            {failedTrade} failed
          </Pill>
        )}
        {upcomingTrade && !failedTrade && (
          <Pill tone="info" size="xs" Icon={BadgeCheckIcon}>
            {upcomingTrade} inspection due
          </Pill>
        )}
        {pendingCOs > 0 && (
          <Pill tone="warning" size="xs" Icon={FilePenLineIcon}>
            {pendingCOs} CO pending
          </Pill>
        )}
        {billing && (
          <Pill tone="critical" size="xs" Icon={BanIcon}>
            {billing}
          </Pill>
        )}
        {cleanQuiet && (
          <Pill tone="success" size="xs" Icon={CheckCircleIcon}>
            On track
          </Pill>
        )}
      </div>

      {/* Per-job next action — preserves Firestore write on blur */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-2">Next</span>
        <NextActionInput job={job} placeholder={recommended} />
      </div>
    </div>
  )
}

// ── Inline next-action input — Firestore write preserved from prior version ──

function NextActionInput({ job, placeholder }) {
  const [val, setVal] = useState(job.nextAction || '')
  const [saving, setSaving] = useState(false)

  async function handleBlur() {
    if (!job._docId) return
    const trimmed = val.trim()
    if (trimmed === (job.nextAction || '').trim()) return
    setSaving(true)
    try { await updateJob(job._docId, { nextAction: trimmed }) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      <input
        type="text"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder || 'Next action…'}
        className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-md text-[12px] font-semibold text-zinc-100 px-2.5 py-1.5 placeholder:text-zinc-500 placeholder:font-medium focus:outline-none focus:border-white/30 transition-colors"
      />
      {saving && <span className="text-[10px] text-zinc-400 shrink-0">saving…</span>}
    </div>
  )
}
