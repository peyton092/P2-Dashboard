import { useMemo } from 'react'
import { useData } from '../DataContext'
import { updateJob, passInspection, failInspection } from '../hooks/useFirestore'
import { useStickyState } from '../lib/useStickyState'
import {
  PageHeader, MetricTile, DataPanel, Pill, LiveDot,
  EmptyState, AllClearState, FilterBar, SavedViewSelect,
} from './shared'
import {
  INSP_STATUSES, TRADE_META, PHASE_LABEL,
  inspectionStatusTone, inspectionStatusLabel, inspJobStatusTone,
} from '../lib/inspections'
import { jobName } from '../lib/jobs'
import { STATUS_COLORS } from './shared'

// Replaces the legacy iMeta(): same shape (color + label) but pulls color
// from the canonical STATUS_COLORS map and label from lib/inspections.
const INSP_COLOR = {
  passed:                 STATUS_COLORS.success,
  failed:                 STATUS_COLORS.critical,
  scheduled:              STATUS_COLORS.warning,
  pending:                STATUS_COLORS.mute,
  'pending-verification': STATUS_COLORS.mute,
  blocked:                STATUS_COLORS.info,
  'n/a':                  STATUS_COLORS.mute,
  'not-started':          STATUS_COLORS.neutral,
}
const iMeta = (s) => ({ color: INSP_COLOR[s] || STATUS_COLORS.neutral, label: (s || '').toUpperCase() })
import {
  AlertCircleIcon, AlertTriangleIcon, BadgeCheckIcon, CheckCircleIcon,
  CheckIcon, ClockIcon, TriangleAlertIcon,
} from 'lucide-react'

const O = '#F47920'

const TODAY = new Date()
const _yd = new Date(TODAY); _yd.setDate(_yd.getDate() - 1)
const YESTERDAY_STR = _yd.toISOString().slice(0, 10)

// ── Tab: Inspections ──────────────────────────────────────────────────────────

// INSP_STATUSES, TRADE_META, PHASE_LABEL, inspection* helpers moved to
// src/lib/inspections.js (Phase 18).

function PhaseRow({ label, status, note, docId, field }) {
  const canEdit = !!docId
  const [, trade, phase] = field ? field.split('.') : []
  const meta = iMeta(status)
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 gap-2">
      <span className="text-sm text-zinc-300 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {note && (
          <span className="text-[11px] text-red-400 max-w-[160px] truncate" title={note}>
            {note}
          </span>
        )}
        {canEdit ? (
          <>
            <select
              value={status || 'pending'}
              onChange={e => updateJob(docId, { [field]: e.target.value })}
              className="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer appearance-none"
              style={{
                color: meta.color,
                backgroundColor: meta.color + '22',
                border: `1px solid ${meta.color}44`,
              }}
              aria-label={`Update ${label} status`}
            >
              {INSP_STATUSES.map(s => (
                <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>
                  {inspectionStatusLabel(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => passInspection(docId, trade, phase)}
              title="Mark passed"
              aria-label={`Mark ${label} passed`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}
            >
              <CheckIcon size={13} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => failInspection(docId, trade, phase)}
              title="Mark failed"
              aria-label={`Mark ${label} failed`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}
            >
              <XIcon size={13} strokeWidth={2.5} />
            </button>
          </>
        ) : (
          <Pill tone={inspectionStatusTone(status)} size="xs">
            {inspectionStatusLabel(status)}
          </Pill>
        )}
      </div>
    </div>
  )
}

export default function Inspections() {
  const { jobs = [], dailyReports = [] } = useData()
  const [filter, setFilter] = useStickyState('inspections.filter', 'all')
  const [tradeFilter, setTradeFilter] = useStickyState('inspections.trade', 'all')
  const [search, setSearch] = useStickyState('inspections.search', '')

  const activeJobs = useMemo(
    () => jobs.filter(j => !['complete', 'completed'].includes(j.status)),
    [jobs],
  )

  // Per-job inspection signal — phase rollups + readiness gate.
  const enriched = useMemo(() => activeJobs.map(j => {
    const insp = j.insp || {}
    const phases = []
    Object.entries(TRADE_META).forEach(([trade, meta]) => {
      meta.phases.forEach(phase => {
        const status = insp[trade]?.[phase]
        if (status === 'n/a') return
        phases.push({ trade, phase, status: status || 'pending' })
      })
    })

    const failed    = phases.some(p => p.status === 'failed')
    const blocked   = phases.some(p => p.status === 'blocked')
    const scheduled = phases.some(p => p.status === 'scheduled')
    const allPassed = phases.length > 0 && phases.every(p => p.status === 'passed')

    // Readiness gate — mirrors the original 4-check logic.
    const crewReport = (dailyReports || []).some(r => r.date === YESTERDAY_STR && r.jobId === j.id)
    const photosOk   = (j.photoCount || 0) >= 3
    const phaseOk    = ['passed', 'finaled'].some(s =>
      [j.insp?.electrical?.roughIn, j.insp?.plumbing?.roughIn, j.insp?.hvac?.roughIn].includes(s),
    )
    const camOk      = j.companyCamUpdated || false
    const ready      = crewReport && photosOk && phaseOk && camOk

    return {
      job: j,
      phases,
      failed,
      blocked,
      scheduled,
      allPassed,
      ready,
      gate: { crewReport, photosOk, phaseOk, camOk },
    }
  }), [activeJobs, dailyReports])

  // KPI counts — aggregated across active jobs.
  const kpis = useMemo(() => {
    let phasesPassed = 0, phasesFailed = 0, phasesScheduled = 0
    enriched.forEach(e => {
      e.phases.forEach(p => {
        if      (p.status === 'passed')    phasesPassed    += 1
        else if (p.status === 'failed')    phasesFailed    += 1
        else if (p.status === 'scheduled') phasesScheduled += 1
      })
    })
    return {
      ready:     enriched.filter(e => e.ready).length,
      scheduled: phasesScheduled,
      passed:    phasesPassed,
      failed:    phasesFailed,
      rework:    enriched.filter(e => e.failed || e.blocked).length,
    }
  }, [enriched])

  // Filter chip counts (computed against unfiltered list).
  const chipCounts = useMemo(() => ({
    all:       enriched.length,
    ready:     enriched.filter(e => e.ready).length,
    scheduled: enriched.filter(e => e.scheduled).length,
    passed:    enriched.filter(e => e.allPassed).length,
    failed:    enriched.filter(e => e.failed).length,
    rework:    enriched.filter(e => e.failed || e.blocked).length,
  }), [enriched])

  // Apply filter + trade + search; sort: failed → blocked → scheduled → ready → other.
  const filtered = useMemo(() => {
    let list = enriched
    if      (filter === 'ready')     list = list.filter(e => e.ready)
    else if (filter === 'scheduled') list = list.filter(e => e.scheduled)
    else if (filter === 'passed')    list = list.filter(e => e.allPassed)
    else if (filter === 'failed')    list = list.filter(e => e.failed)
    else if (filter === 'rework')    list = list.filter(e => e.failed || e.blocked)

    if (tradeFilter !== 'all') {
      list = list.filter(e => e.phases.some(p => p.trade === tradeFilter))
    }

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(({ job: j }) =>
        (j.id || '').toLowerCase().includes(q) ||
        (j.name || '').toLowerCase().includes(q) ||
        (j.client || '').toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q) ||
        (j.pm || '').toLowerCase().includes(q),
      )
    }

    return list.slice().sort((a, b) => {
      const order = e => e.failed ? 0 : e.blocked ? 1 : e.scheduled ? 2 : e.ready ? 3 : 4
      const o = order(a) - order(b)
      if (o !== 0) return o
      return jobName(a.job).localeCompare(jobName(b.job))
    })
  }, [enriched, filter, tradeFilter, search])

  const FILTERS = [
    { id: 'all',       label: 'All' },
    { id: 'ready',     label: 'Ready' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'passed',    label: 'Passed' },
    { id: 'failed',    label: 'Failed' },
    { id: 'rework',    label: 'Rework' },
  ]
  const filterChips = FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))
  const hasActiveFilters = filter !== 'all' || tradeFilter !== 'all' || search.trim() !== ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inspections"
        title="Inspection readiness & resolution"
        subtitle="Across active jobs. Surface ready-to-call, scheduled, and rework needed."
        meta={
          <>
            <LiveDot />
            <span>{activeJobs.length} active jobs</span>
            {kpis.failed > 0 && (
              <span className="text-red-300">
                {kpis.failed} failed phase{kpis.failed === 1 ? '' : 's'}
              </span>
            )}
          </>
        }
      />

      {/* SOP reminder */}
      <DataPanel
        title="Inspection protocol"
        Icon={AlertTriangleIcon}
        badge={<Pill tone="warning" size="xs">SOP</Pill>}
      >
        <p className="text-xs text-zinc-300 leading-relaxed">
          Sequence: <span className="font-semibold text-white">Rough-In → Trim</span> (electrical only) <span className="font-semibold text-white">→ Final</span>. Call inspection only after the readiness gate is green: crew report submitted, min 3 photos uploaded, phase work confirmed, CompanyCam updated. <span className="font-semibold text-red-300">HVAC rough-in failure blocks the final</span> — do not schedule final until rough-in passes.
        </p>
      </DataPanel>

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Inspection pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Ready for Inspection"
          value={kpis.ready}
          Icon={BadgeCheckIcon}
          emphasis={kpis.ready > 0 ? 'success' : 'mute'}
          sub={kpis.ready > 0 ? 'Gate passed — call in' : 'No jobs cleared yet'}
        />
        <MetricTile
          label="Scheduled"
          value={kpis.scheduled}
          Icon={ClockIcon}
          emphasis={kpis.scheduled > 0 ? 'warning' : 'mute'}
          sub={kpis.scheduled > 0 ? 'Inspector booked' : 'Nothing on the books'}
        />
        <MetricTile
          label="Passed"
          value={kpis.passed}
          Icon={CheckCircleIcon}
          emphasis={kpis.passed > 0 ? 'success' : 'mute'}
          sub={kpis.passed > 0 ? 'Phases cleared' : 'No passes yet'}
        />
        <MetricTile
          label="Failed"
          value={kpis.failed}
          Icon={AlertCircleIcon}
          emphasis={kpis.failed > 0 ? 'critical' : 'success'}
          sub={kpis.failed > 0 ? 'Rework required' : 'No failures'}
        />
        <MetricTile
          label="Rework Needed"
          value={kpis.rework}
          Icon={TriangleAlertIcon}
          emphasis={kpis.rework > 0 ? 'critical' : 'success'}
          sub={kpis.rework > 0 ? 'Failed or blocked jobs' : 'No rework on the board'}
        />
      </section>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, builder, address, PM…"
        chips={filterChips}
        trailing={
          <>
            <SavedViewSelect
              scope="inspections"
              currentPayload={{ filter, tradeFilter, search: search.trim() }}
              onApply={v => {
                setFilter(v.filter ?? 'all')
                setTradeFilter(v.tradeFilter ?? 'all')
                setSearch(v.search ?? '')
              }}
              savePrompt='Name this inspections view (e.g. "Scheduled HVAC")'
            />
            <select
              value={tradeFilter}
              onChange={e => setTradeFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30"
              aria-label="Filter by trade"
            >
              <option value="all">All trades</option>
              <option value="electrical">Electrical</option>
              <option value="plumbing">Plumbing</option>
              <option value="hvac">HVAC</option>
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setTradeFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Inspection queue */}
      {filtered.length === 0 ? (
        <DataPanel
          title="Inspection Queue"
          Icon={BadgeCheckIcon}
          description="No jobs match the current filters."
        >
          <InspectionsEmptyState filter={filter} hasSearch={Boolean(search.trim() || tradeFilter !== 'all')} />
        </DataPanel>
      ) : (
        <div className="space-y-4">
          {filtered.map(({ job: j, gate }) => (
            <InspectionJobCard
              key={j._docId || j.id}
              job={j}
              gate={gate}
              tradeFilter={tradeFilter}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function InspectionsEmptyState({ filter, hasSearch }) {
  if (hasSearch) {
    return <EmptyState Icon={BadgeCheckIcon} title="No jobs match" description="Adjust the search or clear filters to see the full queue." />
  }
  if (filter === 'ready')     return <AllClearState title="Nothing ready to call in" description="The readiness gate hasn't cleared on any active job yet." />
  if (filter === 'scheduled') return <EmptyState   title="No inspections scheduled" description="Mark a phase 'Scheduled' once an inspector is booked." />
  if (filter === 'passed')    return <EmptyState   title="No fully-passed jobs" description="Jobs with every phase passed will show here." />
  if (filter === 'failed')    return <AllClearState title="No failed inspections" description="No phases are currently in 'Failed' status." />
  if (filter === 'rework')    return <AllClearState title="No rework on the board" description="No failed or blocked phases on any active job." />
  return <AllClearState title="All inspections clear" description="No active inspection work to surface." />
}

function InspectionJobCard({ job: j, gate, tradeFilter }) {
  const visibleTrades = tradeFilter === 'all'
    ? ['electrical', 'plumbing', 'hvac']
    : [tradeFilter]
  const gridCls = visibleTrades.length === 1 ? '' : 'md:grid-cols-3'
  const checks = [
    { label: 'Crew report submitted',         ok: gate.crewReport },
    { label: 'Photos uploaded (min 3)',       ok: gate.photosOk   },
    { label: 'Phase work confirmed complete', ok: gate.phaseOk    },
    { label: 'CompanyCam updated',            ok: gate.camOk      },
  ]
  const allOk = checks.every(c => c.ok)
  const statusTone = inspJobStatusTone(j.status)
  const statusLabel = (j.status || 'active').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.025] overflow-hidden">
      {/* Header */}
      <header className="px-4 sm:px-5 py-3 border-b border-white/5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
                {j.id}
              </span>
              <span className="text-base font-bold text-white truncate">{jobName(j)}</span>
              <Pill tone={statusTone} size="xs">{statusLabel}</Pill>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1 truncate">
              {j.address || '—'}{j.pm ? ` · PM ${j.pm}` : ''}{j.lead ? ` · Lead ${j.lead}` : ''}
            </p>
          </div>
        </div>
      </header>

      {/* Trade columns */}
      <div className="p-4 sm:p-5">
        <div className={`grid gap-5 ${gridCls}`}>
          {visibleTrades.map(trade => {
            const meta = TRADE_META[trade]
            const subName = j.subs?.[trade] || (trade === 'plumbing' ? 'N/A' : '—')
            const phaseValues = meta.phases.map(p => j.insp?.[trade]?.[p])
            const passedCount = phaseValues.filter(s => s === 'passed').length
            const progressPct = meta.phases.length > 0
              ? Math.round((passedCount / meta.phases.length) * 100)
              : 0
            return (
              <div key={trade} className="min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <meta.Icon size={14} style={{ color: meta.color }} className="shrink-0" />
                  <p className="text-sm font-semibold text-white truncate">{meta.label}</p>
                  <span className="text-[10px] text-zinc-400 ml-auto shrink-0 truncate max-w-[140px]">
                    Sub: {subName}
                  </span>
                </div>
                {meta.phases.map(phase => (
                  <PhaseRow
                    key={phase}
                    label={PHASE_LABEL[phase]}
                    status={j.insp?.[trade]?.[phase]}
                    note={trade === 'electrical' && phase === 'trim' ? j.insp?.[trade]?.note : undefined}
                    docId={j._docId}
                    field={`insp.${trade}.${phase}`}
                  />
                ))}
                {trade === 'hvac' && j.insp?.hvac?.roughIn === 'failed' && (
                  <div
                    className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-md"
                    style={{ backgroundColor: '#3b82f60d', border: '1px solid #3b82f655' }}
                  >
                    <AlertCircleIcon size={12} color="#3b82f6" className="shrink-0" />
                    <span className="text-[11px] text-blue-300 leading-snug">
                      Final blocked — rough-in must pass first
                    </span>
                  </div>
                )}
                <div className="mt-2.5">
                  <ProgressBar value={progressPct} color={meta.color} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Readiness gate */}
        <div className="mt-5 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
              Inspection readiness gate
            </p>
            <Pill
              tone={allOk ? 'success' : 'critical'}
              size="xs"
              Icon={allOk ? CheckCircleIcon : AlertCircleIcon}
            >
              {allOk ? 'Ready to call in' : 'Not ready'}
            </Pill>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {checks.map(c => (
              <div
                key={c.label}
                className="flex items-center gap-2 px-2 py-2 rounded-lg"
                style={{
                  backgroundColor: c.ok ? '#22c55e0d' : '#ef44440d',
                  border: `1px solid ${c.ok ? '#22c55e22' : '#ef444422'}`,
                }}
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                  style={{ backgroundColor: c.ok ? '#22c55e22' : '#ef444422' }}
                >
                  {c.ok
                    ? <CheckIcon size={10} color="#22c55e" />
                    : <XIcon size={10} color="#ef4444" />}
                </div>
                <p className="text-[11px] leading-tight" style={{ color: c.ok ? '#22c55e' : '#ef4444' }}>
                  {c.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
