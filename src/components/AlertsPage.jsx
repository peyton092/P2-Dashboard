import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import { generateAlerts, ALERT_TYPE_LABEL } from '../agent/alerts'
import { updateAgentAlert, addAgentAlert } from '../hooks/useFirestore'
import { ZONES } from '../agent/zones'
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
  AlertTriangleIcon, AlertCircleIcon, InfoIcon,
  CheckCircleIcon, CheckIcon, XIcon,
  ClockIcon, BellOffIcon, RefreshCwIcon,
  TimerIcon, ReceiptIcon, BadgeCheckIcon,
  MapPinIcon, UserRoundCogIcon, ActivityIcon,
} from 'lucide-react'

const O = '#F47920'

// Severity → Phase 1 palette tone + sort weight (lowest = surfaced first)
const SEVERITY = {
  critical: { tone: 'critical', label: 'Critical', sort: 0 },
  warning:  { tone: 'warning',  label: 'Warning',  sort: 1 },
  info:     { tone: 'info',     label: 'Info',     sort: 2 },
}

// Tone → fg color for the recommendation/next-action microcopy line.
const TONE_COLOR = {
  critical: '#ef4444',
  warning:  '#eab308',
  brand:    O,
  success:  '#22c55e',
  info:     '#3b82f6',
  mute:     '#9ca3af',
}

// ── Categorisation ───────────────────────────────────────────────────────────
//
// Maps the raw `alert.type` keys to a higher-level operational bucket. Used
// for filter chips and for the category Pill on each card. Pure derivation;
// no schema change.

function categoryFor(alert) {
  if (alert.type === 'inspection_failed') return 'inspection'
  if (alert.type === 'hvac_blocked')      return 'inspection'
  if (alert.type === 'billing_ready')     return 'billing'
  if (alert.type === 'pm_overload')       return 'pm'
  if (alert.type === 'no_next_action')    return 'needs-action'
  if (alert.type === 'zone_batch')        return 'field'
  if (alert.type === 'stalled')           return 'aging'
  return 'other'
}

const CATEGORY_LABEL = {
  inspection:     'Inspection issue',
  billing:        'Billing blocker',
  pm:             'PM overload',
  'needs-action': 'Needs action',
  field:          'Field plan',
  aging:          'Aging job',
  other:          'Alert',
}
const CATEGORY_ICON = {
  inspection:     BadgeCheckIcon,
  billing:        ReceiptIcon,
  pm:             UserRoundCogIcon,
  'needs-action': AlertCircleIcon,
  field:          MapPinIcon,
  aging:          TimerIcon,
  other:          AlertTriangleIcon,
}

// ── Time helpers ─────────────────────────────────────────────────────────────
//
// Firestore timestamps come through as `{ seconds, nanoseconds }`; client-
// generated alerts are ISO strings or undefined. These helpers normalise
// both so the rest of the file doesn't have to think about it.

function timestampMs(value) {
  if (!value) return null
  if (value.seconds) return value.seconds * 1000
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return isNaN(ms) ? null : ms
  }
  return null
}

function ageDays(alert) {
  const ms = timestampMs(alert.createdAt)
  if (ms === null) return 0
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000))
}

function fmtTs(value) {
  const ms = timestampMs(value)
  if (ms === null) return ''
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function isToday(value) {
  const ms = timestampMs(value)
  if (ms === null) return false
  const d = new Date(ms)
  const n = new Date()
  return d.getFullYear() === n.getFullYear()
      && d.getMonth() === n.getMonth()
      && d.getDate() === n.getDate()
}

function ageLabel(d) {
  if (d <= 0) return 'today'
  if (d === 1) return '1d old'
  return `${d}d old`
}

// ── Filter buckets ───────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'critical',     label: 'Critical' },
  { id: 'needs-action', label: 'Needs action' },
  { id: 'aging',        label: 'Aging' },
  { id: 'billing',      label: 'Billing' },
  { id: 'inspection',   label: 'Inspection' },
  { id: 'resolved',     label: 'Resolved' },
]

function alertMatchesFilter(a, filter) {
  const isOpen = a.status === 'open' || a.status === 'snoozed'
  if (filter === 'all')          return a.status !== 'dismissed'
  if (filter === 'critical')     return isOpen && a.severity === 'critical'
  if (filter === 'needs-action') return isOpen && (a.severity === 'critical' || a.severity === 'warning')
  if (filter === 'aging')        return isOpen && ageDays(a) >= 3
  if (filter === 'billing')      return isOpen && categoryFor(a) === 'billing'
  if (filter === 'inspection')   return isOpen && categoryFor(a) === 'inspection'
  if (filter === 'resolved')     return a.status === 'resolved'
  return true
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { jobs = [], extras = [], agentAlerts = [], loading } = useData()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [rescanning, setRescanning] = useState(false)

  // Merge Firestore alerts + client-generated alerts. Firestore is
  // authoritative for lifecycle; client-only alerts are added with
  // status='open' so they show up immediately.
  const merged = useMemo(() => {
    const client = generateAlerts(jobs, extras)
    const fsIds  = new Set(agentAlerts.map(a => a.id))
    const result = [...agentAlerts]
    for (const ca of client) {
      if (!fsIds.has(ca.id)) result.push({ ...ca, status: 'open' })
    }
    return result
  }, [agentAlerts, jobs, extras])

  // KPI counts — derived from merged (NOT filtered) so they reflect the
  // whole queue regardless of which filter chip is active.
  const kpis = useMemo(() => {
    const open      = merged.filter(a => a.status === 'open' || a.status === 'snoozed')
    const critical  = open.filter(a => a.severity === 'critical')
    const needsAct  = open.filter(a => a.severity === 'critical' || a.severity === 'warning')
    const aging     = open.filter(a => ageDays(a) >= 3)
    const resolvedToday = merged.filter(a =>
      a.status === 'resolved' && isToday(a.resolvedAt || a.updatedAt),
    )
    return {
      total:         open.length,
      critical:      critical.length,
      needsAction:   needsAct.length,
      aging:         aging.length,
      resolvedToday: resolvedToday.length,
    }
  }, [merged])

  // Filter + search + sort. Critical first, then aging-first within each
  // severity bucket — loudest signals get top placement.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return merged
      .filter(a => alertMatchesFilter(a, filter))
      .filter(a => {
        if (!q) return true
        return (a.title       || '').toLowerCase().includes(q)
            || (a.description || '').toLowerCase().includes(q)
            || (a.pm          || '').toLowerCase().includes(q)
            || (a.jobName     || '').toLowerCase().includes(q)
            || (a.jobId       || '').toLowerCase().includes(q)
      })
      .sort((a, b) => {
        const sa = SEVERITY[a.severity]?.sort ?? 9
        const sb = SEVERITY[b.severity]?.sort ?? 9
        if (sa !== sb) return sa - sb
        return ageDays(b) - ageDays(a)
      })
  }, [merged, filter, search])

  // Group by severity for visual stacking. `visible` is already age-sorted
  // within severity, so we just slice.
  const grouped = useMemo(() => ({
    critical: visible.filter(a => a.severity === 'critical'),
    warning:  visible.filter(a => a.severity === 'warning'),
    info:     visible.filter(a => a.severity === 'info'),
  }), [visible])

  const chipCounts = useMemo(() => {
    const out = {}
    FILTERS.forEach(f => { out[f.id] = merged.filter(a => alertMatchesFilter(a, f.id)).length })
    return out
  }, [merged])

  const filterChips = FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || search.trim() !== ''

  // ── Lifecycle mutations (preserved verbatim from prior implementation) ────
  async function applyAction(alert, newStatus, extra = {}) {
    const patch = { status: newStatus, ...extra }
    if (alert._docId) {
      await updateAgentAlert(alert._docId, patch)
    } else {
      await addAgentAlert({ ...alert, ...patch })
    }
  }
  function handleResolve(alert) {
    applyAction(alert, 'resolved', { resolvedAt: new Date().toISOString() })
  }
  function handleSnooze(alert) {
    applyAction(alert, 'snoozed', { snoozeUntil: new Date(Date.now() + 86400000).toISOString() })
  }
  function handleDismiss(alert) {
    applyAction(alert, 'dismissed')
  }

  async function handleRescan() {
    setRescanning(true)
    try {
      const fresh = generateAlerts(jobs, extras)
      await Promise.all(fresh.map(a => addAgentAlert({ ...a, status: a.status || 'open' })))
    } finally {
      setRescanning(false)
    }
  }

  // ── Loading branch ─────────────────────────────────────────────────────────
  if (loading && merged.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Alerts"
          title="Action queue"
          subtitle="Loading agent alerts…"
        />
        <LoadingState label="Loading alerts…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Alerts"
        title="Action queue"
        subtitle="What needs attention now, what is aging, and who owns it."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.total} open · {kpis.critical} critical</span>
            {kpis.aging > 0 && (
              <span className="text-amber-300">{kpis.aging} aging 3+ days</span>
            )}
          </>
        }
        actions={
          <button
            type="button"
            onClick={handleRescan}
            disabled={rescanning}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 disabled:opacity-60 disabled:cursor-wait transition-colors"
          >
            <RefreshCwIcon size={13} className={rescanning ? 'animate-spin' : ''} />
            {rescanning ? 'Scanning…' : 'Re-scan jobs'}
          </button>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Alert pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Critical Alerts"
          value={kpis.critical}
          Icon={AlertCircleIcon}
          emphasis={kpis.critical > 0 ? 'critical' : 'success'}
          sub={kpis.critical > 0 ? 'Resolve today' : 'No critical alerts'}
        />
        <MetricTile
          label="Needs Action"
          value={kpis.needsAction}
          Icon={AlertTriangleIcon}
          emphasis={kpis.needsAction > 0 ? 'warning' : 'success'}
          sub={kpis.needsAction > 0 ? 'Critical + warning' : 'Nothing pending'}
        />
        <MetricTile
          label="Aging Alerts"
          value={kpis.aging}
          Icon={TimerIcon}
          emphasis={kpis.aging > 0 ? 'critical' : 'success'}
          sub={kpis.aging > 0 ? '3+ days open' : 'No stale alerts'}
        />
        <MetricTile
          label="Resolved Today"
          value={kpis.resolvedToday}
          Icon={CheckCircleIcon}
          emphasis={kpis.resolvedToday > 0 ? 'success' : 'mute'}
          sub={kpis.resolvedToday > 0 ? 'Closed in last 24h' : 'None resolved yet'}
        />
        <MetricTile
          label="Total Open"
          value={kpis.total}
          Icon={ActivityIcon}
          emphasis={kpis.total > 0 ? 'default' : 'success'}
          sub={`${merged.length} ever`}
        />
      </section>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search alert, job, PM…"
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

      {/* Alert queue */}
      {visible.length === 0 ? (
        <DataPanel
          title="Alert Queue"
          description="No alerts match the current filters."
          Icon={AlertTriangleIcon}
        >
          <AlertsEmptyState filter={filter} hasSearch={Boolean(search.trim())} />
        </DataPanel>
      ) : (
        <div className="space-y-5">
          {grouped.critical.length > 0 && (
            <AlertGroup
              title="Critical"
              tone="critical"
              alerts={grouped.critical}
              onResolve={handleResolve}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
            />
          )}
          {grouped.warning.length > 0 && (
            <AlertGroup
              title="Warning"
              tone="warning"
              alerts={grouped.warning}
              onResolve={handleResolve}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
            />
          )}
          {grouped.info.length > 0 && (
            <AlertGroup
              title="Info"
              tone="info"
              alerts={grouped.info}
              onResolve={handleResolve}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function AlertsEmptyState({ filter, hasSearch }) {
  if (hasSearch) {
    return (
      <EmptyState
        Icon={AlertTriangleIcon}
        title="No alerts match"
        description="Adjust the search above or clear filters to see the full queue."
      />
    )
  }
  if (filter === 'critical') {
    return <AllClearState title="No critical alerts" description="Nothing requires action today." />
  }
  if (filter === 'needs-action') {
    return <AllClearState title="No alerts requiring action" description="Critical and warning queues are empty." />
  }
  if (filter === 'aging') {
    return <AllClearState title="No aging alerts" description="No alerts have been open for 3 or more days." />
  }
  if (filter === 'billing') {
    return <AllClearState title="No billing alerts" description="No billing-ready or billing-blocker alerts." />
  }
  if (filter === 'inspection') {
    return <AllClearState title="No inspection alerts" description="No failed inspections or HVAC blockers." />
  }
  if (filter === 'resolved') {
    return <EmptyState title="No resolved alerts yet" description="Alerts you mark resolved will appear here." />
  }
  return <AllClearState title="All clear" description="No alerts in the queue." />
}

function AlertGroup({ title, tone, alerts, onResolve, onSnooze, onDismiss }) {
  const Icon = tone === 'critical' ? AlertCircleIcon
             : tone === 'warning'  ? AlertTriangleIcon
             : InfoIcon
  return (
    <DataPanel
      title={title}
      description={`${alerts.length} alert${alerts.length === 1 ? '' : 's'}`}
      Icon={Icon}
      badge={<Pill tone={tone} size="xs">{alerts.length}</Pill>}
      padding="none"
    >
      <ul className="divide-y divide-white/5">
        {alerts.map(a => (
          <li key={a._docId || a.id}>
            <AlertCard
              alert={a}
              onResolve={onResolve}
              onSnooze={onSnooze}
              onDismiss={onDismiss}
            />
          </li>
        ))}
      </ul>
    </DataPanel>
  )
}

function AlertCard({ alert, onResolve, onSnooze, onDismiss }) {
  const sev      = SEVERITY[alert.severity] || SEVERITY.info
  const cat      = categoryFor(alert)
  const CatIcon  = CATEGORY_ICON[cat] || AlertTriangleIcon
  const zoneName = alert.zoneId ? (ZONES[alert.zoneId]?.name || alert.zoneId) : null
  const isResolved = alert.status === 'resolved'
  const isSnoozed  = alert.status === 'snoozed'
  const age       = ageDays(alert)
  const sevColor  = TONE_COLOR[sev.tone]

  const statusInfo = isResolved
    ? { tone: 'success',  label: 'Resolved' }
    : isSnoozed
      ? { tone: 'warning',  label: 'Snoozed' }
      : age >= 3
        ? { tone: 'critical', label: 'Aging' }
        : { tone: 'mute',     label: 'Open' }

  return (
    <div
      className="px-4 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-white/[0.015]"
      style={{
        borderLeft: `3px solid ${sevColor}`,
        opacity: isResolved ? 0.7 : 1,
      }}
    >
      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <Pill tone={sev.tone} size="xs">{sev.label}</Pill>
        <Pill tone="neutral" size="xs" Icon={CatIcon}>
          {CATEGORY_LABEL[cat] || ALERT_TYPE_LABEL[alert.type] || 'Alert'}
        </Pill>
        {alert.pm && (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
            <UserRoundCogIcon size={10} />
            {alert.pm}
          </span>
        )}
        {zoneName && (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
            <MapPinIcon size={10} />
            {zoneName}
          </span>
        )}
        <span className="text-[10px] text-zinc-500">·</span>
        <span className={`text-[10px] ${age >= 3 ? 'text-amber-300 font-semibold' : 'text-zinc-400'}`}>
          {ageLabel(age)}
        </span>
        <Pill tone={statusInfo.tone} size="xs" className="ml-auto">
          {statusInfo.label}
        </Pill>
      </div>

      {/* Title + job pill */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-1">
        <p className="text-sm font-semibold text-white leading-snug">{alert.title}</p>
        {alert.jobId && (
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {alert.jobId}
          </span>
        )}
      </div>

      {/* Description */}
      {alert.description && (
        <p className="text-[12px] text-zinc-300 leading-snug mb-1.5">
          {alert.description}
        </p>
      )}

      {/* Recommendation = next action */}
      {alert.recommendation && (
        <div className="flex items-start gap-1.5 mb-2">
          <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-0.5">Next</span>
          <p
            className="text-[12px] font-semibold leading-snug"
            style={{ color: sevColor }}
          >
            {alert.recommendation}
          </p>
        </div>
      )}

      {/* Resolved / snoozed marker */}
      {isResolved && alert.resolvedAt && (
        <p className="text-[11px] text-emerald-400 inline-flex items-center gap-1 mb-2">
          <CheckCircleIcon size={11} /> Resolved {fmtTs(alert.resolvedAt)}
        </p>
      )}
      {isSnoozed && alert.snoozeUntil && (
        <p className="text-[11px] text-amber-300 inline-flex items-center gap-1 mb-2">
          <ClockIcon size={11} /> Snoozed until {fmtTs(alert.snoozeUntil)}
        </p>
      )}

      {/* Actions */}
      {!isResolved && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => onResolve(alert)}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-md text-white transition-colors"
            style={{ backgroundColor: '#22c55e' }}
          >
            <CheckIcon size={12} /> Resolve alert
          </button>
          {!isSnoozed && (
            <button
              type="button"
              onClick={() => onSnooze(alert)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              <BellOffIcon size={12} /> Snooze 24h
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(alert)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
          >
            <XIcon size={12} /> Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
