import { useMemo } from 'react'
import {
  TriangleAlertIcon, AlertCircleIcon, DollarSignIcon, FilePenLineIcon,
  PackageIcon, CalendarClockIcon, ClipboardListIcon, CheckIcon, XIcon,
} from 'lucide-react'
import { useData } from '../DataContext'
import { hasFailedInspection } from '../agent/scoring'
import {
  PageHeader, MetricTile, DataPanel, Pill, AllClearState,
} from './shared'
import {
  BRIEF_CATEGORY_META, severityTone, severityColor, buildBriefingItems,
} from '../lib/briefing'

// Phase 22 — extracted from src/App.jsx. Read-only daily operating brief.
// Surfaces the most important things to review before the day starts: job
// risk, inspections, billing, change orders, materials, sub compliance, PM
// workload, and yesterday's crew reports. No write paths — only read
// derivations from useData(). Behavior preserved exactly.
//
// BRIEF_CATEGORY_META, SEVERITY_RANK, severityTone, severityColor, and
// buildBriefingItems live in src/lib/briefing.js (Phase 18).

const CREW_LIST = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']
const TODAY = new Date()
const _yd = new Date(TODAY); _yd.setDate(_yd.getDate() - 1)
const YESTERDAY_STR = _yd.toISOString().slice(0, 10)

export default function MorningBriefing() {
  const {
    dailyReports = [],
    jobs = [],
    subs = [],
    extras = [],
    materials = [],
  } = useData()

  const submittedYesterday = useMemo(
    () => new Set((dailyReports || []).filter(r => r.date === YESTERDAY_STR).map(r => r.crewMember)),
    [dailyReports],
  )

  const items = useMemo(
    () => buildBriefingItems({ jobs, extras, materials, subs }),
    [jobs, extras, materials, subs],
  )

  // KPI counts derived from the briefing items themselves so the strip
  // exactly matches the panels below.
  const kpis = useMemo(() => {
    const byCat = (cat) => items.filter(i => i.category === cat).length
    const failedInsp = jobs.filter(j =>
      !['complete','completed'].includes(j.status) && hasFailedInspection(j),
    ).length
    return {
      needsAction:    items.filter(i => i.category === 'job-risk').length,
      atRisk:         items.filter(i => i.category === 'job-risk' && i.severity !== 'info').length,
      failedInsp,
      billing:        byCat('billing'),
      pendingCO:      byCat('co'),
      materials:      byCat('materials'),
      subsBlocked:    byCat('subs'),
      pmHelp:         byCat('pm'),
      critical:       items.filter(i => i.severity === 'critical').length,
    }
  }, [items, jobs])

  // Group briefing items by category for the section panels.
  const groupedItems = useMemo(() => {
    const out = {}
    for (const i of items) {
      if (!out[i.category]) out[i.category] = []
      out[i.category].push(i)
    }
    return out
  }, [items])

  // Top priority list — first ~12 items (already sorted by severity then age).
  const priorityItems = items.slice(0, 12)

  const dateStr = TODAY.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const submittedCount = CREW_LIST.filter(n => submittedYesterday.has(n)).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Morning Briefing"
        title="Daily operating brief"
        subtitle="What needs attention today, ranked by severity and age. Read top to bottom before the day starts."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{dateStr}</span>
            <span>Middle Tennessee</span>
            {kpis.critical > 0 && (
              <span className="text-red-300">{kpis.critical} critical item{kpis.critical === 1 ? '' : 's'}</span>
            )}
          </>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Briefing summary"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Jobs Needing Action"
          value={kpis.needsAction}
          Icon={TriangleAlertIcon}
          emphasis={kpis.needsAction > 0 ? 'warning' : 'success'}
          sub={kpis.needsAction > 0 ? 'Risk + needs action' : 'No PM issues this morning'}
        />
        <MetricTile
          label="Failed Inspections"
          value={kpis.failedInsp}
          Icon={AlertCircleIcon}
          emphasis={kpis.failedInsp > 0 ? 'critical' : 'success'}
          sub={kpis.failedInsp > 0 ? 'Coordinate rework' : 'No failures'}
        />
        <MetricTile
          label="Billing Blockers"
          value={kpis.billing}
          Icon={DollarSignIcon}
          emphasis={kpis.billing > 0 ? 'warning' : 'success'}
          sub={kpis.billing > 0 ? 'Hold, missing docs, or CO' : 'Clean billing pipe'}
        />
        <MetricTile
          label="Pending Change Orders"
          value={kpis.pendingCO}
          Icon={FilePenLineIcon}
          emphasis={kpis.pendingCO > 0 ? 'warning' : 'mute'}
          sub={kpis.pendingCO > 0 ? 'Awaiting approval' : 'No COs in flight'}
        />
        <MetricTile
          label="Materials Blockers"
          value={kpis.materials}
          Icon={PackageIcon}
          emphasis={kpis.materials > 0 ? 'critical' : 'success'}
          sub={kpis.materials > 0 ? 'Overdue or blocking soon' : 'No materials blocking work'}
        />
      </section>

      {/* Today's priority list — combined feed across all categories */}
      <DataPanel
        title="Today's priority"
        description={
          priorityItems.length === 0
            ? 'Ready for the day. No critical items this morning.'
            : `Top ${priorityItems.length} item${priorityItems.length === 1 ? '' : 's'} — review in order.`
        }
        Icon={CalendarClockIcon}
        padding="none"
      >
        {priorityItems.length === 0 ? (
          <div className="p-5">
            <AllClearState
              title="Ready for the day"
              description="No critical items this morning. All active jobs are on track."
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {priorityItems.map(item => (
              <li key={item.id}>
                <BriefingItem item={item} />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>

      {/* Grouped briefing sections — only show categories that have items */}
      {['job-risk', 'inspections', 'billing', 'co', 'materials', 'subs', 'pm'].map(cat => {
        const list = groupedItems[cat]
        if (!list || list.length === 0) return null
        return (
          <BriefingGroup key={cat} category={cat} items={list} />
        )
      })}

      {/* Yesterday's crew reports — preserved daily ritual signal */}
      <DataPanel
        title={`Yesterday's crew reports — ${YESTERDAY_STR}`}
        description={`${submittedCount} of ${CREW_LIST.length} submitted`}
        Icon={ClipboardListIcon}
        badge={
          <Pill tone={submittedCount === CREW_LIST.length ? 'success' : submittedCount === 0 ? 'critical' : 'warning'} size="xs">
            {submittedCount}/{CREW_LIST.length}
          </Pill>
        }
      >
        <div
          className="grid gap-2 sm:gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}
        >
          {CREW_LIST.map(name => {
            const submitted = submittedYesterday.has(name)
            const tone = submitted ? '#22c55e' : '#ef4444'
            return (
              <div
                key={name}
                className="flex flex-col items-center gap-2 px-3 py-3 rounded-xl border min-w-0"
                style={{
                  borderColor: tone + '44',
                  backgroundColor: tone + '0a',
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: tone + '22' }}
                >
                  {submitted
                    ? <CheckIcon size={18} color={tone} />
                    : <XIcon size={18} color={tone} />}
                </div>
                <p className="text-xs font-semibold text-zinc-100 text-center truncate w-full">{name}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-center" style={{ color: tone }}>
                  {submitted ? 'Submitted' : 'Missing'}
                </p>
              </div>
            )
          })}
        </div>
      </DataPanel>
    </div>
  )
}

function BriefingItem({ item }) {
  const sev = severityTone(item.severity)
  const railColor = severityColor(item.severity)
  const meta = BRIEF_CATEGORY_META[item.category] || BRIEF_CATEGORY_META['job-risk']
  const CatIcon = meta.Icon
  return (
    <div
      className="px-4 py-3 sm:px-5 sm:py-3.5 transition-colors hover:bg-white/[0.015]"
      style={{ borderLeft: `3px solid ${railColor}` }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        {/* Category pill */}
        <Pill tone="neutral" size="xs" Icon={CatIcon} className="mt-0.5 shrink-0">
          {meta.label}
        </Pill>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            {item.jobId && (
              <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
                {item.jobId}
              </span>
            )}
            <span className="text-sm font-semibold text-white truncate min-w-0">
              {item.title}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
            {item.owner && <span>{item.owner}</span>}
            {item.age !== null && item.age !== undefined && (
              <span className="font-semibold" style={{ color: item.age >= 7 ? '#ef4444' : item.age >= 3 ? '#eab308' : '#9ca3af' }}>
                {item.age === 0 ? 'today' : item.age === 1 ? '1d' : `${item.age}d`}
              </span>
            )}
          </div>
          <div className="flex items-start gap-1.5 mt-1.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-px">Next</span>
            <p className="text-[12px] font-semibold leading-snug min-w-0" style={{ color: railColor }} title={item.nextAction}>
              {item.nextAction}
            </p>
          </div>
        </div>

        {/* Severity pill on the right */}
        <Pill tone={sev} size="xs" className="shrink-0 mt-0.5">
          {item.severity === 'critical' ? 'Critical'
           : item.severity === 'warning'  ? 'Needs attention'
           : 'Review today'}
        </Pill>
      </div>
    </div>
  )
}

function BriefingGroup({ category, items }) {
  const meta = BRIEF_CATEGORY_META[category] || BRIEF_CATEGORY_META['job-risk']
  const critical = items.filter(i => i.severity === 'critical').length
  const warning  = items.filter(i => i.severity === 'warning').length
  const description = critical > 0
    ? `${critical} critical${warning > 0 ? `, ${warning} need${warning === 1 ? 's' : ''} attention` : ''}`
    : warning > 0
      ? `${warning} need${warning === 1 ? 's' : ''} attention`
      : `${items.length} item${items.length === 1 ? '' : 's'} to review`

  return (
    <DataPanel
      title={meta.label}
      description={description}
      Icon={meta.Icon}
      badge={
        <Pill tone={critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'info'} size="xs">
          {items.length}
        </Pill>
      }
      padding="none"
    >
      <ul className="divide-y divide-white/5">
        {items.slice(0, 8).map(item => (
          <li key={`group_${item.id}`}>
            <BriefingItem item={item} />
          </li>
        ))}
        {items.length > 8 && (
          <li className="px-4 py-2.5 sm:px-5">
            <p className="text-[11px] text-zinc-400">
              {items.length - 8} more {meta.label.toLowerCase()} item{items.length - 8 === 1 ? '' : 's'} not shown — see the relevant tab for the full queue.
            </p>
          </li>
        )}
      </ul>
    </DataPanel>
  )
}
