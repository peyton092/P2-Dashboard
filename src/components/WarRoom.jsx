import { useMemo, useState } from 'react'
import { useData } from '../DataContext'
import {
  scoreJob,
  classifyRisk,
  daysSince,
  hasFailedInspection,
  isBillingReady,
  isHvacStartupBlocked,
} from '../agent/scoring'
import { ZONES, getZoneId } from '../agent/zones'
import {
  PageHeader,
  MetricTile,
  DataPanel,
  Pill,
  EmptyState,
  LoadingState,
  FilterBar,
  ResponsiveTable,
  TableHeader,
  TableRow,
  TableCell,
} from './shared'
import {
  ActivityIcon, AlertCircleIcon,
  // Phase 3 QA — preferred lucide names
  RadarIcon, CrosshairIcon, TriangleAlertIcon, BadgeCheckIcon,
} from 'lucide-react'

const O = '#F47920'
const TODAY = new Date()

// ── Helpers ───────────────────────────────────────────────────────────────────

const isComplete = (j) => ['complete', 'completed'].includes(j.status)
const jobLabel   = (j) => j.name || j.client?.split?.(' ')?.[0] || j.id

function cleanPhase(phase, status) {
  const v = phase || status || '—'
  return String(v).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtDateShort(dateVal) {
  if (!dateVal) return null
  try {
    const d = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return null }
}

function fmtDaysAgo(dateVal) {
  const d = daysSince(dateVal)
  if (d === null) return '—'
  if (d === 0) return 'today'
  if (d === 1) return '1d ago'
  return `${d}d ago`
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - TODAY.getTime()) / 86400000)
}

// Decide the next concrete action for a job. Falls back gracefully when no
// explicit `nextAction` field has been set.
function nextActionFor(job) {
  if (job.nextAction?.trim()) return job.nextAction.trim()

  if (hasFailedInspection(job))    return 'Schedule rework — contact PM + crew'
  if (isHvacStartupBlocked(job))   return 'Push electrical service release'
  if (job.status === 'blocked')    return 'Unblock & re-plan'
  if (job.status === 'needs-action') return 'Resolve open item'

  const insp = job.insp || {}
  for (const trade of ['electrical', 'plumbing', 'hvac']) {
    const t = insp[trade]
    if (!t) continue
    if (t.roughIn === 'scheduled' || t.trim === 'scheduled' || t.final === 'scheduled') {
      return 'Confirm inspection with inspector'
    }
    if (t.roughIn === 'pending-verification' || t.final === 'pending-verification') {
      return 'Verify last inspection result'
    }
    if (t.roughIn === 'pending' && (t.final === 'blocked' || !t.final)) {
      return `Call in ${trade} rough-in`
    }
  }

  if (isBillingReady(job)) return 'Submit invoice — milestone earned'

  const stale = daysSince(job.lastStatusChange || job.start)
  if (stale !== null && stale >= 5) return 'Get field status from PM'
  if (stale !== null && stale >= 2) return 'Daily status check-in'

  return 'Continue scheduled work'
}

// Compact per-trade inspection summary (E/P/H + rough+final dot).
const TRADE_LETTER = { electrical: 'E', plumbing: 'P', hvac: 'H' }
function buildInspectionPills(job) {
  const insp = job.insp || {}
  const out = []
  for (const trade of ['electrical', 'plumbing', 'hvac']) {
    const t = insp[trade]
    if (!t) continue
    const r = t.roughIn, f = t.final
    if ((!r || r === 'n/a') && (!f || f === 'n/a')) continue

    // No unicode symbols — color carries pass/fail; the ASCII suffix carries
    // which phase (R = Rough, F = Final). `+` after the letter means passed.
    let tone = 'mute', dot = null
    if (f === 'failed' || r === 'failed' || t.trim === 'failed') {
      tone = 'critical'; dot = 'F'
    } else if (f === 'passed') {
      tone = 'success'; dot = 'F+'
    } else if (r === 'passed') {
      tone = 'success'; dot = 'R+'
    } else if (
      f === 'scheduled' || r === 'scheduled' || t.trim === 'scheduled'
    ) {
      tone = 'warning'; dot = 'S'
    } else if (
      r === 'pending' || r === 'pending-verification' ||
      f === 'pending' || f === 'pending-verification'
    ) {
      // Pending shows in muted color with no secondary mark — the gray pill
      // tells you the trade is in progress without adding visual noise.
      tone = 'mute'; dot = null
    }
    out.push({ trade, letter: TRADE_LETTER[trade], tone, dot })
  }
  return out
}

function jobBuilder(job) {
  return job.client || job.qbsPM || '—'
}

function jobScope(job) {
  return job.type || '—'
}

// ── Component ────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'at-risk',  label: 'At Risk' },
  { id: 'blocked',  label: 'Blocked' },
  { id: 'insp',     label: 'Inspection' },
  { id: 'complete', label: 'Complete' },
]

const SORTS = [
  { id: 'priority',   label: 'Priority' },
  { id: 'stale',      label: 'Stalled days' },
  { id: 'target',     label: 'Target date' },
  { id: 'name',       label: 'Job name' },
]

export default function WarRoom() {
  const { jobs = [], extras = [], loading } = useData()
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [sortBy, setSortBy]       = useState('priority')

  // ── Derived ─────────────────────────────────────────────────────────────────
  const completedJobs = useMemo(() => jobs.filter(isComplete), [jobs])

  const enriched = useMemo(() => jobs.map(j => {
    const risk = classifyRisk(j)
    const score = scoreJob(j, extras)
    const stale = daysSince(j.lastStatusChange || j.start)
    return {
      job: j,
      risk,
      score,
      stale,
      failed: hasFailedInspection(j),
      hvacBlocked: isHvacStartupBlocked(j),
      billingReady: isBillingReady(j, extras),
      inspectionScheduled: Object.values(j.insp || {}).some(t =>
        Object.values(t || {}).some(s =>
          s === 'scheduled' || s === 'pending-verification',
        ),
      ),
    }
  }), [jobs, extras])

  // KPI counts
  const kpis = useMemo(() => {
    const active   = enriched.filter(e => !isComplete(e.job)).length
    const blocked  = enriched.filter(e =>
      !isComplete(e.job) && (e.failed || e.hvacBlocked || e.job.status === 'blocked'),
    ).length
    const inspReady = enriched.filter(e =>
      !isComplete(e.job) && e.inspectionScheduled,
    ).length
    const highRisk = enriched.filter(e =>
      !isComplete(e.job) && e.risk?.level === 'critical',
    ).length
    return { active, blocked, inspReady, highRisk }
  }, [enriched])

  // Apply filters + search
  const filtered = useMemo(() => {
    let list = enriched

    if (filter === 'all') {
      list = list.filter(e => !isComplete(e.job))
    } else if (filter === 'at-risk') {
      list = list.filter(e =>
        !isComplete(e.job) &&
        (e.risk?.level === 'critical' || e.risk?.level === 'warning'),
      )
    } else if (filter === 'blocked') {
      list = list.filter(e =>
        !isComplete(e.job) && (e.failed || e.hvacBlocked || e.job.status === 'blocked'),
      )
    } else if (filter === 'insp') {
      list = list.filter(e => !isComplete(e.job) && e.inspectionScheduled)
    } else if (filter === 'complete') {
      list = list.filter(e => isComplete(e.job))
    }

    if (zoneFilter !== 'all') {
      list = list.filter(e => getZoneId(e.job) === zoneFilter)
    }

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(({ job: j }) =>
        (j.id || '').toLowerCase().includes(q) ||
        (j.name || '').toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q) ||
        (j.client || '').toLowerCase().includes(q) ||
        (j.pm || '').toLowerCase().includes(q),
      )
    }

    const sorted = [...list]
    if (sortBy === 'priority') {
      sorted.sort((a, b) => b.score - a.score || (b.stale ?? 0) - (a.stale ?? 0))
    } else if (sortBy === 'stale') {
      sorted.sort((a, b) => (b.stale ?? -1) - (a.stale ?? -1))
    } else if (sortBy === 'target') {
      sorted.sort((a, b) => {
        const ta = a.job.target ? new Date(a.job.target).getTime() : Infinity
        const tb = b.job.target ? new Date(b.job.target).getTime() : Infinity
        return ta - tb
      })
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => jobLabel(a.job).localeCompare(jobLabel(b.job)))
    }
    return sorted
  }, [enriched, filter, zoneFilter, search, sortBy])

  // Top Priority cards (always derived from active jobs, not the filter)
  const topPriority = useMemo(() => {
    return enriched
      .filter(e => !isComplete(e.job) && e.score >= 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
  }, [enriched])

  // Filter chip counts (calculated against active jobs, not filtered list)
  const chipCounts = useMemo(() => {
    const total = enriched.filter(e => !isComplete(e.job)).length
    const atRisk = enriched.filter(e =>
      !isComplete(e.job) &&
      (e.risk?.level === 'critical' || e.risk?.level === 'warning'),
    ).length
    const blocked = enriched.filter(e =>
      !isComplete(e.job) && (e.failed || e.hvacBlocked || e.job.status === 'blocked'),
    ).length
    const insp = enriched.filter(e =>
      !isComplete(e.job) && e.inspectionScheduled,
    ).length
    const complete = completedJobs.length
    return { all: total, 'at-risk': atRisk, blocked, insp, complete }
  }, [enriched, completedJobs])

  const filterChips = FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || zoneFilter !== 'all' || search.trim() !== ''

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading && jobs.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="War Room"
          title="Field-status & dispatch"
          subtitle="Live field operations across the active portfolio."
        />
        <LoadingState label="Loading dispatch board…" />
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="War Room"
        title="Field-status & dispatch"
        subtitle="Live across active projects. Surface blockers, ready jobs, and risk by zone."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
            <span>{kpis.active} active · {completedJobs.length} completed</span>
          </>
        }
      />

      {/* KPI strip */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Field status"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      >
        <MetricTile
          label="Active Jobs"
          value={kpis.active}
          Icon={ActivityIcon}
          sub={`${completedJobs.length} completed`}
        />
        <MetricTile
          label="Blocked"
          value={kpis.blocked}
          Icon={AlertCircleIcon}
          emphasis={kpis.blocked > 0 ? 'critical' : 'success'}
          sub={kpis.blocked > 0 ? 'Failed inspection or stuck' : 'Nothing blocked'}
        />
        <MetricTile
          label="Inspection Ready"
          value={kpis.inspReady}
          Icon={BadgeCheckIcon}
          emphasis={kpis.inspReady > 0 ? 'default' : 'mute'}
          sub="Scheduled or pending verify"
        />
        <MetricTile
          label="High Risk"
          value={kpis.highRisk}
          Icon={TriangleAlertIcon}
          emphasis={kpis.highRisk > 0 ? 'critical' : 'success'}
          sub={kpis.highRisk > 0 ? 'Critical-level flags' : 'No critical flags'}
        />
      </section>

      {/* Top Priority */}
      {topPriority.length > 0 && (
        <DataPanel
          title="Top Priority"
          description="Highest agent-scored risk in the active portfolio."
          Icon={CrosshairIcon}
          badge={<Pill tone={topPriority.some(p => p.risk?.level === 'critical') ? 'critical' : 'warning'} size="xs">{topPriority.length}</Pill>}
        >
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
          >
            {topPriority.map(({ job, risk, score }) => (
              <PriorityJobCard
                key={job._docId || job.id}
                job={job}
                risk={risk}
                score={score}
              />
            ))}
          </div>
        </DataPanel>
      )}

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, builder, address, PM…"
        chips={filterChips}
        trailing={
          <>
            <select
              value={zoneFilter}
              onChange={e => setZoneFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30"
            >
              <option value="all">All Zones</option>
              {Object.values(ZONES).map(z => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30"
            >
              {SORTS.map(s => <option key={s.id} value={s.id}>Sort · {s.label}</option>)}
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setZoneFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Dispatch board */}
      <DataPanel
        title="Dispatch Board"
        description={
          filtered.length === 0
            ? 'No jobs match the current filters.'
            : `${filtered.length} of ${enriched.length} job${enriched.length === 1 ? '' : 's'}`
        }
        Icon={RadarIcon}
        padding="none"
      >
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              Icon={CrosshairIcon}
              title="Nothing to dispatch"
              description={
                search.trim() || zoneFilter !== 'all'
                  ? 'No jobs match those filters. Adjust or clear them above.'
                  : filter === 'blocked'
                    ? 'Nothing is blocked right now — clean board.'
                    : filter === 'insp'
                      ? 'No jobs are queued for inspection at the moment.'
                      : filter === 'at-risk'
                        ? 'No jobs are flagged as at-risk.'
                        : filter === 'complete'
                          ? 'No completed jobs in the system yet.'
                          : 'No active jobs.'
              }
              tone={filter === 'blocked' || filter === 'at-risk' ? 'success' : 'neutral'}
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block px-3 sm:px-4 pb-3 pt-1">
              <ResponsiveTable>
                <TableHeader
                  columns={[
                    { key: 'job',     label: 'Job',         width: '18%' },
                    { key: 'builder', label: 'Builder',     width: '14%' },
                    { key: 'pm',      label: 'PM · Lead',   width: '14%' },
                    { key: 'phase',   label: 'Phase',       width: '12%' },
                    { key: 'risk',    label: 'Risk',        width: '8%' },
                    { key: 'insp',    label: 'Inspection',  width: '12%' },
                    { key: 'next',    label: 'Next action', width: '14%' },
                    { key: 'date',    label: 'Last update / Target', width: '8%' },
                  ]}
                />
                <tbody>
                  {filtered.map(({ job, risk, stale }) => (
                    <DispatchRow key={job._docId || job.id} job={job} risk={risk} stale={stale} />
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>

            {/* Mobile cards */}
            <ul className="md:hidden p-3 space-y-2">
              {filtered.map(({ job, risk, score, stale }) => (
                <li key={job._docId || job.id}>
                  <DispatchCard job={job} risk={risk} score={score} stale={stale} />
                </li>
              ))}
            </ul>
          </>
        )}
      </DataPanel>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status, size = 'xs' }) {
  const tone =
    status === 'on-track'     ? 'success'  :
    status === 'at-risk'      ? 'warning'  :
    status === 'needs-action' ? 'brand'    :
    status === 'blocked'      ? 'critical' :
    status === 'hold'         ? 'critical' :
    status === 'complete' || status === 'completed' ? 'success' :
    status === 'active'       ? 'brand'    :
    'mute'
  const label = (status || 'pending').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return <Pill tone={tone} size={size}>{label}</Pill>
}

function RiskPill({ risk, size = 'xs' }) {
  if (!risk) return <span className="text-zinc-500 text-xs">—</span>
  const tone =
    risk.level === 'critical' ? 'critical' :
    risk.level === 'warning'  ? 'warning'  :
    'info'
  const label =
    risk.level === 'critical' ? 'High'   :
    risk.level === 'warning'  ? 'Medium' :
    'Low'
  return <Pill tone={tone} size={size}>{label}</Pill>
}

function InspectionPills({ job }) {
  const pills = buildInspectionPills(job)
  if (pills.length === 0) {
    return <span className="text-zinc-500 text-xs">—</span>
  }
  return (
    <div className="flex items-center gap-1">
      {pills.map(p => (
        <Pill key={p.trade} tone={p.tone} size="xs">
          <span className="">{p.letter}</span>
          {p.dot && <span className="ml-0.5">{p.dot}</span>}
        </Pill>
      ))}
    </div>
  )
}

function ZoneTag({ job, className = '' }) {
  const zone = ZONES[getZoneId(job)] || ZONES['zone-7']
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] text-zinc-400 ${className}`}>
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: zone.color }}
      />
      {zone.name}
    </span>
  )
}

function TargetMeta({ job }) {
  const tDays = daysUntil(job.target)
  if (tDays === null) return null
  if (tDays < 0) return <span className="text-[10px] font-semibold" style={{ color: '#ef4444' }}>{Math.abs(tDays)}d overdue</span>
  if (tDays <= 7) return <span className="text-[10px] font-semibold" style={{ color: '#eab308' }}>Due in {tDays}d</span>
  return <span className="text-[10px] text-zinc-400">Due {fmtDateShort(job.target)}</span>
}

// ── Top Priority card ───────────────────────────────────────────────────────

function PriorityJobCard({ job, risk, score }) {
  const phase = cleanPhase(job.phase, job.status)
  const next = nextActionFor(job)
  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.025] overflow-hidden flex flex-col"
      style={{
        borderLeftWidth: 3,
        borderLeftColor:
          risk?.level === 'critical' ? '#ef4444' :
          risk?.level === 'warning'  ? '#eab308' :
          'rgba(255,255,255,0.10)',
      }}
    >
      <header className="p-3 pb-2 border-b border-white/5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400">
              {job.id}
            </span>
            <p className="text-sm font-bold text-white mt-1 truncate">{jobLabel(job)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Pill tone={score >= 80 ? 'critical' : score >= 60 ? 'brand' : 'warning'} size="xs">
              <span className="tabular-nums">{score}</span>
            </Pill>
            <RiskPill risk={risk} />
          </div>
        </div>
        <p className="text-[11px] text-zinc-400 truncate">
          {jobBuilder(job)}{job.address ? ` · ${job.address}` : ''}
        </p>
      </header>

      <div className="p-3 space-y-2 text-[11px] flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Phase</span>
          <span className="font-semibold text-zinc-100 truncate text-right">{phase}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Owner</span>
          <span className="font-semibold text-zinc-100 truncate text-right">
            {job.pm || 'Unassigned'}{job.lead ? ` · ${job.lead}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Inspection</span>
          <InspectionPills job={job} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Last update</span>
          <span className="text-zinc-100">{fmtDaysAgo(job.lastStatusChange || job.start)}</span>
        </div>
      </div>

      <footer className="px-3 py-2.5 border-t border-white/5 bg-white/[0.015]">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">
          Next action
        </p>
        <p
          className="text-xs font-semibold leading-snug"
          style={{
            color:
              risk?.level === 'critical' ? '#ef4444' :
              risk?.level === 'warning'  ? '#eab308' :
              O,
          }}
        >
          {next}
        </p>
        <div className="flex items-center justify-between mt-2">
          <ZoneTag job={job} />
          <TargetMeta job={job} />
        </div>
      </footer>
    </article>
  )
}

// ── Desktop dispatch row ─────────────────────────────────────────────────────

function DispatchRow({ job, risk, stale }) {
  const phase = cleanPhase(job.phase, job.status)
  const next  = nextActionFor(job)
  const isStaleHigh = stale !== null && stale >= 7
  const tDays = daysUntil(job.target)

  return (
    <TableRow
      className={
        risk?.level === 'critical' ? 'ring-1 ring-red-500/20'
        : risk?.level === 'warning' ? 'ring-1 ring-amber-500/15'
        : ''
      }
    >
      <TableCell first>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 shrink-0">
              {job.id}
            </span>
            <span className="font-semibold text-zinc-100 truncate">{jobLabel(job)}</span>
          </div>
          <ZoneTag job={job} className="mt-0.5" />
        </div>
      </TableCell>
      <TableCell>
        <p className="text-zinc-100 truncate">{jobBuilder(job)}</p>
        <p className="text-[11px] text-zinc-400 truncate">{jobScope(job)}</p>
      </TableCell>
      <TableCell>
        <p className="text-zinc-100 truncate">{job.pm || 'Unassigned'}</p>
        {job.lead && (
          <p className="text-[11px] text-zinc-400 truncate">Lead: {job.lead}</p>
        )}
      </TableCell>
      <TableCell>
        <p className="text-zinc-100 truncate">{phase}</p>
        <div className="mt-1"><StatusPill status={job.status} /></div>
      </TableCell>
      <TableCell><RiskPill risk={risk} /></TableCell>
      <TableCell><InspectionPills job={job} /></TableCell>
      <TableCell className="leading-snug">
        <p className="text-zinc-100 text-xs">{next}</p>
        {risk?.reason && (
          <p className="text-[11px] text-zinc-400 truncate" title={risk.reason}>
            {risk.reason}
          </p>
        )}
      </TableCell>
      <TableCell last className="leading-tight">
        <span className={isStaleHigh ? 'text-red-400 font-semibold text-xs' : 'text-zinc-100 text-xs'}>
          {fmtDaysAgo(job.lastStatusChange || job.start)}
        </span>
        {tDays !== null && (
          <div className="mt-0.5">
            {tDays < 0 ? (
              <span className="text-[11px] font-semibold" style={{ color: '#ef4444' }}>
                {Math.abs(tDays)}d overdue
              </span>
            ) : tDays <= 7 ? (
              <span className="text-[11px] font-semibold" style={{ color: '#eab308' }}>
                Due in {tDays}d
              </span>
            ) : (
              <span className="text-[11px] text-zinc-400">
                Due {fmtDateShort(job.target)}
              </span>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

// ── Mobile dispatch card ─────────────────────────────────────────────────────

function DispatchCard({ job, risk, score, stale }) {
  const phase = cleanPhase(job.phase, job.status)
  const next  = nextActionFor(job)
  const tDays = daysUntil(job.target)
  const accent =
    risk?.level === 'critical' ? '#ef4444' :
    risk?.level === 'warning'  ? '#eab308' :
    null

  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
      style={accent ? { borderLeftWidth: 3, borderLeftColor: accent } : undefined}
    >
      <header className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400">
            {job.id}
          </span>
          <p className="text-base font-bold text-white mt-1.5 truncate">{jobLabel(job)}</p>
          <p className="text-[11px] text-zinc-400 truncate">
            {jobBuilder(job)}{job.address ? ` · ${job.address}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {score >= 30 && (
            <Pill tone={score >= 80 ? 'critical' : score >= 60 ? 'brand' : 'warning'} size="xs">
              <span className="tabular-nums">{score}</span>
            </Pill>
          )}
          <RiskPill risk={risk} />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] mt-3">
        <div>
          <p className="text-zinc-400 uppercase tracking-wide text-[10px] mb-0.5">PM</p>
          <p className="font-semibold text-zinc-100 truncate">{job.pm || 'Unassigned'}</p>
          {job.lead && (
            <p className="text-zinc-400 text-[10px] truncate">Lead: {job.lead}</p>
          )}
        </div>
        <div>
          <p className="text-zinc-400 uppercase tracking-wide text-[10px] mb-0.5">Phase</p>
          <p className="font-semibold text-zinc-100 truncate">{phase}</p>
          <div className="mt-1"><StatusPill status={job.status} /></div>
        </div>
        <div>
          <p className="text-zinc-400 uppercase tracking-wide text-[10px] mb-0.5">Inspection</p>
          <InspectionPills job={job} />
        </div>
        <div>
          <p className="text-zinc-400 uppercase tracking-wide text-[10px] mb-0.5">Updated</p>
          <p className={stale !== null && stale >= 7 ? 'font-semibold text-red-400' : 'font-semibold text-zinc-100'}>
            {fmtDaysAgo(job.lastStatusChange || job.start)}
          </p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-white/5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">Next action</p>
        <p
          className="text-sm font-semibold leading-snug"
          style={{ color: accent || O }}
        >
          {next}
        </p>
        {risk?.reason && (
          <p className="text-[11px] text-zinc-400 mt-1">{risk.reason}</p>
        )}
        <div className="flex items-center justify-between mt-2">
          <ZoneTag job={job} />
          {tDays !== null && (
            tDays < 0 ? (
              <span className="text-[11px] font-semibold" style={{ color: '#ef4444' }}>
                {Math.abs(tDays)}d overdue
              </span>
            ) : tDays <= 7 ? (
              <span className="text-[11px] font-semibold" style={{ color: '#eab308' }}>
                Due in {tDays}d
              </span>
            ) : (
              <span className="text-[11px] text-zinc-400">
                Due {fmtDateShort(job.target)}
              </span>
            )
          )}
        </div>
      </div>
    </article>
  )
}
