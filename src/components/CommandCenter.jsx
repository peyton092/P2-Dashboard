import { useEffect, useMemo, useState } from 'react'
import { onSnapshot, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useData } from '../DataContext'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import {
  PageHeader,
  MetricTile,
  DataPanel,
  Pill,
  AllClearState,
  EmptyState,
} from './shared'
import {
  AlertCircleIcon, CheckCircleIcon,
  DollarSignIcon, ClockIcon,
  ArrowRightIcon,
  // Phase 3 QA — preferred lucide names
  RadarIcon, UserRoundCogIcon, TriangleAlertIcon,
  BadgeCheckIcon, NotebookPenIcon,
  FilePenLineIcon, FolderOpenIcon, BarChart3Icon,
} from 'lucide-react'
import { classifyRisk } from '../agent/scoring'

const O = '#F47920'

const TODAY = new Date()

// Per-job-type contract estimate, used as a fallback when `contractValue`
// isn't set on the document. Numbers come from the existing app's pricing
// model and are documented inline so finance can audit them.
const TYPE_ESTIMATE = {
  'New Construction MEP':            28000,
  'Full MEP Renovation':             22000,
  'Commercial MEP Buildout':         35000,
  'Commercial HVAC Retrofit':        20000,
  'Electrical Rewire + HVAC':        18000,
  'HVAC + Electrical Upgrade':       16000,
  'Residential Full Rewire':         14000,
  'HVAC + Plumbing Renovation':      15000,
  'Plumbing + Electrical Upgrade':   16000,
  'Full MEP New Build':              30000,
  'HVAC System Replacement':         12000,
  'Residential MEP Upgrade':         18000,
  'Electrical + Plumbing Renovation':15000,
  'Electrical + HVAC Upgrade':       17000,
  'Electrical Full Rewire':          13000,
  'HVAC + Plumbing':                 14000,
}

function jobContract(j) {
  return Number(j.contractValue) || TYPE_ESTIMATE[j.type] || 18000
}

const isComplete = (j) => ['complete', 'completed'].includes(j.status)

const daysSince = (date) => {
  if (!date) return null
  try {
    const d = date?.toDate ? date.toDate() : new Date(date)
    if (isNaN(d.getTime())) return null
    return Math.floor((TODAY - d) / 86400000)
  } catch { return null }
}

const jobLabel = (j) => j.name || j.client?.split(' ')[0] || j.id

// Compact $ formatter — turns 1234567 into "$1.23M".
function fmtCompact(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toLocaleString()}`
}

// invoiceDate is stored as MM/DD/YYYY in the seed; some Firestore writes
// produce ISO strings. Normalize to YYYY-MM for month comparison.
function invoiceMonth(dateStr) {
  if (!dateStr) return null
  const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}`
  return String(dateStr).slice(0, 7)
}

const PM_ZONES = {
  'Blake Neblett':   'Zone 1',
  'Brendan Embry':   'Zone 2',
  'Jeb Brooks':      'Zone 3',
  'Taylor Hensley':  'Zone 4',
  'Tim King':        'Zone 5',
  'Derek Powers':    'Zone 6',
}

// ── QuickBooks live status ────────────────────────────────────────────────────

function useQuickBooksStatus() {
  const [state, setState] = useState({ connected: null, connectedAt: null, realmId: null })
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'qb_config', 'tokens'),
      snap => {
        const d = snap.data()
        const ts = d?.connectedAt?.toDate?.()
          || (d?.connectedAt ? new Date(d.connectedAt) : null)
        setState({
          connected: snap.exists() && !!d?.access_token,
          connectedAt: ts && !isNaN(ts.getTime()) ? ts : null,
          realmId: d?.realmId || null,
        })
      },
      () => setState({ connected: false, connectedAt: null, realmId: null }),
    )
    return unsub
  }, [])
  return state
}

// ── Top-level component ──────────────────────────────────────────────────────

export default function CommandCenter() {
  const { jobs = [], extras = [] } = useData()
  const qb = useQuickBooksStatus()

  // ── Derived data ────────────────────────────────────────────────────────────

  const activeJobs = useMemo(() => jobs.filter(j => !isComplete(j)), [jobs])

  // KPI: financial pipeline
  const kpis = useMemo(() => {
    const totalRevenue = jobs.reduce((s, j) => s + jobContract(j), 0)

    const openCommitments = jobs
      .filter(j => !isComplete(j) && j.billingStatus !== 'paid')
      .reduce((s, j) => s + jobContract(j), 0)

    const pendingCO = extras
      .filter(e => ['pending', 'Sent to Builder', 'Draft'].includes(e.status))
      .reduce((s, e) => s + Number(e.total ?? e.amount ?? 0), 0)

    const approvedCO = extras
      .filter(e => e.status === 'Approved' || e.status === 'approved')
      .reduce((s, e) => s + Number(e.total ?? e.amount ?? 0), 0)

    const thisMonth = TODAY.toISOString().slice(0, 7)
    const invoicedThisMonthAmt = jobs
      .filter(j => invoiceMonth(j.invoiceDate) === thisMonth)
      .reduce((s, j) => s + jobContract(j) * 0.7, 0) // 70% milestone billing assumption
    const invoicedThisMonthCount = jobs
      .filter(j => invoiceMonth(j.invoiceDate) === thisMonth).length

    return {
      totalRevenue,
      openCommitments,
      pendingCO,
      approvedCO,
      invoicedThisMonthAmt,
      invoicedThisMonthCount,
    }
  }, [jobs, extras])

  // Needs Action — 4 categories like the mockup
  const needsAction = useMemo(() => {
    const atRisk = activeJobs.filter(j => {
      if (j.status === 'at-risk' || j.status === 'blocked' || j.status === 'needs-action') return true
      const stale = daysSince(j.lastStatusChange || j.start)
      return stale !== null && stale >= 7
    })

    const awaitingInspection = activeJobs.filter(j => {
      const insp = j.insp || {}
      return Object.values(insp).some(t =>
        Object.values(t || {}).some(s => s === 'scheduled' || s === 'pending-verification')
      )
    })

    const missingDocs = activeJobs.filter(j => {
      if (!j.permitNumber) return true
      const permits = j.permits || {}
      return Object.values(permits).some(s => s === 'pending' || s === 'applied')
    })

    const builderApproval = extras.filter(e =>
      e.status === 'Sent to Builder' || e.status === 'pending',
    )

    return [
      { key: 'at-risk',         label: 'At Risk',                 count: atRisk.length,            target: 'alerts' },
      { key: 'awaiting-insp',   label: 'Awaiting Inspection',     count: awaitingInspection.length, target: 'inspections' },
      { key: 'missing-docs',    label: 'Missing Documentation',   count: missingDocs.length,        target: 'permits' },
      { key: 'builder-approval', label: 'Builder Approval Required', count: builderApproval.length, target: 'extras' },
    ]
  }, [activeJobs, extras])

  // Jobs At Risk — top 5 ranked
  const jobsAtRisk = useMemo(() => {
    return activeJobs
      .map(j => {
        const risk = classifyRisk(j)
        const stale = daysSince(j.lastStatusChange || j.start)
        let reason = null, severity = null
        if (risk?.level === 'critical') { severity = 'High';   reason = risk.reason || 'Critical' }
        else if (j.status === 'blocked')      { severity = 'High';   reason = 'Blocked' }
        else if (j.status === 'needs-action') { severity = 'High';   reason = 'Action required' }
        else if (j.status === 'at-risk')      { severity = 'Medium'; reason = 'At risk' }
        else if (stale !== null && stale >= 14) { severity = 'High';   reason = `Stalled ${stale}d` }
        else if (stale !== null && stale >= 7)  { severity = 'Medium'; reason = `Stalled ${stale}d` }
        else if (risk?.level === 'warning')   { severity = 'Medium'; reason = risk.reason || 'Warning' }
        return severity ? { job: j, severity, reason } : null
      })
      .filter(Boolean)
      .sort((a, b) => {
        const order = { High: 0, Medium: 1, Low: 2 }
        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
      })
      .slice(0, 5)
  }, [activeJobs])

  // PM Workload — count active jobs per PM, weighted by issues
  const pmWorkload = useMemo(() => {
    const map = new Map()
    activeJobs.forEach(j => {
      const pm = j.pm || 'Unassigned'
      if (!map.has(pm)) {
        map.set(pm, { pm, zone: PM_ZONES[pm] || null, jobs: 0, issues: 0 })
      }
      const row = map.get(pm)
      row.jobs += 1
      if (j.status === 'needs-action' || j.status === 'blocked' || j.status === 'at-risk') {
        row.issues += 1
      }
      const stale = daysSince(j.lastStatusChange || j.start)
      if (stale !== null && stale >= 7) row.issues += 1
    })
    const list = Array.from(map.values())
      .sort((a, b) => b.jobs - a.jobs || b.issues - a.issues)
      .slice(0, 6)
    const max = list.length > 0 ? Math.max(...list.map(r => r.jobs)) : 1
    return list.map(r => ({ ...r, fill: Math.max(8, Math.round((r.jobs / max) * 100)) }))
  }, [activeJobs])

  // Inspection Summary — counts across all trades, every active job
  const inspSummary = useMemo(() => {
    let passed = 0, pending = 0, failed = 0, overdue = 0
    activeJobs.forEach(j => {
      Object.values(j.insp || {}).forEach(trade => {
        Object.entries(trade || {}).forEach(([phase, status]) => {
          if (phase.endsWith('Date')) return
          if (status === 'passed')                                 passed  += 1
          else if (status === 'failed')                            failed  += 1
          else if (status === 'pending' || status === 'pending-verification') pending += 1
          else if (status === 'scheduled') {
            // Treat scheduled-but-old as overdue — we approximate "old" as
            // "the job has been stalled 5+ days", since inspection scheduling
            // dates are not stored on every record.
            const stale = daysSince(j.lastStatusChange || j.start)
            if (stale !== null && stale >= 5) overdue += 1
            else                              pending += 1
          }
        })
      })
    })
    const total = passed + pending + failed + overdue
    return { passed, pending, failed, overdue, total }
  }, [activeJobs])

  // Billing Opportunities — three slices
  const billingOpps = useMemo(() => {
    // Ready to Invoice: bill-ready, not yet invoiced
    const ready = jobs.filter(j => {
      if (j.billingStatus === 'invoiced' || j.billingStatus === 'paid') return false
      if (isComplete(j)) return false
      const insp = j.insp || {}
      return Object.values(insp).some(t =>
        t?.final === 'passed' || t?.roughIn === 'passed',
      )
    })
    const readyAmt = ready.reduce((s, j) => {
      const anyFinal = ['electrical','plumbing','hvac'].some(t => j.insp?.[t]?.final === 'passed')
      const pct = anyFinal ? 0.30 : 0.70
      return s + jobContract(j) * pct
    }, 0)

    // Recently Invoiced: invoiceDate in last 30 days, not yet paid
    const cutoff = new Date(TODAY); cutoff.setDate(cutoff.getDate() - 30)
    const cutoffMs = cutoff.getTime()
    const recentlyInvoiced = jobs.filter(j => {
      if (!j.invoiceDate) return false
      if (j.billingStatus === 'paid') return false
      const m = String(j.invoiceDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      const ms = m ? Date.parse(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`)
                   : Date.parse(j.invoiceDate)
      return !isNaN(ms) && ms >= cutoffMs
    })
    const recentlyInvoicedAmt = recentlyInvoiced.reduce((s, j) => s + jobContract(j) * 0.7, 0)

    // Approved Pending Invoice: COs approved but not yet billed (qbs flag false)
    const approvedPending = extras.filter(e =>
      (e.status === 'Approved' || e.status === 'approved') && !e.qbs,
    )
    const approvedPendingAmt = approvedPending.reduce(
      (s, e) => s + Number(e.total ?? e.amount ?? 0), 0,
    )

    return {
      ready:            { count: ready.length,            amount: readyAmt },
      recentlyInvoiced: { count: recentlyInvoiced.length, amount: recentlyInvoicedAmt },
      approvedPending:  { count: approvedPending.length,  amount: approvedPendingAmt },
    }
  }, [jobs, extras])

  const navigate = (id) => window.dispatchEvent(new CustomEvent('p2:navigate', { detail: { id } }))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title="Today's operating picture"
        subtitle="Live across the active portfolio. Money, risk, inspections, approvals."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
              <span className="font-mono tracking-[0.18em] text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span>{activeJobs.length} active jobs</span>
            <span>Middle Tennessee</span>
          </>
        }
      />

      {/* KPI strip — 5 financial tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Financial pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      >
        <MetricTile
          label="Total Revenue"
          value={fmtCompact(kpis.totalRevenue)}
          Icon={DollarSignIcon}
          sub={`${jobs.length} contracts`}
        />
        <MetricTile
          label="Open Commitments"
          value={fmtCompact(kpis.openCommitments)}
          Icon={ClockIcon}
          sub={`${activeJobs.length} active`}
        />
        <MetricTile
          label="Approved Extras"
          value={fmtCompact(kpis.approvedCO)}
          Icon={CheckCircleIcon}
          emphasis="success"
          sub="Approved change orders"
        />
        <MetricTile
          label="Change Order Potential"
          value={fmtCompact(kpis.pendingCO)}
          Icon={FilePenLineIcon}
          emphasis={kpis.pendingCO > 0 ? 'warning' : 'mute'}
          sub="Awaiting builder approval"
        />
        <MetricTile
          label="Invoiced This Month"
          value={fmtCompact(kpis.invoicedThisMonthAmt)}
          Icon={BarChart3Icon}
          emphasis={kpis.invoicedThisMonthCount > 0 ? 'default' : 'mute'}
          sub={`${kpis.invoicedThisMonthCount} invoice${kpis.invoicedThisMonthCount === 1 ? '' : 's'}`}
        />
      </section>

      {/* Row 1 — Needs Action / Jobs At Risk / PM Workload */}
      <div className="grid gap-4 md:gap-5 lg:grid-cols-3">
        <DataPanel
          title="Needs Action"
          description="Items that need a person now."
          Icon={TriangleAlertIcon}
          badge={
            <Pill
              tone={needsAction.some(n => n.count > 0) ? 'brand' : 'success'}
              size="xs"
            >
              {needsAction.reduce((s, n) => s + n.count, 0)}
            </Pill>
          }
          footer={
            <button
              type="button"
              onClick={() => navigate('alerts')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: O }}
            >
              View All Alerts <ArrowRightIcon size={13} />
            </button>
          }
        >
          <ul className="divide-y divide-white/5">
            {needsAction.map(n => (
              <li key={n.key}>
                <button
                  type="button"
                  onClick={() => navigate(n.target)}
                  className="group w-full flex items-center justify-between gap-3 py-2.5 -my-px rounded-md hover:bg-white/[0.03] px-2 transition-colors"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: O + '22', color: O }}
                    >
                      <NeedsActionIcon kind={n.key} />
                    </span>
                    <span className="text-sm font-medium text-zinc-100 truncate">{n.label}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-lg font-black tabular-nums leading-none"
                      style={{ color: n.count > 0 ? O : '#9ca3af' }}
                    >
                      {n.count}
                    </span>
                    <ArrowRightIcon size={14} className="text-zinc-400 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DataPanel>

        <DataPanel
          title="Jobs At Risk"
          description="Risk-scored, top of mind."
          Icon={RadarIcon}
          badge={
            <Pill tone={jobsAtRisk.length > 0 ? 'warning' : 'success'} size="xs">
              {jobsAtRisk.length}
            </Pill>
          }
          footer={
            <button
              type="button"
              onClick={() => navigate('war-room')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: O }}
            >
              View All Jobs At Risk <ArrowRightIcon size={13} />
            </button>
          }
        >
          {jobsAtRisk.length === 0 ? (
            <AllClearState title="No risk flagged" description="All active jobs are inside their guardrails." />
          ) : (
            <ul className="space-y-1.5">
              {jobsAtRisk.map(({ job, severity, reason }) => (
                <li key={job._docId || job.id}>
                  <button
                    type="button"
                    onClick={() => navigate('war-room')}
                    className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{jobLabel(job)}</p>
                      <p className="text-[11px] text-zinc-400 truncate">{reason}</p>
                    </div>
                    <Pill
                      tone={severity === 'High' ? 'critical' : severity === 'Medium' ? 'warning' : 'neutral'}
                      size="xs"
                    >
                      {severity}
                    </Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DataPanel>

        <DataPanel
          title="PM Workload"
          description="Active jobs per PM."
          Icon={UserRoundCogIcon}
          footer={
            <button
              type="button"
              onClick={() => navigate('pm-dashboard')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: O }}
            >
              View Full Workload <ArrowRightIcon size={13} />
            </button>
          }
        >
          {pmWorkload.length === 0 ? (
            <EmptyState title="No active assignments" description="Active jobs without a PM won't show here." />
          ) : (
            <ul className="space-y-2.5">
              {pmWorkload.map(p => (
                <li key={p.pm}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="min-w-0 flex items-center gap-2">
                      <div
                        className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold"
                        style={{ width: 26, height: 26, backgroundColor: O + '22', color: O }}
                      >
                        {p.pm.split(' ').map(s => s[0]).join('').slice(0, 2)}
                      </div>
                      <span className="text-sm font-semibold text-zinc-100 truncate">{p.pm}</span>
                    </div>
                    <span className="text-xs text-zinc-300 shrink-0">
                      <span className="text-white font-semibold">{p.jobs}</span> active
                      {p.issues > 0 ? <> · <span className="text-amber-300 font-semibold">{p.issues}</span> issue{p.issues === 1 ? '' : 's'}</> : null}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden ml-9">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${p.fill}%`,
                        backgroundColor: p.issues > 0 ? '#eab308' : O,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DataPanel>
      </div>

      {/* Row 2 — Inspection Summary / Billing Opportunities / QuickBooks Status */}
      <div className="grid gap-4 md:gap-5 lg:grid-cols-3">
        <DataPanel
          title="Inspection Summary"
          description="Across all active jobs and trades."
          Icon={BadgeCheckIcon}
          footer={
            <button
              type="button"
              onClick={() => navigate('inspections')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: O }}
            >
              View Inspections <ArrowRightIcon size={13} />
            </button>
          }
        >
          <InspectionDonut summary={inspSummary} />
        </DataPanel>

        <DataPanel
          title="Billing Opportunities"
          description="Cash currently in the pipe."
          Icon={DollarSignIcon}
          footer={
            <button
              type="button"
              onClick={() => navigate('billing-queue')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: O }}
            >
              Go to Billing Queue <ArrowRightIcon size={13} />
            </button>
          }
        >
          <ul className="space-y-2">
            <BillingRow
              label="Ready to Invoice"
              amount={billingOpps.ready.amount}
              count={billingOpps.ready.count}
              tone="success"
            />
            <BillingRow
              label="Recently Invoiced"
              amount={billingOpps.recentlyInvoiced.amount}
              count={billingOpps.recentlyInvoiced.count}
              tone="info"
              subtitle="Last 30 days"
            />
            <BillingRow
              label="Approved Pending Invoice"
              amount={billingOpps.approvedPending.amount}
              count={billingOpps.approvedPending.count}
              tone="brand"
              subtitle="Approved change orders"
            />
          </ul>
        </DataPanel>

        <DataPanel
          title="QuickBooks Status"
          description="Auto-sync of invoices and change orders."
          Icon={BarChart3Icon}
          footer={
            <button
              type="button"
              onClick={() => navigate('settings')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: O }}
            >
              {qb.connected ? 'Sync settings' : 'Connect now'} <ArrowRightIcon size={13} />
            </button>
          }
        >
          <QuickBooksStatusCard qb={qb} />
        </DataPanel>
      </div>

      {/* Quick Modules */}
      <section aria-label="Quick modules" className="pt-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300 mb-3">
          Quick Modules
        </h2>
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
        >
          <QuickModule id="pm-dashboard"  Icon={UserRoundCogIcon} label="PM Dashboard"  hint="Risk-scored hit list" onSelect={navigate} />
          <QuickModule id="war-room"      Icon={RadarIcon}        label="War Room"      hint="Field status board"   onSelect={navigate} />
          <QuickModule id="billing-queue" Icon={DollarSignIcon}   label="Billing Queue" hint="Cash flow control"     onSelect={navigate} />
          <QuickModule id="extras"        Icon={FilePenLineIcon}  label="Change Orders" hint="Approve & invoice"     badge={kpis.pendingCO > 0 ? extras.filter(e => e.status === 'Sent to Builder' || e.status === 'pending').length : 0} onSelect={navigate} />
          <QuickModule id="folders"       Icon={FolderOpenIcon}   label="Documents"     hint="Project folders"       onSelect={navigate} />
          <QuickModule id="analytics"     Icon={BarChart3Icon}    label="Reports"       hint="Portfolio analytics"   onSelect={navigate} />
        </div>
      </section>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NeedsActionIcon({ kind }) {
  const map = {
    'at-risk':          TriangleAlertIcon,
    'awaiting-insp':    BadgeCheckIcon,
    'missing-docs':     NotebookPenIcon,
    'builder-approval': FilePenLineIcon,
  }
  const Icon = map[kind] || AlertCircleIcon
  return <Icon size={16} strokeWidth={2} />
}

function BillingRow({ label, amount, count, subtitle, tone = 'neutral' }) {
  const color =
    tone === 'success' ? '#22c55e' :
    tone === 'info'    ? '#3b82f6' :
    tone === 'brand'   ? O :
    '#9ca3af'
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-white/5 bg-white/[0.02]">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-100 truncate">{label}</p>
        <p className="text-[11px] text-zinc-400 truncate">
          {count} item{count === 1 ? '' : 's'}{subtitle ? ` · ${subtitle}` : ''}
        </p>
      </div>
      <p
        className="text-base font-black tabular-nums shrink-0"
        style={{ color: count > 0 ? color : '#9ca3af' }}
      >
        {amount > 0 ? `$${(amount / 1000).toFixed(amount >= 100_000 ? 0 : 1)}K` : '$0'}
      </p>
    </li>
  )
}

function InspectionDonut({ summary }) {
  if (summary.total === 0) {
    return (
      <AllClearState
        title="No inspections logged"
        description="Inspection statuses across active jobs will populate here."
      />
    )
  }
  const data = [
    { name: 'Passed',  value: summary.passed,  color: '#22c55e' },
    { name: 'Pending', value: summary.pending, color: '#eab308' },
    { name: 'Failed',  value: summary.failed,  color: '#ef4444' },
    { name: 'Overdue', value: summary.overdue, color: O },
  ].filter(d => d.value > 0)

  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 items-center">
      <div className="relative h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={62}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-2xl font-black tabular-nums leading-none text-white">{summary.total}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-400 mt-0.5">Total</p>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs">
        <DonutLegendRow label="Passed"  value={summary.passed}  total={summary.total} color="#22c55e" />
        <DonutLegendRow label="Pending" value={summary.pending} total={summary.total} color="#eab308" />
        <DonutLegendRow label="Failed"  value={summary.failed}  total={summary.total} color="#ef4444" />
        <DonutLegendRow label="Overdue" value={summary.overdue} total={summary.total} color={O} />
      </ul>
    </div>
  )
}

function DonutLegendRow({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <li className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="flex-1 truncate text-zinc-200">{label}</span>
      <span className="font-mono tabular-nums shrink-0">
        <span className="font-bold" style={{ color }}>{value}</span>
        <span className="text-zinc-400 ml-1.5">({pct}%)</span>
      </span>
    </li>
  )
}

function QuickBooksStatusCard({ qb }) {
  if (qb.connected === null) {
    return <p className="text-xs text-zinc-400 py-3">Checking connection…</p>
  }
  if (qb.connected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="shrink-0 flex items-center justify-center rounded-xl"
            style={{ width: 44, height: 44, backgroundColor: '#22c55e22' }}
          >
            <CheckCircleIcon size={20} color="#22c55e" strokeWidth={2.25} />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Connected</p>
            <p className="text-[11px] text-zinc-400">QuickBooks Online</p>
          </div>
        </div>
        <dl className="space-y-1.5 text-[11px] mt-1">
          {qb.realmId && (
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-400">Realm</dt>
              <dd className="font-mono text-zinc-100 truncate max-w-[55%]">{qb.realmId}</dd>
            </div>
          )}
          {qb.connectedAt && (
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-400">Connected</dt>
              <dd className="text-zinc-100">
                {qb.connectedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </dd>
            </div>
          )}
        </dl>
      </div>
    )
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="shrink-0 flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, backgroundColor: 'rgba(255,255,255,0.06)' }}
        >
          <BarChart3Icon size={20} className="text-zinc-300" strokeWidth={2} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">Not connected</p>
          <p className="text-[11px] text-zinc-400">QuickBooks Online</p>
        </div>
      </div>
      <p className="text-[11px] text-zinc-300">
        Connect QuickBooks to enable invoice and change-order auto-sync. Open
        <span className="font-semibold text-white"> Settings → QuickBooks Integration</span>.
      </p>
    </div>
  )
}

function QuickModule({ id, Icon, label, hint, badge = 0, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(id)}
      className="group relative flex items-center gap-3 px-3 py-3 rounded-xl border border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.05] transition-colors text-left"
    >
      <div
        className="shrink-0 flex items-center justify-center rounded-lg"
        style={{ width: 38, height: 38, backgroundColor: O + '22', color: O }}
      >
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-100 truncate flex items-center gap-1.5">
          {label}
          {badge > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white"
              style={{ backgroundColor: O }}
            >
              {badge}
            </span>
          )}
        </p>
        <p className="text-[11px] text-zinc-400 truncate">{hint}</p>
      </div>
      <ArrowRightIcon
        size={14}
        className="shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  )
}
