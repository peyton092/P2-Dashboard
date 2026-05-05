import { useMemo, useState } from 'react'
import { useData } from '../DataContext'
import { updateJob } from '../hooks/useFirestore'
import { ZONES, getZoneId } from '../agent/zones'
import {
  PageHeader,
  MetricTile,
  DataPanel,
  Pill,
  BillingBadge,
  FilterBar,
  ResponsiveTable,
  TableHeader,
  TableRow,
  TableCell,
  EmptyState,
  AllClearState,
  LoadingState,
} from './shared'
import {
  DollarSignIcon, CheckCircleIcon, ClockIcon,
  FileCheckIcon, FilePenLineIcon,
  ReceiptIcon, BanIcon, DownloadIcon, CheckIcon, XIcon,
  TimerIcon,
} from 'lucide-react'

const O = '#F47920'
const TODAY = new Date()

// ── Billing readiness — preserved from main ───────────────────────────────────

function inspPassed(job, trade, phase) {
  return job.insp?.[trade]?.[phase] === 'passed'
}
function anyFinalPassed(job) {
  return ['electrical', 'plumbing', 'hvac'].some(t => inspPassed(job, t, 'final'))
}
function anyRoughPassed(job) {
  return ['electrical', 'plumbing', 'hvac'].some(t => inspPassed(job, t, 'roughIn'))
}
function isBillingReady(job) {
  if (job.billingStatus === 'invoiced' || job.billingStatus === 'paid') return false
  if (['complete', 'completed'].includes(job.status)) return false
  return anyFinalPassed(job) || anyRoughPassed(job)
}
function getMilestone(job) {
  return anyFinalPassed(job) ? 'Final Inspection' : 'Rough-In'
}
function getBillingPct(job) {
  return anyFinalPassed(job) ? 0.30 : 0.70
}
function getContractValue(job) {
  return Number(job.contractValue) || 18000
}
function getBillableAmount(job) {
  return getContractValue(job) * getBillingPct(job)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
function fmtCompact(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000)     return `$${Math.round(v / 1_000).toLocaleString()}K`
  return `$${v.toLocaleString()}`
}

const jobLabel = (j) => j.name || j.client?.split?.(' ')?.[0] || j.id
const jobBuilder = (j) => j.client || j.qbsPM || '—'

// `invoiceDate` is stored as MM/DD/YYYY in seed and ISO from Firestore writes.
function parseInvoiceDate(dateStr) {
  if (!dateStr) return null
  const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const ms = m ? Date.parse(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`)
               : Date.parse(dateStr)
  return isNaN(ms) ? null : new Date(ms)
}

function daysSinceDate(date) {
  const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date))
  if (!d || isNaN(d.getTime())) return null
  return Math.floor((TODAY.getTime() - d.getTime()) / 86400000)
}

function invoiceMonthKey(dateStr) {
  const d = parseInvoiceDate(dateStr)
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null
}

function hasPermit(job) {
  return Boolean(job.permitNumber && String(job.permitNumber).trim())
}

// Operational microcopy — exact phrases requested in the brief.
function nextActionFor(job, ctx) {
  const { isReady, hasDocs, hasPendingCO, agingDays } = ctx
  const bs = job.billingStatus

  if (bs === 'paid')        return { text: 'Paid in full',                tone: 'success' }
  if (bs === 'partial-pay') return { text: 'Send balance reminder',       tone: 'warning' }
  if (bs === 'invoiced') {
    if (agingDays != null && agingDays >= 60) return { text: 'Escalate — 60+ days outstanding', tone: 'critical' }
    if (agingDays != null && agingDays >= 30) return { text: 'Send aging reminder',             tone: 'warning'  }
    return { text: 'Awaiting payment', tone: 'info' }
  }
  if (bs === 'hold')                          return { text: 'Resolve hold reason',         tone: 'critical' }
  if (job.status === 'blocked')               return { text: 'Billing blocked — unblock job', tone: 'critical' }

  // not-invoiced cases below
  if (!isReady)              return { text: 'Wait for milestone',             tone: 'mute'    }
  if (!hasDocs)              return { text: 'Review docs — add permit number', tone: 'warning' }
  if (hasPendingCO)          return { text: 'Pending approval — confirm CO before billing', tone: 'warning' }
  return { text: 'Submit invoice — package ready', tone: 'brand' }
}

// ── Component ────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',               label: 'All' },
  { id: 'ready-to-invoice',  label: 'Ready to invoice' },
  { id: 'missing-docs',      label: 'Missing docs' },
  { id: 'pending-approval',  label: 'Pending approval' },
  { id: 'invoiced',          label: 'Invoiced' },
  { id: 'blocked',           label: 'Blocked' },
]

const SORTS = [
  { id: 'amount',  label: 'Billable' },
  { id: 'aging',   label: 'Aging' },
  { id: 'pm',      label: 'PM' },
  { id: 'zone',    label: 'Zone' },
  { id: 'name',    label: 'Job' },
]

export default function BillingQueue() {
  const { jobs = [], extras = [], loading } = useData()
  const [search, setSearch]     = useState('')
  const [filter, setFilter]     = useState('all')
  const [pmFilter, setPmFilter] = useState('all')
  const [sortBy, setSortBy]     = useState('amount')

  // Pending-CO map: jobId → count of extras awaiting builder approval.
  const pendingCOByJob = useMemo(() => {
    const map = new Map()
    extras.forEach(e => {
      if (e.status === 'Sent to Builder' || e.status === 'pending') {
        if (e.job) map.set(e.job, (map.get(e.job) || 0) + 1)
      }
    })
    return map
  }, [extras])

  // Enrich each job with billing-relevant flags.
  const enriched = useMemo(() => jobs.map(j => {
    const isReady       = isBillingReady(j)
    const hasDocs       = hasPermit(j)
    const hasPendingCO  = (pendingCOByJob.get(j.id) || 0) > 0
    const invDate       = parseInvoiceDate(j.invoiceDate)
    const agingDays     = invDate ? daysSinceDate(invDate) : null
    const readySince    = j.lastStatusChange ? daysSinceDate(j.lastStatusChange) : null
    const billable      = isReady ? getBillableAmount(j) : 0
    return {
      job: j,
      isReady,
      hasDocs,
      hasPendingCO,
      pendingCOCount: pendingCOByJob.get(j.id) || 0,
      agingDays,
      readySince,
      billable,
      invDate,
      milestone: getMilestone(j),
    }
  }), [jobs, pendingCOByJob])

  // KPI tiles — all real numbers
  const kpis = useMemo(() => {
    const ready = enriched.filter(e => e.isReady && e.hasDocs && e.job.billingStatus !== 'hold')
    const missingDocs = enriched.filter(e => e.isReady && !e.hasDocs)
    const pendingApproval = enriched.filter(e =>
      e.job.billingStatus === 'hold' || (e.isReady && e.hasPendingCO)
    )
    const thisMonthKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`
    const invoicedThisMonth = enriched.filter(e => invoiceMonthKey(e.job.invoiceDate) === thisMonthKey)
    const aging = enriched.filter(e =>
      e.job.billingStatus === 'invoiced' && e.agingDays !== null && e.agingDays >= 30,
    )

    return {
      ready: {
        count: ready.length,
        amount: ready.reduce((s, e) => s + e.billable, 0),
      },
      missingDocs: {
        count: missingDocs.length,
        amount: missingDocs.reduce((s, e) => s + e.billable, 0),
      },
      pendingApproval: {
        count: pendingApproval.length,
        amount: pendingApproval.reduce((s, e) => s + e.billable, 0),
      },
      invoicedThisMonth: {
        count: invoicedThisMonth.length,
        amount: invoicedThisMonth.reduce((s, e) => s + getContractValue(e.job) * 0.7, 0),
      },
      aging: {
        count: aging.length,
        amount: aging.reduce((s, e) => s + getContractValue(e.job) * 0.7, 0),
      },
    }
  }, [enriched])

  // Filter + chip counts
  const matchesFilter = (e, f) => {
    if (f === 'all')              return e.isReady || e.job.billingStatus === 'invoiced' || e.job.billingStatus === 'partial-pay' || e.job.billingStatus === 'hold' || e.job.status === 'blocked'
    if (f === 'ready-to-invoice') return e.isReady && e.hasDocs && e.job.billingStatus !== 'hold' && !e.hasPendingCO
    if (f === 'missing-docs')     return e.isReady && !e.hasDocs
    if (f === 'pending-approval') return e.job.billingStatus === 'hold' || (e.isReady && e.hasPendingCO)
    if (f === 'invoiced')         return e.job.billingStatus === 'invoiced' || e.job.billingStatus === 'partial-pay'
    if (f === 'blocked')          return e.job.status === 'blocked' || e.job.billingStatus === 'hold'
    return true
  }

  const chipCounts = useMemo(() => {
    const out = {}
    FILTERS.forEach(f => { out[f.id] = enriched.filter(e => matchesFilter(e, f.id)).length })
    return out
  }, [enriched])

  const filterChips = FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  // Apply filter + search + PM + sort
  const display = useMemo(() => {
    let list = enriched.filter(e => matchesFilter(e, filter))
    if (pmFilter !== 'all') list = list.filter(e => e.job.pm === pmFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(e =>
        (e.job.id || '').toLowerCase().includes(q) ||
        (e.job.name || '').toLowerCase().includes(q) ||
        (e.job.client || '').toLowerCase().includes(q) ||
        (e.job.address || '').toLowerCase().includes(q) ||
        (e.job.pm || '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    if (sortBy === 'amount')      sorted.sort((a, b) => b.billable - a.billable)
    else if (sortBy === 'aging')  sorted.sort((a, b) => (b.agingDays ?? -1) - (a.agingDays ?? -1))
    else if (sortBy === 'pm')     sorted.sort((a, b) => (a.job.pm || '').localeCompare(b.job.pm || ''))
    else if (sortBy === 'zone')   sorted.sort((a, b) => getZoneId(a.job).localeCompare(getZoneId(b.job)))
    else if (sortBy === 'name')   sorted.sort((a, b) => jobLabel(a.job).localeCompare(jobLabel(b.job)))
    return sorted
  }, [enriched, filter, pmFilter, search, sortBy])

  const uniquePMs = useMemo(
    () => Array.from(new Set(enriched.map(e => e.job.pm).filter(Boolean))).sort(),
    [enriched],
  )

  const hasActiveFilters = filter !== 'all' || pmFilter !== 'all' || search.trim() !== ''

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading && jobs.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Billing Queue"
          title="Cash control"
          subtitle="Cash flow, every job. Real-time."
        />
        <LoadingState label="Loading billing queue…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Billing Queue"
        title="Cash control"
        subtitle="What is ready to invoice, what is stuck, and what needs to happen in the next 48 hours."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.ready.count} ready · {fmtCompact(kpis.ready.amount)} billable</span>
            {kpis.aging.count > 0 && (
              <span className="text-amber-300">{kpis.aging.count} aging 30+ days</span>
            )}
          </>
        }
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            title="Export CSV — coming soon"
          >
            <DownloadIcon size={13} /> Export
          </button>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Billing pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Ready to Invoice"
          value={fmtCompact(kpis.ready.amount)}
          Icon={CheckCircleIcon}
          emphasis={kpis.ready.count > 0 ? 'success' : 'mute'}
          sub={`${kpis.ready.count} job${kpis.ready.count === 1 ? '' : 's'}`}
        />
        <MetricTile
          label="Missing Documentation"
          value={kpis.missingDocs.count}
          Icon={FilePenLineIcon}
          emphasis={kpis.missingDocs.count > 0 ? 'warning' : 'success'}
          sub={kpis.missingDocs.count > 0 ? fmtCompact(kpis.missingDocs.amount) + ' on hold' : 'All packages clean'}
        />
        <MetricTile
          label="Pending Approval"
          value={kpis.pendingApproval.count}
          Icon={ClockIcon}
          emphasis={kpis.pendingApproval.count > 0 ? 'warning' : 'mute'}
          sub={kpis.pendingApproval.count > 0 ? 'Hold or CO in flight' : 'No approvals waiting'}
        />
        <MetricTile
          label="Invoiced This Month"
          value={fmtCompact(kpis.invoicedThisMonth.amount)}
          Icon={ReceiptIcon}
          sub={`${kpis.invoicedThisMonth.count} invoice${kpis.invoicedThisMonth.count === 1 ? '' : 's'}`}
        />
        <MetricTile
          label="Aging 30+"
          value={kpis.aging.count}
          Icon={TimerIcon}
          emphasis={kpis.aging.count > 0 ? 'critical' : 'success'}
          sub={kpis.aging.count > 0 ? fmtCompact(kpis.aging.amount) + ' outstanding' : 'No overdue invoices'}
        />
      </section>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, builder, PM, address…"
        chips={filterChips}
        trailing={
          <>
            <select
              value={pmFilter}
              onChange={e => setPmFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[200px]"
            >
              <option value="all">All PMs</option>
              {uniquePMs.map(pm => <option key={pm} value={pm}>{pm}</option>)}
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
                onClick={() => { setFilter('all'); setPmFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Main work queue */}
      <DataPanel
        title="Billing Work Queue"
        description={display.length === 0
          ? 'No jobs match the current filters.'
          : `${display.length} of ${enriched.length} job${enriched.length === 1 ? '' : 's'} shown`}
        Icon={DollarSignIcon}
        padding="none"
      >
        {display.length === 0 ? (
          <div className="p-5">
            <EmptyStateForFilter filter={filter} hasSearch={Boolean(search.trim() || pmFilter !== 'all')} />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block px-3 sm:px-4 pb-3 pt-1">
              <ResponsiveTable>
                <TableHeader
                  columns={[
                    { key: 'job',     label: 'Job',          width: '14%' },
                    { key: 'builder', label: 'Customer',     width: '14%' },
                    { key: 'amount',  label: 'Billable',     width: '10%', align: 'right' },
                    { key: 'status',  label: 'Billing',      width: '10%' },
                    { key: 'docs',    label: 'Docs',         width: '12%' },
                    { key: 'apr',     label: 'Approval',     width: '12%' },
                    { key: 'pm',      label: 'PM',           width: '10%' },
                    { key: 'aging',   label: 'Aging',        width: '8%' },
                    { key: 'next',    label: 'Next action',  width: '10%' },
                  ]}
                />
                <tbody>
                  {display.map(row => (
                    <BillingRow key={row.job._docId || row.job.id} row={row} />
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>

            {/* Mobile cards */}
            <ul className="md:hidden p-3 space-y-2">
              {display.map(row => (
                <li key={row.job._docId || row.job.id}>
                  <BillingCard row={row} />
                </li>
              ))}
            </ul>
          </>
        )}
      </DataPanel>

      <p className="text-[11px] text-center text-zinc-400">
        Send packages to Abby / Randi for invoicing.&nbsp;
        <a
          href="mailto:billing@p2electrical.com"
          className="font-semibold transition-colors"
          style={{ color: O }}
        >
          billing@p2electrical.com
        </a>
      </p>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function EmptyStateForFilter({ filter, hasSearch }) {
  if (hasSearch) {
    return (
      <EmptyState
        Icon={DollarSignIcon}
        title="No jobs match those filters"
        description="Adjust or clear the search and filters above."
      />
    )
  }
  if (filter === 'ready-to-invoice') {
    return (
      <AllClearState
        title="Nothing waiting to invoice"
        description="As soon as an inspection passes and docs are complete, the job appears here."
      />
    )
  }
  if (filter === 'missing-docs') {
    return (
      <AllClearState
        title="All packages have docs"
        description="No bill-ready jobs are missing a permit number."
      />
    )
  }
  if (filter === 'pending-approval') {
    return (
      <AllClearState
        title="No approvals waiting"
        description="No holds, no change orders sitting with the builder."
      />
    )
  }
  if (filter === 'invoiced') {
    return <EmptyState title="No invoiced jobs" description="Once a job is marked invoiced it shows up here." />
  }
  if (filter === 'blocked') {
    return (
      <AllClearState
        title="Nothing blocked"
        description="No billing holds and no blocked jobs in the system."
      />
    )
  }
  return <EmptyState title="No billing activity" description="Active jobs will appear here as billing milestones are earned." />
}

// ── Status pills ─────────────────────────────────────────────────────────────

function DocStatusPill({ hasDocs, milestone }) {
  if (!hasDocs) {
    return (
      <span className="inline-flex items-center gap-1">
        <Pill tone="warning" size="xs">Missing permit</Pill>
        <span className="text-[10px] text-zinc-400">{milestone}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone="success" size="xs" Icon={FileCheckIcon}>Permit OK</Pill>
      <span className="text-[10px] text-zinc-400">{milestone}</span>
    </span>
  )
}

function ApprovalStatusPill({ row }) {
  const { job, hasPendingCO, pendingCOCount, isReady } = row
  if (job.billingStatus === 'hold')   return <Pill tone="critical" size="xs">On hold</Pill>
  if (job.status === 'blocked')       return <Pill tone="critical" size="xs">Job blocked</Pill>
  if (hasPendingCO)                   return <Pill tone="warning" size="xs">{pendingCOCount} CO pending</Pill>
  if (isReady)                        return <Pill tone="success" size="xs">Inspection passed</Pill>
  if (job.billingStatus === 'paid')   return <Pill tone="success" size="xs">Paid</Pill>
  if (job.billingStatus === 'invoiced') return <Pill tone="info" size="xs">Auto — invoiced</Pill>
  return <Pill tone="mute" size="xs">In progress</Pill>
}

// ── Action buttons (preserve all existing Firestore writes) ─────────────────

function BillingActions({ job }) {
  const [marking, setMarking] = useState(false)
  const [holding, setHolding] = useState(false)
  const isInvoiced = job.billingStatus === 'invoiced' || job.billingStatus === 'paid'
  const isHold     = job.billingStatus === 'hold'

  async function handleMarkInvoiced() {
    if (!job._docId) return
    setMarking(true)
    try { await updateJob(job._docId, { billingStatus: 'invoiced' }) }
    finally { setMarking(false) }
  }
  async function handleHold() {
    if (!job._docId) return
    setHolding(true)
    try { await updateJob(job._docId, { billingStatus: 'hold' }) }
    finally { setHolding(false) }
  }
  async function handleRelease() {
    if (!job._docId) return
    setHolding(true)
    try { await updateJob(job._docId, { billingStatus: 'not-invoiced' }) }
    finally { setHolding(false) }
  }

  if (isInvoiced) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
        <CheckIcon size={12} /> Invoiced
      </span>
    )
  }
  if (isHold) {
    return (
      <button
        type="button"
        onClick={handleRelease}
        disabled={holding}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-white/10 text-zinc-200 hover:text-white hover:border-white/30 disabled:opacity-50"
      >
        <BanIcon size={11} /> {holding ? '…' : 'Release hold'}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button
        type="button"
        onClick={handleMarkInvoiced}
        disabled={marking}
        className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md text-white disabled:opacity-50 transition-colors"
        style={{ backgroundColor: O }}
        title="Submit invoice — marks job invoiced"
      >
        <ReceiptIcon size={11} /> {marking ? '…' : 'Submit invoice'}
      </button>
      <button
        type="button"
        onClick={handleHold}
        disabled={holding}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
        title="Place billing hold"
      >
        <XIcon size={11} /> {holding ? '…' : 'Hold'}
      </button>
    </div>
  )
}

function InvoiceNumberInput({ job }) {
  const [val, setVal]       = useState(job.invoiceNum || '')
  const [saving, setSaving] = useState(false)
  async function handleBlur() {
    if (!job._docId) return
    if (val === (job.invoiceNum || '')) return
    setSaving(true)
    try { await updateJob(job._docId, { invoiceNum: val }) }
    finally { setSaving(false) }
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={handleBlur}
        placeholder="Inv #"
        className="bg-white/[0.04] border border-white/10 rounded-md text-xs text-zinc-100 px-2 py-1 w-20 placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
      />
      {saving && <span className="text-[10px] text-zinc-400">saving…</span>}
    </div>
  )
}

// ── Desktop row ──────────────────────────────────────────────────────────────

function BillingRow({ row }) {
  const { job, isReady, hasDocs, hasPendingCO, agingDays, billable, milestone } = row
  const zoneId   = getZoneId(job)
  const zone     = ZONES[zoneId] || ZONES['zone-7']
  const next     = nextActionFor(job, { isReady, hasDocs, hasPendingCO, agingDays })
  const nextColor =
    next.tone === 'critical' ? '#ef4444' :
    next.tone === 'warning'  ? '#eab308' :
    next.tone === 'success'  ? '#22c55e' :
    next.tone === 'info'     ? '#3b82f6' :
    next.tone === 'brand'    ? O :
    '#9ca3af'

  return (
    <TableRow
      className={
        job.billingStatus === 'hold' || job.status === 'blocked' ? 'ring-1 ring-red-500/20'
        : agingDays != null && agingDays >= 30 ? 'ring-1 ring-amber-500/15'
        : ''
      }
    >
      <TableCell first>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {job.id}
          </span>
          <span className="font-semibold text-zinc-100 truncate">{jobLabel(job)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-zinc-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: zone.color }} />
          {zone.name}
        </div>
      </TableCell>
      <TableCell className="text-zinc-200 truncate">{jobBuilder(job)}</TableCell>
      <TableCell align="right" className="font-bold tabular-nums" style={{ color: billable > 0 ? O : '#9ca3af' }}>
        {billable > 0 ? fmt(billable) : '—'}
      </TableCell>
      <TableCell><BillingBadge status={job.billingStatus} /></TableCell>
      <TableCell><DocStatusPill hasDocs={hasDocs} milestone={milestone} /></TableCell>
      <TableCell><ApprovalStatusPill row={row} /></TableCell>
      <TableCell className="text-zinc-200 truncate">{job.pm || '—'}</TableCell>
      <TableCell>
        <AgingPill row={row} />
      </TableCell>
      <TableCell last>
        <div className="flex flex-col items-stretch gap-1.5">
          <p
            className="text-[11px] font-semibold leading-snug"
            style={{ color: nextColor }}
            title={next.text}
          >
            {next.text}
          </p>
          <BillingActions job={job} />
          {(job.billingStatus !== 'invoiced' && job.billingStatus !== 'paid' && job.billingStatus !== 'hold') && (
            <InvoiceNumberInput job={job} />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function AgingPill({ row }) {
  const { job, agingDays, readySince, isReady } = row
  // Invoiced — show how long since invoiceDate
  if (job.billingStatus === 'invoiced' || job.billingStatus === 'partial-pay') {
    if (agingDays == null) return <span className="text-zinc-500 text-xs">—</span>
    const tone = agingDays >= 60 ? 'critical' : agingDays >= 30 ? 'warning' : 'info'
    return <Pill tone={tone} size="xs">{agingDays}d</Pill>
  }
  if (job.billingStatus === 'paid') {
    return <Pill tone="success" size="xs">Paid</Pill>
  }
  // Bill-ready but not invoiced — show how long it has been waiting
  if (isReady && readySince != null) {
    const tone = readySince >= 7 ? 'critical' : readySince >= 3 ? 'warning' : 'info'
    return <Pill tone={tone} size="xs">{readySince}d ready</Pill>
  }
  return <span className="text-zinc-500 text-xs">—</span>
}

// ── Mobile card ──────────────────────────────────────────────────────────────

function BillingCard({ row }) {
  const { job, isReady, hasDocs, hasPendingCO, agingDays, billable, milestone } = row
  const next = nextActionFor(job, { isReady, hasDocs, hasPendingCO, agingDays })
  const accent =
    next.tone === 'critical' ? '#ef4444' :
    next.tone === 'warning'  ? '#eab308' :
    next.tone === 'brand'    ? O :
    next.tone === 'success'  ? '#22c55e' :
    null

  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
      style={accent ? { borderLeftWidth: 3, borderLeftColor: accent } : undefined}
    >
      <header className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">
            {job.id}
          </span>
          <p className="text-base font-bold text-white mt-1.5 truncate">{jobLabel(job)}</p>
          <p className="text-[11px] text-zinc-400 truncate">
            {jobBuilder(job)}{job.pm ? ` · PM ${job.pm}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums" style={{ color: billable > 0 ? O : '#9ca3af' }}>
            {billable > 0 ? fmt(billable) : '—'}
          </p>
          <p className="text-[10px] text-zinc-400">{milestone} {anyFinalPassed(job) ? '30%' : '70%'}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <BillingBadge status={job.billingStatus} />
        <DocStatusPill hasDocs={hasDocs} milestone={milestone} />
        <ApprovalStatusPill row={row} />
        <AgingPill row={row} />
      </div>

      <div className="mt-2 pt-3 border-t border-white/5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">Next action</p>
        <p className="text-sm font-semibold leading-snug" style={{ color: accent || '#9ca3af' }}>
          {next.text}
        </p>
        <div className="flex items-center justify-between gap-2 mt-3">
          <InvoiceNumberInput job={job} />
          <BillingActions job={job} />
        </div>
      </div>
    </article>
  )
}
