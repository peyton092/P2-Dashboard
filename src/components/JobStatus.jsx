import { useState, useMemo, memo, useCallback } from 'react'
import { useData } from '../DataContext'
import { createJob, updateJob } from '../hooks/useFirestore'
import { useToast } from '@/components/ui/toast'
import {
  PageHeader, MetricTile, DataPanel, Pill, LiveDot,
  EmptyState, AllClearState, FilterBar,
  ProgressBar,
  InspectionBadge,
  InlineStatusSelect, InlinePhaseSelect, BillingStatusSelect,
} from './shared'
import {
  JOB_FILTERS, JOB_FORM_INITIAL,
  isJobComplete, jobStaleness, jobMatchesFilter,
  jobNextAction, jobRiskMeta, fmtJobDate,
  jobName,
} from '../lib/jobs'
import { useSavedViews, saveView, deleteView } from '../lib/savedViews'
import { classifyRisk, hasFailedInspection, isBillingReady } from '../agent/scoring'
import { ZONES, getZoneId } from '../agent/zones'
import { exportToCsv } from '../lib/exportCsv'
import {
  ActivityIcon, AlertCircleIcon, BanIcon, CalendarIcon, CheckCircleIcon,
  ChevronRightIcon, DollarSignIcon, DownloadIcon, HardHatIcon, PlusIcon,
  TriangleAlertIcon, UsersIcon, CheckIcon, XIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const O = '#F47920'

// ── Tab: Job Status ───────────────────────────────────────────────────────────

// JOB_FILTERS, JOB_FORM_INITIAL, isJobComplete, jobStaleness,
// jobMatchesFilter, jobNextAction, jobRiskMeta, fmtJobDate moved to
// src/lib/jobs.js (Phase 18).

export default function JobStatus() {
  const { jobs = [], subs = [] } = useData()
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState('all')
  const [pmFilter, setPmFilter]     = useState('all')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [expanded, setExpanded]     = useState(null)
  const [showNewJob, setShowNewJob] = useState(false)
  const [jobForm, setJobForm]       = useState(JOB_FORM_INITIAL)
  const [creating, setCreating]     = useState(false)
  const [selected, setSelected]     = useState(() => new Set())
  const [bulkBusy, setBulkBusy]     = useState(false)
  const toast = useToast()
  const toggleSelected = useCallback((id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  const toggleExpanded = useCallback((id) => setExpanded(e => e === id ? null : id), [])

  // ── Derived ────────────────────────────────────────────────────────────────

  const enriched = useMemo(() => jobs.map(j => ({
    j,
    complete: isJobComplete(j),
    risk:     classifyRisk(j),
    stale:    jobStaleness(j),
    failed:   hasFailedInspection(j),
    billRdy:  isBillingReady(j),
    zoneId:   getZoneId(j),
  })), [jobs])

  const kpis = useMemo(() => {
    const active        = enriched.filter(e => !e.complete).length
    const completed     = enriched.filter(e => e.complete).length
    const atRisk        = enriched.filter(e => !e.complete && (
      e.risk?.level === 'critical' || e.risk?.level === 'warning' ||
      ['at-risk', 'needs-action', 'blocked', 'hold'].includes(e.j.status) ||
      e.failed
    )).length
    const needsAction   = enriched.filter(e => !e.complete && (e.j.status === 'needs-action' || e.failed)).length
    const blockedStale  = enriched.filter(e => !e.complete && (
      e.j.status === 'blocked' || e.j.status === 'hold' || e.failed ||
      (e.stale !== null && e.stale >= 7)
    )).length
    return { active, completed, atRisk, needsAction, blockedStale, total: enriched.length }
  }, [enriched])

  // Chip counts (computed against the unfiltered set so users see real depth).
  const chipCounts = useMemo(() => {
    const out = {}
    JOB_FILTERS.forEach(f => { out[f.id] = enriched.filter(e => jobMatchesFilter(e.j, f.id)).length })
    return out
  }, [enriched])

  // Apply chip + PM + zone + search; sort: at-risk first, then stale, then alpha.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched
      .filter(e => jobMatchesFilter(e.j, filter))
      .filter(e => pmFilter === 'all' || e.j.pm === pmFilter)
      .filter(e => zoneFilter === 'all' || e.zoneId === zoneFilter)
      .filter(e => {
        if (!q) return true
        return (e.j.id || '').toLowerCase().includes(q)
            || (e.j.address || '').toLowerCase().includes(q)
            || (e.j.client || '').toLowerCase().includes(q)
            || (e.j.name || '').toLowerCase().includes(q)
            || (e.j.pm || '').toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => {
        // Active before complete, then risk severity, then stale, then alpha.
        if (a.complete !== b.complete) return a.complete ? 1 : -1
        const rankRisk = e =>
          e.risk?.level === 'critical' ? 0 :
          e.risk?.level === 'warning'  ? 1 :
          e.failed                     ? 1 :
          e.j.status === 'blocked'     ? 1 :
          e.j.status === 'hold'        ? 2 : 3
        const r = rankRisk(a) - rankRisk(b)
        if (r !== 0) return r
        const aStale = a.stale ?? -1
        const bStale = b.stale ?? -1
        if (aStale !== bStale) return bStale - aStale
        return jobName(a.j).localeCompare(jobName(b.j))
      })
  }, [enriched, filter, pmFilter, zoneFilter, search])

  // PM list (only PMs that own at least one job in the data, sorted).
  const pmOptions = useMemo(() => {
    const set = new Set()
    jobs.forEach(j => { if (j.pm) set.add(j.pm) })
    return Array.from(set).sort()
  }, [jobs])

  const filterChips = JOB_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || pmFilter !== 'all' || zoneFilter !== 'all' || search.trim() !== ''

  // ── Saved views — persist the chip + PM + zone + search combo ──────────────
  const savedViews = useSavedViews('jobs')
  const viewNames = Object.keys(savedViews).sort()
  const currentSig = JSON.stringify({ filter, pmFilter, zoneFilter, search: search.trim() })
  const activeViewName = viewNames.find(n => JSON.stringify(savedViews[n]?.payload || {}) === currentSig) || ''
  const applyView = (name) => {
    const v = savedViews[name]?.payload
    if (!v) return
    setFilter(v.filter ?? 'all')
    setPmFilter(v.pmFilter ?? 'all')
    setZoneFilter(v.zoneFilter ?? 'all')
    setSearch(v.search ?? '')
  }
  const handleSaveView = () => {
    const name = window.prompt('Name this view (e.g. "My critical jobs")')
    if (!name) return
    saveView('jobs', name, { filter, pmFilter, zoneFilter, search: search.trim() })
  }
  const handleDeleteView = (name) => {
    if (window.confirm(`Delete saved view "${name}"?`)) deleteView('jobs', name)
  }

  // ── New-job mutation (preserved verbatim — same createJob payload shape) ──
  const elecSubs  = (subs || []).filter(s => s.trade === 'Electrical')
  const plumbSubs = (subs || []).filter(s => s.trade === 'Plumbing')
  const hvacSubs  = (subs || []).filter(s => s.trade === 'HVAC')

  const handleCreateJob = async () => {
    if (!jobForm.id || !jobForm.address || !jobForm.client) return
    setCreating(true)
    await createJob({
      id:           jobForm.id,
      address:      jobForm.address,
      city:         jobForm.city,
      client:       jobForm.client,
      type:         jobForm.type,
      pm:           jobForm.pm,
      status:       'active',
      progress:     0,
      extras:       0,
      tenantId:     'qbs',
      lead:         '',
      start:        new Date().toISOString().slice(0, 10),
      target:       jobForm.target || '',
      county:       '',
      billingStatus:'not-invoiced',
      permitNumber: jobForm.permitNumber || '',
      subs:    { electrical: jobForm.subElectrical || null, plumbing: jobForm.subPlumbing || null, hvac: jobForm.subHvac || null },
      permits: { electrical: 'pending', plumbing: 'pending', hvac: 'pending' },
      insp: {
        electrical: { roughIn: 'pending', trim: 'blocked', final: 'blocked' },
        plumbing:   { roughIn: 'pending', final: 'blocked' },
        hvac:       { roughIn: 'pending', final: 'blocked' },
      },
    })
    setJobForm(JOB_FORM_INITIAL)
    setShowNewJob(false)
    setCreating(false)
  }

  const exportVisibleCsv = () => {
    exportToCsv('p2-jobs', [
      { label: 'Job ID',    key: 'id' },
      { label: 'Name',      get: e => jobName(e.j) },
      { label: 'Client',    get: e => e.j.client || '' },
      { label: 'Address',   get: e => e.j.address || '' },
      { label: 'City',      get: e => e.j.city || '' },
      { label: 'PM',        get: e => e.j.pm || '' },
      { label: 'Status',    get: e => e.j.status || '' },
      { label: 'Phase',     get: e => e.j.phase || '' },
      { label: 'Progress',  get: e => `${e.j.progress ?? 0}%` },
      { label: 'Target',    get: e => e.j.target || '' },
      { label: 'Billing',   get: e => e.j.billingStatus || '' },
      { label: 'Permit #',  get: e => e.j.permitNumber || '' },
      { label: 'At Risk',   get: e => (e.risk?.level === 'critical' || e.risk?.level === 'warning' || e.failed) ? 'yes' : 'no' },
    ], visible)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Job Status"
        title="Portfolio status"
        subtitle="Active and completed jobs across the portfolio — risk, phase, ownership, next action."
        meta={
          <>
            <LiveDot />
            <span>{kpis.active} active · {kpis.completed} complete</span>
            {kpis.atRisk > 0 && (
              <span className="text-amber-300">{kpis.atRisk} at risk</span>
            )}
            <span>Middle Tennessee</span>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportVisibleCsv()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              <DownloadIcon size={13} /> Export CSV
            </button>
            <button
              type="button"
              onClick={() => { setShowNewJob(v => !v); if (!showNewJob) setJobForm(JOB_FORM_INITIAL) }}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
              style={{ backgroundColor: O }}
            >
              <PlusIcon size={13} /> New job
            </button>
          </div>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Portfolio status"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Active Jobs"
          value={kpis.active}
          Icon={ActivityIcon}
          sub={`${kpis.total} on roster`}
        />
        <MetricTile
          label="Completed"
          value={kpis.completed}
          Icon={CheckCircleIcon}
          emphasis={kpis.completed > 0 ? 'success' : 'mute'}
          sub={kpis.completed > 0 ? 'Lifetime closeouts' : 'No closeouts yet'}
        />
        <MetricTile
          label="At-Risk Jobs"
          value={kpis.atRisk}
          Icon={TriangleAlertIcon}
          emphasis={kpis.atRisk > 0 ? 'critical' : 'success'}
          sub={kpis.atRisk > 0 ? 'Warning + critical' : 'All active jobs are on track'}
        />
        <MetricTile
          label="Needs Action"
          value={kpis.needsAction}
          Icon={AlertCircleIcon}
          emphasis={kpis.needsAction > 0 ? 'warning' : 'success'}
          sub={kpis.needsAction > 0 ? 'Failed inspection or open' : 'Nothing pending'}
        />
        <MetricTile
          label="Blocked / Stale"
          value={kpis.blockedStale}
          Icon={BanIcon}
          emphasis={kpis.blockedStale > 0 ? 'critical' : 'success'}
          sub={kpis.blockedStale > 0 ? 'Blocked, on hold, or 7+ days stale' : 'No blockers'}
        />
      </section>

      {/* New-job form */}
      {showNewJob && (
        <DataPanel
          title="Create new job"
          description="Captures the job record, default permits, and inspection skeleton."
          Icon={PlusIcon}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <JobFormField label="Job ID *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="QBS-045" value={jobForm.id} onChange={e => setJobForm(f => ({ ...f, id: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Street address *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="123 Main St" value={jobForm.address} onChange={e => setJobForm(f => ({ ...f, address: e.target.value }))} />
            </JobFormField>
            <JobFormField label="City, state ZIP">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="Brentwood, TN 37027" value={jobForm.city} onChange={e => setJobForm(f => ({ ...f, city: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Client *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="Client name" value={jobForm.client} onChange={e => setJobForm(f => ({ ...f, client: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Project type">
              <Input className="bg-white/[0.04] border-white/10 text-white" value={jobForm.type} onChange={e => setJobForm(f => ({ ...f, type: e.target.value }))} />
            </JobFormField>
            <JobFormField label="PM">
              <Select value={jobForm.pm} onValueChange={v => setJobForm(f => ({ ...f, pm: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Blake Neblett','Brendan Embry','Jeb Brooks','Taylor Hensley','Tim King','Derek Powers'].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </JobFormField>
            <JobFormField label="Target date">
              <Input className="bg-white/[0.04] border-white/10 text-white" type="date" value={jobForm.target} onChange={e => setJobForm(f => ({ ...f, target: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Permit number">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="2026012345" value={jobForm.permitNumber} onChange={e => setJobForm(f => ({ ...f, permitNumber: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Electrical sub">
              <Select value={jobForm.subElectrical} onValueChange={v => setJobForm(f => ({ ...f, subElectrical: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {elecSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </JobFormField>
            <JobFormField label="Plumbing sub">
              <Select value={jobForm.subPlumbing} onValueChange={v => setJobForm(f => ({ ...f, subPlumbing: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {plumbSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </JobFormField>
            <JobFormField label="HVAC sub">
              <Select value={jobForm.subHvac} onValueChange={v => setJobForm(f => ({ ...f, subHvac: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {hvacSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </JobFormField>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              onClick={handleCreateJob}
              disabled={creating || !jobForm.id || !jobForm.address || !jobForm.client}
              className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: O }}
            >
              {creating ? 'Creating…' : 'Create job'}
            </button>
            <button
              type="button"
              onClick={() => { setShowNewJob(false); setJobForm(JOB_FORM_INITIAL) }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              Cancel
            </button>
          </div>
        </DataPanel>
      )}

      {/* Filters — chips + PM + zone + search + clear */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, client, address, PM…"
        chips={filterChips}
        trailing={
          <>
            <select
              value={activeViewName}
              onChange={e => { if (e.target.value === '__save__') handleSaveView(); else if (e.target.value) applyView(e.target.value) }}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Saved view"
            >
              <option value="">Saved view…</option>
              {viewNames.map(n => <option key={n} value={n}>{n}</option>)}
              <option value="__save__">＋ Save current as…</option>
            </select>
            {activeViewName && (
              <button
                type="button"
                onClick={() => handleDeleteView(activeViewName)}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-red-300 hover:border-red-400/40"
                title={`Delete saved view "${activeViewName}"`}
              >
                Delete view
              </button>
            )}
            <select
              value={pmFilter}
              onChange={e => setPmFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Filter by PM"
            >
              <option value="all">All PMs</option>
              {pmOptions.map(pm => <option key={pm} value={pm}>{pm}</option>)}
            </select>
            <select
              value={zoneFilter}
              onChange={e => setZoneFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Filter by zone"
            >
              <option value="all">All zones</option>
              {Object.values(ZONES).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setPmFilter('all'); setZoneFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Bulk-action bar — appears when one or more rows are selected. Uses
          the same updateJob mutation the inline selects use; a confirm
          prompt sits in front of destructive bulk changes. */}
      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          jobs={jobs}
          selected={selected}
          pmOptions={pmOptions}
          busy={bulkBusy}
          onApplyStatus={async (status) => {
            if (!window.confirm(`Set ${selected.size} job${selected.size === 1 ? '' : 's'} to status "${status}"?`)) return
            setBulkBusy(true)
            try {
              const targets = jobs.filter(j => selected.has(j.id) && j._docId)
              await Promise.all(targets.map(j => updateJob(j._docId, { status })))
              toast({ tone: 'success', title: `Updated ${targets.length} job${targets.length === 1 ? '' : 's'}` })
              clearSelection()
            } catch (err) {
              toast({ tone: 'error', title: 'Bulk update failed', description: err.message || 'Try again.' })
            } finally { setBulkBusy(false) }
          }}
          onApplyPM={async (pm) => {
            if (!window.confirm(`Assign ${selected.size} job${selected.size === 1 ? '' : 's'} to ${pm}?`)) return
            setBulkBusy(true)
            try {
              const targets = jobs.filter(j => selected.has(j.id) && j._docId)
              await Promise.all(targets.map(j => updateJob(j._docId, { pm })))
              toast({ tone: 'success', title: `Reassigned ${targets.length} job${targets.length === 1 ? '' : 's'} to ${pm}` })
              clearSelection()
            } catch (err) {
              toast({ tone: 'error', title: 'Bulk update failed', description: err.message || 'Try again.' })
            } finally { setBulkBusy(false) }
          }}
          onClear={clearSelection}
        />
      )}

      {/* Portfolio queue */}
      <DataPanel
        title="Portfolio"
        description={
          visible.length === 0
            ? 'No jobs match the current filters.'
            : `${visible.length} of ${enriched.length} job${enriched.length === 1 ? '' : 's'}`
        }
        Icon={HardHatIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <JobStatusEmptyState filter={filter} hasOtherFilters={pmFilter !== 'all' || zoneFilter !== 'all' || search.trim() !== ''} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(({ j, complete, risk, stale, failed, billRdy, zoneId }) => (
              <li key={j._docId || j.id}>
                <JobStatusRow
                  job={j}
                  complete={complete}
                  risk={risk}
                  stale={stale}
                  failed={failed}
                  billRdy={billRdy}
                  zone={ZONES[zoneId] || null}
                  expanded={expanded === j.id}
                  onToggle={toggleExpanded}
                  selected={selected.has(j.id)}
                  onToggleSelect={toggleSelected}
                />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function JobStatusEmptyState({ filter, hasOtherFilters }) {
  if (hasOtherFilters)            return <EmptyState   Icon={HardHatIcon} title="No jobs match" description="Try clearing the search, PM, or zone filter." />
  if (filter === 'at-risk')       return <AllClearState title="All active jobs are on track" description="No critical or warning-level risk on any active job." />
  if (filter === 'needs-action')  return <AllClearState title="No jobs need action" description="No failed inspections or jobs flagged 'needs action'." />
  if (filter === 'blocked')       return <AllClearState title="Nothing blocked" description="No jobs are blocked, on hold, or have failed inspections." />
  if (filter === 'stale')         return <AllClearState title="No stale jobs" description="No active jobs without a status update in 7+ days." />
  if (filter === 'complete')      return <EmptyState   title="No completed jobs yet" description="Closeouts will appear here." />
  return <EmptyState Icon={HardHatIcon} title="No jobs yet" description="Create the first job to populate the portfolio." />
}

const JobStatusRow = memo(function JobStatusRow({
  job, complete, risk, stale, failed, billRdy, zone,
  expanded, onToggle,
  selected = false, onToggleSelect,
}) {
  const riskMeta    = jobRiskMeta(job)
  const next        = jobNextAction(job)
  const railColor   = failed ? '#ef4444'
                    : (risk?.level === 'critical' ? '#ef4444'
                    : risk?.level === 'warning'  ? '#eab308'
                    : complete                   ? '#22c55e'
                    : '#3b82f6')
  const nextColor   = failed ? '#ef4444'
                    : (risk?.level === 'critical' ? '#ef4444'
                    : risk?.level === 'warning'  ? '#eab308'
                    : billRdy                    ? '#22c55e'
                    : O)
  const progress    = Math.max(0, Math.min(100, Number(job.progress) || 0))
  const progressMuted = complete || (risk?.level === 'critical')
  const handleKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button') && !e.target.closest('select') && !e.target.closest('[role="combobox"]')) {
      e.preventDefault()
      onToggle(job.id)
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('select')) return
          onToggle(job.id)
        }}
        onKeyDown={handleKey}
        className="px-4 py-4 sm:px-5 cursor-pointer transition-colors hover:bg-white/[0.025] focus:outline-none focus:bg-white/[0.04]"
        style={{ borderLeft: `3px solid ${railColor}` }}
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          {onToggleSelect && (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Select ${job.id}`}
              onClick={(e) => { e.stopPropagation(); onToggleSelect(job.id) }}
              className={cn(
                'shrink-0 mt-1 w-4 h-4 rounded border transition-colors flex items-center justify-center',
                selected
                  ? 'bg-orange-500/80 border-orange-400 text-white'
                  : 'bg-white/[0.04] border-white/20 text-transparent hover:border-white/40',
              )}
              style={selected ? { backgroundColor: O, borderColor: O } : undefined}
            >
              <CheckIcon size={11} strokeWidth={3} />
            </button>
          )}
          {/* Body */}
          <div className="flex-1 min-w-0">
            {/* Header row — id pill, name (clickable → JobDetail), status select, phase select */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: job.id } })) }}
                title="Open job detail"
                className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0 hover:bg-white/[0.12] hover:text-white transition-colors"
              >
                {job.id}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: job.id } })) }}
                title="Open job detail"
                className="text-base font-bold text-white truncate min-w-0 text-left hover:underline underline-offset-4 decoration-white/30"
              >
                {jobName(job)}
              </button>
              <InlineStatusSelect job={job} />
              <InlinePhaseSelect job={job} />
            </div>

            {/* Customer + address */}
            <p className="text-[11px] text-zinc-400 truncate">
              {job.client || '—'}{job.address ? ` · ${job.address}` : ''}
              {zone?.name ? ` · ${zone.name}` : ''}
            </p>

            {/* Meta row — PM, target, optional flags */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <UsersIcon size={11} /> PM <span className="text-zinc-200 font-semibold">{job.pm || '—'}</span>
              </span>
              {job.qbsPM && (
                <span className="inline-flex items-center gap-1">
                  <UsersIcon size={11} /> QBS {job.qbsPM}
                </span>
              )}
              {job.target && (
                <span className="inline-flex items-center gap-1">
                  <CalendarIcon size={11} /> Due {fmtJobDate(job.target)}
                </span>
              )}
              {stale !== null && stale >= 3 && !complete && (
                <span
                  className="font-semibold"
                  style={{ color: stale >= 7 ? '#ef4444' : '#eab308' }}
                >
                  {stale === 1 ? '1d since update' : `${stale}d since update`}
                </span>
              )}
              {riskMeta && <Pill tone={riskMeta.tone} size="xs">{riskMeta.label}</Pill>}
              {failed && <Pill tone="critical" size="xs" Icon={AlertCircleIcon}>Inspection issue</Pill>}
              {billRdy && !complete && <Pill tone="success" size="xs" Icon={DollarSignIcon}>Billing ready</Pill>}
            </div>

            {/* Next action */}
            <div className="flex items-start gap-1.5 mt-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-px">Next</span>
              <p
                className="text-[12px] font-semibold leading-snug min-w-0 truncate"
                style={{ color: nextColor }}
                title={next}
              >
                {next}
              </p>
            </div>

            {/* Mobile-only progress bar (the desktop block on the right hides at < sm) */}
            <div className="sm:hidden mt-3">
              <div className="flex items-center justify-between mb-1 text-[11px] text-zinc-400">
                <span className="truncate">{job.type || 'Project'}</span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: progressMuted ? '#9ca3af' : O }}
                >
                  {progress}%
                </span>
              </div>
              <ProgressBar value={progress} color={progressMuted ? '#9ca3af' : O} />
            </div>
          </div>

          {/* Desktop progress block */}
          <div className="hidden sm:flex flex-col items-end shrink-0 w-40">
            <p
              className="text-2xl font-semibold tabular-nums leading-none"
              style={{ color: progressMuted ? '#9ca3af' : O }}
            >
              {progress}%
            </p>
            <div className="w-full mt-1.5">
              <ProgressBar value={progress} color={progressMuted ? '#9ca3af' : O} />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5 truncate max-w-full" title={job.type}>
              {job.type || 'Project'}
            </p>
          </div>

          {/* Expand chevron */}
          <ChevronRightIcon
            size={16}
            className="hidden md:block shrink-0 text-zinc-400 mt-1 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        </div>
      </div>

      {expanded && <JobStatusDetail job={job} />}
    </div>
  )
})

function JobStatusDetail({ job }) {
  return (
    <div className="border-t border-white/5 bg-white/[0.015]">
      <div className="px-4 py-4 sm:px-5 sm:py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Subcontractors</p>
        {['electrical','plumbing','hvac'].some(t => job.subs?.[t]) ? (
          <ul className="space-y-1.5">
            {['electrical','plumbing','hvac'].map(t => job.subs?.[t] && (
              <li key={t} className="flex items-center justify-between text-[12px]">
                <span className="capitalize text-zinc-400">{t}</span>
                <span className="text-zinc-100 font-semibold truncate ml-2 max-w-[60%]">{job.subs[t]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-zinc-400">No subs assigned</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Permits</p>
        {['electrical','plumbing','hvac'].some(t => job.permits?.[t]) ? (
          <ul className="space-y-1.5">
            {['electrical','plumbing','hvac'].map(t => job.permits?.[t] && (
              <li key={t} className="flex items-center justify-between text-[12px]">
                <span className="capitalize text-zinc-400">{t}</span>
                <InspectionBadge status={job.permits[t]} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-zinc-400">No permits on file</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Invoice</p>
        <ul className="space-y-1.5 text-[12px]">
          <li className="flex justify-between gap-2">
            <span className="text-zinc-400">Invoice #</span>
            <span className="text-zinc-100 font-semibold truncate">{job.invoiceNum || '—'}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-zinc-400">Invoice date</span>
            <span className="text-zinc-100">{job.invoiceDate || '—'}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-zinc-400">QBS PM</span>
            <span className="text-zinc-100">{job.qbsPM || '—'}</span>
          </li>
          <li className="flex justify-between items-center gap-2 pt-2 border-t border-white/5 mt-1">
            <span className="text-zinc-400">Status</span>
            <BillingStatusSelect job={job} />
          </li>
        </ul>
      </div>
      </div>
      <div className="px-4 pb-4 sm:px-5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: job.id } }))}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white"
          style={{ backgroundColor: O }}
        >
          Open full view →
        </button>
      </div>
    </div>
  )
}

// Form-field wrapper used by the new-job panel — renders an uppercase label
// above the input control. Sibling to the Materials FormFieldLabel; kept
// separate so each phase's form helper stays self-contained.
function JobFormField({ label, children }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 block mb-1.5">
        {label}
      </span>
      {children}
    </div>
  )
}

// ── BulkActionBar ───────────────────────────────────────────────────────────
// Sticky bar that pins to the top of the scroll container while jobs are
// selected. Provides bulk Status and PM updates plus a clear-selection
// affordance. All mutations go through the same updateJob path the inline
// row controls use, so per-doc behavior stays identical.

function BulkActionBar({ count, pmOptions, busy, onApplyStatus, onApplyPM, onClear }) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-0 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-orange-400/30 bg-zinc-900/95 backdrop-blur-md px-3 py-2 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: O }}
    >
      <span className="text-xs font-bold text-white">{count} selected</span>

      <select
        value=""
        disabled={busy}
        onChange={(e) => { if (e.target.value) { onApplyStatus(e.target.value); e.target.value = '' } }}
        className="bg-white/[0.04] border border-white/15 rounded-lg text-xs px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-white/30 disabled:opacity-60"
        aria-label="Set status for selected jobs"
      >
        <option value="">Set status…</option>
        <option value="on-track">On Track</option>
        <option value="active">Active</option>
        <option value="needs-action">Needs Action</option>
        <option value="at-risk">At Risk</option>
        <option value="blocked">Blocked</option>
        <option value="hold">On Hold</option>
        <option value="complete">Complete</option>
      </select>

      <select
        value=""
        disabled={busy || pmOptions.length === 0}
        onChange={(e) => { if (e.target.value) { onApplyPM(e.target.value); e.target.value = '' } }}
        className="bg-white/[0.04] border border-white/15 rounded-lg text-xs px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-white/30 disabled:opacity-60"
        aria-label="Assign PM to selected jobs"
      >
        <option value="">Assign PM…</option>
        {pmOptions.map(pm => <option key={pm} value={pm}>{pm}</option>)}
      </select>

      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-300 hover:text-white px-2 py-1.5 rounded-md hover:bg-white/5 disabled:opacity-60"
      >
        <XIcon size={12} /> Clear
      </button>
    </div>
  )
}
