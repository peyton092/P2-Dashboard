import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import { updateJob } from '../hooks/useFirestore'
import { daysSince } from '../agent/scoring'
import { exportToCsv } from '../lib/exportCsv'
import { useStickyState } from '../lib/useStickyState'
import {
  PageHeader, MetricTile, DataPanel, Pill, LiveDot, StatusBadge,
  EmptyState, AllClearState, FilterBar, SavedViewSelect,
} from './shared'
import {
  SUB_STATUS_OPTIONS, SUB_STATUS_COLOR, SUB_FILTERS, TRADE_FILTERS,
  daysUntilDate, subInsuranceState, subLicenseState,
  subHasMissingDocs, subInsuranceExpired, subInsuranceExpiringSoon,
  subLicenseExpired, subComplianceVerdict, subMatchesFilter, subNextAction,
  fmtSubDate, subJobKey,
} from '../lib/subs'
import { jobName } from '../lib/jobs'
import {
  AlertCircleIcon, CheckCircleIcon, ChevronRightIcon, ClockIcon, DownloadIcon,
  FileTextIcon, PhoneIcon, ShieldCheckIcon, TriangleAlertIcon,
  UsersRoundIcon,
} from 'lucide-react'

const O = '#F47920'
const tradeColor = { HVAC: '#3b82f6', Plumbing: '#06b6d4', Electrical: O }

// ── Tab: Subs ─────────────────────────────────────────────────────────────────


export default function SubsTab() {
  const { subs: SUBS = [], jobs = [] } = useData()
  const [filter, setFilter]           = useStickyState('subs.filter', 'all')
  const [tradeFilter, setTradeFilter] = useStickyState('subs.trade', 'all')
  const [search, setSearch]           = useStickyState('subs.search', '')
  const [expandedSub, setExpandedSub] = useState(null)

  // ── Derived ────────────────────────────────────────────────────────────────

  const enriched = useMemo(() => SUBS.map(s => {
    const key = subJobKey(s)
    const subJobs = jobs
      .filter(j => j.subs?.electrical === key || j.subs?.plumbing === key || j.subs?.hvac === key)
      .map(j => ({
        ...j,
        trade: j.subs?.electrical === key ? 'electrical'
             : j.subs?.plumbing === key   ? 'plumbing'
             : 'hvac',
      }))
      .sort((a, b) => jobName(a).localeCompare(jobName(b)))
    const activeJobs = subJobs.filter(j => !['complete', 'completed'].includes(j.status))
    return {
      s,
      verdict:        subComplianceVerdict(s),
      insState:       subInsuranceState(s),
      licState:       subLicenseState(s),
      insDays:        daysUntilDate(s.insExp),
      licDays:        daysUntilDate(s.licExp),
      lastUpdateDays: daysSince(s.lastUpdate),
      subJobs,
      activeJobCount: activeJobs.length,
    }
  }), [SUBS, jobs])

  // KPI counts — derived from full set, not the filtered list.
  const kpis = useMemo(() => {
    const active     = enriched.length
    const approved   = enriched.filter(e => e.verdict.label === 'Approved for work').length
    const missing    = enriched.filter(e => subHasMissingDocs(e.s)).length
    const expired    = enriched.filter(e => subInsuranceExpired(e.s) || subLicenseExpired(e.s)).length
    const expSoon    = enriched.filter(e => subInsuranceExpiringSoon(e.s) || e.licState === 'expiring-60').length
    const tiedToJobs = enriched.filter(e => e.activeJobCount > 0).length
    return { active, approved, missing, expired, expSoon, tiedToJobs }
  }, [enriched])

  // Chip counts (against the unfiltered set so users see real depth).
  const chipCounts = useMemo(() => {
    const out = {}
    SUB_FILTERS.forEach(f => { out[f.id] = enriched.filter(e => subMatchesFilter(e.s, f.id)).length })
    return out
  }, [enriched])

  // Apply chip + trade + search; sort: blocked → pending → approved, then alpha.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched
      .filter(e => subMatchesFilter(e.s, filter))
      .filter(e => tradeFilter === 'all' || e.s.trade === tradeFilter)
      .filter(e => {
        if (!q) return true
        return (e.s.name || '').toLowerCase().includes(q)
            || (e.s.co || '').toLowerCase().includes(q)
            || (e.s.phone || '').toLowerCase().includes(q)
            || (e.s.lic || '').toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => {
        const verdictRank = v =>
          v === 'Do not assign'             ? 0 :
          v === 'Compliance review needed'  ? 1 : 2
        const r = verdictRank(a.verdict.label) - verdictRank(b.verdict.label)
        if (r !== 0) return r
        return (a.s.name || '').localeCompare(b.s.name || '')
      })
  }, [enriched, filter, tradeFilter, search])

  const filterChips = SUB_FILTERS.map(f => ({
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
        eyebrow="Subs"
        title="Compliance & assignments"
        subtitle="Active subcontractors, compliance status, and live job assignments — protect against insurance lapse."
        meta={
          <>
            <LiveDot />
            <span>{kpis.active} subs · {kpis.approved} approved</span>
            {kpis.expired > 0 && (
              <span className="text-red-300">{kpis.expired} expired</span>
            )}
            {kpis.missing > 0 && (
              <span className="text-amber-300">{kpis.missing} missing docs</span>
            )}
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => exportToCsv('p2-subs', [
              { label: 'Name',            get: item => item.s.name || '' },
              { label: 'Trade',           get: item => item.s.trade || '' },
              { label: 'Contact',         get: item => item.s.contact || '' },
              { label: 'Phone',           get: item => item.s.phone || '' },
              { label: 'Email',           get: item => item.s.email || '' },
              { label: 'W-9',             get: item => item.s.w9 ? 'yes' : 'no' },
              { label: 'Insurance Exp',   get: item => item.s.insExp || '' },
              { label: 'License Exp',     get: item => item.s.licExp || '' },
              { label: 'Compliance',      get: item => item.verdict?.label || '' },
              { label: 'Score',           get: item => item.s.score ?? '' },
              { label: 'Active Jobs',     get: item => item.activeJobCount ?? 0 },
            ], visible)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            title="Export the current subs list to CSV"
          >
            <DownloadIcon size={13} /> Export
          </button>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Subcontractor compliance"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Active Subs"
          value={kpis.active}
          Icon={UsersRoundIcon}
          sub={kpis.tiedToJobs > 0 ? `${kpis.tiedToJobs} tied to active jobs` : 'On the roster'}
        />
        <MetricTile
          label="Approved"
          value={kpis.approved}
          Icon={ShieldCheckIcon}
          emphasis={kpis.approved > 0 ? 'success' : 'mute'}
          sub={kpis.approved > 0 ? 'Cleared to work' : 'No subs cleared yet'}
        />
        <MetricTile
          label="Missing Documents"
          value={kpis.missing}
          Icon={FileTextIcon}
          emphasis={kpis.missing > 0 ? 'warning' : 'success'}
          sub={kpis.missing > 0 ? 'W-9 not on file' : 'All W-9s on file'}
        />
        <MetricTile
          label="Expired Insurance"
          value={kpis.expired}
          Icon={TriangleAlertIcon}
          emphasis={kpis.expired > 0 ? 'critical' : 'success'}
          sub={kpis.expired > 0 ? 'Do not assign' : 'No expired coverage'}
        />
        <MetricTile
          label="Expiring Soon"
          value={kpis.expSoon}
          Icon={ClockIcon}
          emphasis={kpis.expSoon > 0 ? 'warning' : 'success'}
          sub={kpis.expSoon > 0 ? 'Within 60 days' : 'No upcoming expirations'}
        />
      </section>

      {/* Filters — chips + trade select + search + clear */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search sub, company, phone, license…"
        chips={filterChips}
        trailing={
          <>
            <SavedViewSelect
              scope="subs"
              currentPayload={{ filter, tradeFilter, search: search.trim() }}
              onApply={v => {
                setFilter(v.filter ?? 'all')
                setTradeFilter(v.tradeFilter ?? 'all')
                setSearch(v.search ?? '')
              }}
              savePrompt='Name this subs view (e.g. "Expiring HVAC")'
            />
            <select
              value={tradeFilter}
              onChange={e => setTradeFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Filter by trade"
            >
              {TRADE_FILTERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
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

      {/* Subcontractor queue */}
      <DataPanel
        title="Subcontractor queue"
        description={
          visible.length === 0
            ? 'No subs match the current filters.'
            : `${visible.length} of ${enriched.length} sub${enriched.length === 1 ? '' : 's'}`
        }
        Icon={UsersRoundIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <SubsEmptyState
              filter={filter}
              hasOtherFilters={tradeFilter !== 'all' || search.trim() !== ''}
              onClear={() => { setFilter('all'); setTradeFilter('all'); setSearch('') }}
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(item => (
              <li key={item.s.id}>
                <SubRow
                  item={item}
                  expanded={expandedSub === item.s.id}
                  onToggle={() => setExpandedSub(expandedSub === item.s.id ? null : item.s.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function SubsEmptyState({ filter, hasOtherFilters, onClear }) {
  if (hasOtherFilters) {
    return (
      <EmptyState
        Icon={UsersRoundIcon}
        title="No subs match"
        description="Try clearing the search or trade filter."
        action={onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/15 text-zinc-200 hover:text-white hover:border-white/30 transition-colors"
          >
            Clear all filters
          </button>
        )}
      />
    )
  }
  if (filter === 'approved')        return <EmptyState   title="No approved subs" description="No subcontractors are currently cleared for work." />
  if (filter === 'pending')         return <AllClearState title="No compliance reviews pending" description="No subs flagged for review." />
  if (filter === 'blocked')         return <AllClearState title="No subs blocked" description="No compliance issues are blocking assignment right now." />
  if (filter === 'missing-docs')    return <AllClearState title="All W-9s on file" description="Every sub has a W-9 collected." />
  if (filter === 'expired')         return <AllClearState title="No expired insurance" description="No expired insurance or license documents on the roster." />
  if (filter === 'expiring-soon')   return <AllClearState title="No upcoming expirations" description="No insurance or license expiring within 60 days." />
  return <EmptyState Icon={UsersRoundIcon} title="No subs yet" description="Subcontractors will appear here once they're on the roster." />
}

function SubRow({ item, expanded, onToggle }) {
  const { s, verdict, insState, licState, insDays, licDays, lastUpdateDays, subJobs, activeJobCount } = item
  const tColor   = tradeColor[s.trade] || '#9ca3af'
  const initials = (s.name || '—').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const action   = subNextAction(s)

  // Severity rail color follows the verdict — critical/warning/success.
  const railColor = verdict.tone === 'critical' ? '#ef4444'
                  : verdict.tone === 'warning'  ? '#eab308'
                  : '#22c55e'

  const insColor = insState === 'expired'         ? '#ef4444'
                 : insState === 'expiring-30'     ? '#ef4444'
                 : insState === 'expiring-60'     ? '#eab308'
                 : insState === 'valid'           ? '#22c55e'
                 : '#9ca3af'

  const licColor = licState === 'expired'         ? '#ef4444'
                 : licState === 'expiring-60'     ? '#eab308'
                 : licState === 'valid'           ? '#22c55e'
                 : '#9ca3af'

  const insLabel = insState === 'expired'      ? `${Math.abs(insDays || 0)}d ago`
                 : insState === 'expiring-30'  ? `${insDays}d left`
                 : insState === 'expiring-60'  ? `${insDays}d left`
                 : insState === 'valid'        ? fmtSubDate(s.insExp)
                 : '—'

  const licLabel = licState === 'expired'      ? `${Math.abs(licDays || 0)}d ago`
                 : licState === 'expiring-60'  ? `${licDays}d left`
                 : licState === 'valid'        ? fmtSubDate(s.licExp)
                 : '—'

  const score = s.score ?? null
  const scoreColor = score === null ? '#9ca3af'
                   : score >= 90 ? '#22c55e'
                   : score >= 80 ? O
                   : '#ef4444'

  const updateColor = lastUpdateDays === null ? '#9ca3af'
                    : lastUpdateDays > 5 ? '#ef4444'
                    : lastUpdateDays > 2 ? '#eab308'
                    : '#22c55e'
  const updateLabel = lastUpdateDays === null ? 'No data'
                    : lastUpdateDays === 0    ? 'Today'
                    : lastUpdateDays === 1    ? '1d ago'
                    : `${lastUpdateDays}d ago`

  const handleKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button') && !e.target.closest('[role="combobox"]') && !e.target.closest('select') && !e.target.closest('textarea')) {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('select') || e.target.closest('textarea')) return
          onToggle()
        }}
        onKeyDown={handleKey}
        className="px-4 py-4 sm:px-5 cursor-pointer transition-colors hover:bg-white/[0.025] focus:outline-none focus:bg-white/[0.04]"
        style={{ borderLeft: `3px solid ${railColor}` }}
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-3">
          {/* Avatar with trade color */}
          <div
            className="shrink-0 mt-0.5 flex items-center justify-center rounded-full text-[11px] font-bold"
            style={{ width: 36, height: 36, backgroundColor: tColor + '22', color: tColor }}
          >
            {initials}
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            {/* Header row — name + trade pill + verdict + active job count */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold text-white truncate">{s.name || '—'}</span>
              <span
                className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ color: tColor, backgroundColor: tColor + '22', border: `1px solid ${tColor}55` }}
              >
                {s.trade}
              </span>
              <Pill tone={verdict.tone} size="xs">{verdict.label}</Pill>
              {activeJobCount > 0 && (
                <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">
                  {activeJobCount} active job{activeJobCount === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {/* Identity line — company / license / phone */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 mb-2">
              {s.co && <span className="truncate max-w-[280px]">{s.co}</span>}
              {s.lic && <span>{s.lic}</span>}
              {s.phone && (
                <a
                  href={`tel:${s.phone}`}
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-zinc-300 hover:text-white"
                >
                  <PhoneIcon size={11} /> {s.phone}
                </a>
              )}
            </div>

            {/* Compliance grid — Insurance / License / Score / Last update */}
            <div className="grid gap-2 mb-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
              <ComplianceCell label="Insurance" valueLabel={insLabel} colorOverride={insColor} stateNote={insState === 'expired' ? 'Expired' : insState === 'expiring-30' ? 'Expiring' : insState === 'expiring-60' ? 'Expiring soon' : insState === 'valid' ? 'Valid' : 'No data'} />
              <ComplianceCell label="License" valueLabel={licLabel} colorOverride={licColor} stateNote={licState === 'expired' ? 'Expired' : licState === 'expiring-60' ? 'Expiring soon' : licState === 'valid' ? 'Valid' : 'No data'} />
              <ComplianceCell label="Score" valueLabel={score === null ? '—' : `${score}`} colorOverride={scoreColor} stateNote={score === null ? 'No score' : score >= 90 ? 'Excellent' : score >= 80 ? 'Watch' : 'Below threshold'} />
              <ComplianceCell label="Last update" valueLabel={updateLabel} colorOverride={updateColor} stateNote={lastUpdateDays === null ? 'No data' : lastUpdateDays > 5 ? 'Field update needed' : lastUpdateDays > 2 ? 'Reach out today' : 'Fresh'} />
            </div>

            {/* W-9 status + next action */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {s.w9
                ? <Pill tone="success" size="xs" Icon={CheckCircleIcon}>W-9 on file</Pill>
                : <Pill tone="critical" size="xs" Icon={AlertCircleIcon}>W-9 missing</Pill>}
              {insState === 'expired' && <Pill tone="critical" size="xs" Icon={TriangleAlertIcon}>Insurance expired</Pill>}
              {(insState === 'expiring-30' || insState === 'expiring-60') && <Pill tone="warning" size="xs" Icon={ClockIcon}>Insurance expiring</Pill>}
              {licState === 'expired' && <Pill tone="critical" size="xs" Icon={TriangleAlertIcon}>License expired</Pill>}
            </div>

            <div className="flex items-start gap-1.5 mt-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-px">Next</span>
              <p
                className="text-[12px] font-semibold leading-snug min-w-0"
                style={{ color: railColor }}
                title={action}
              >
                {action}
              </p>
            </div>
          </div>

          {/* Expand chevron */}
          <ChevronRightIcon
            size={16}
            className="hidden md:block shrink-0 text-zinc-400 mt-1.5 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        </div>
      </div>

      {expanded && <SubAssignments subJobs={subJobs} />}
    </div>
  )
}

function ComplianceCell({ label, valueLabel, colorOverride, stateNote }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 truncate">{label}</p>
      <p className="text-sm font-semibold tabular-nums truncate" style={{ color: colorOverride || '#fff' }}>
        {valueLabel}
      </p>
      {stateNote && <p className="text-[10px] text-zinc-400 truncate">{stateNote}</p>}
    </div>
  )
}

function SubAssignments({ subJobs }) {
  if (!subJobs || subJobs.length === 0) {
    return (
      <div className="px-4 sm:px-5 pb-4">
        <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.015] py-6 text-center">
          <p className="text-[11px] text-zinc-400">No active job assignments found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-5 pb-4 -mt-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Job assignments</p>
      <ul className="space-y-2">
        {subJobs.map(j => <SubAssignmentRow key={`${j.id}_${j.trade}`} job={j} />)}
      </ul>
    </div>
  )
}

function SubAssignmentRow({ job: j }) {
  const subStatus = (j.subsStatus || {})[j.trade] || 'active'
  const looseEnds = (j.subsLooseEnds || {})[j.trade] || ''
  const sc = SUB_STATUS_COLOR[subStatus] || '#6b7280'
  const tradeKey  = j.trade.charAt(0).toUpperCase() + j.trade.slice(1)
  const tColor    = tradeColor[tradeKey] || '#9ca3af'
  const isComplete = ['complete', 'completed'].includes(j.status)

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {j.id}
          </span>
          <span className="text-sm font-semibold text-white truncate">{jobName(j)}</span>
          <span
            className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap"
            style={{ color: tColor, backgroundColor: tColor + '22', border: `1px solid ${tColor}55` }}
          >
            {j.trade}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          <Select
            value={subStatus}
            onValueChange={v => j._docId && updateJob(j._docId, { [`subsStatus.${j.trade}`]: v })}
          >
            <SelectTrigger
              className="h-auto py-0.5 px-2.5 text-[11px] font-bold border rounded-full"
              style={{ backgroundColor: sc + '22', color: sc, borderColor: sc + '55' }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUB_STATUS_OPTIONS.map(o => (
                <SelectItem key={o} value={o} className="capitalize">{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isComplete && <StatusBadge status={j.status} />}
        </div>
      </div>
      <Textarea
        className="bg-white/[0.04] border-white/10 text-[12px] resize-none min-h-14 placeholder:text-zinc-400"
        placeholder="Loose ends — incomplete work, punch list items, notes…"
        value={looseEnds}
        onClick={e => e.stopPropagation()}
        onChange={e => j._docId && updateJob(j._docId, { [`subsLooseEnds.${j.trade}`]: e.target.value })}
      />
    </li>
  )
}
