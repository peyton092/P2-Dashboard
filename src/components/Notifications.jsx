import { useMemo, useState } from 'react'
import {
  CheckIcon, BellIcon, TriangleAlertIcon, ActivityIcon,
  AlertCircleIcon, ClipboardListIcon, InfoIcon, XIcon,
} from 'lucide-react'
import { useData } from '../DataContext'
import { updateNotification } from '../hooks/useFirestore'
import {
  PageHeader, MetricTile, DataPanel, Pill,
  EmptyState, AllClearState, FilterBar,
} from './shared'
import {
  NOTIF_TYPE_META, NOTIF_FILTERS, NOTIF_CATEGORY_LABEL, NOTIF_CATEGORY_ICON,
  notifCategory, notifMatchesFilter, notifTimestampMs, fmtNotifTime,
  notifAgeLabel, notifIsWithinHours,
} from '../lib/notifications'

// Phase 21 — extracted from src/App.jsx. Behavior preserved exactly. Notification
// helpers continue to live in src/lib/notifications.js (Phase 18). The brand
// orange constant is kept local to avoid coupling to App.jsx.

const O = '#F47920'

export default function Notifications() {
  const { notifs = [] } = useData()
  const [filter, setFilter] = useState('all')

  // Live = not dismissed. Dismiss is the user's "clear" gesture; archived
  // notifications drop out of view (matches modern notification-center UX).
  const live = useMemo(() => notifs.filter(n => !n.dismissed), [notifs])

  // KPI counts — derived from `live`, NOT the filtered list.
  const kpis = useMemo(() => {
    const unread       = live.filter(n => !n.read).length
    const actionNeeded = live.filter(n => !n.read && (n.type === 'error' || n.type === 'warn')).length
    const recent       = live.filter(n => notifIsWithinHours(n, 24)).length
    const critical     = live.filter(n => n.type === 'error').length
    return { unread, actionNeeded, recent, critical, total: live.length }
  }, [live])

  // Chip counts (reflect what would show under each chip).
  const chipCounts = useMemo(() => {
    const out = {}
    NOTIF_FILTERS.forEach(f => { out[f.id] = live.filter(n => notifMatchesFilter(n, f.id)).length })
    return out
  }, [live])

  // Visible list — filter + sort: unread first, then newest first within each.
  const visible = useMemo(() => {
    return live
      .filter(n => notifMatchesFilter(n, filter))
      .slice()
      .sort((a, b) => {
        if (!!a.read !== !!b.read) return a.read ? 1 : -1
        return (notifTimestampMs(b) ?? 0) - (notifTimestampMs(a) ?? 0)
      })
  }, [live, filter])

  // Lifecycle mutations — preserved verbatim from prior implementation.
  const markRead = (n) => {
    if (n.read || !n._docId) return
    updateNotification(n._docId, { read: true })
  }
  const dismiss = (n) => {
    if (!n._docId) return
    updateNotification(n._docId, { dismissed: true, read: true })
  }
  const markAll = () => {
    live.filter(n => !n.read && n._docId).forEach(n => updateNotification(n._docId, { read: true }))
  }

  const filterChips = NOTIF_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Notification center"
        subtitle="Recent activity across active jobs — read, action, or clear from the queue."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.total} live</span>
            {kpis.unread > 0 && <span>{kpis.unread} unread</span>}
            {kpis.actionNeeded > 0 && (
              <span className="text-amber-300">{kpis.actionNeeded} need attention</span>
            )}
          </>
        }
        actions={
          kpis.unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              <CheckIcon size={13} /> Mark all read
            </button>
          )
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Notification pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Unread"
          value={kpis.unread}
          Icon={BellIcon}
          emphasis={kpis.unread > 0 ? 'warning' : 'success'}
          sub={kpis.unread > 0 ? 'Review and clear' : 'All caught up'}
        />
        <MetricTile
          label="Action Needed"
          value={kpis.actionNeeded}
          Icon={TriangleAlertIcon}
          emphasis={kpis.actionNeeded > 0 ? 'critical' : 'success'}
          sub={kpis.actionNeeded > 0 ? 'Warning + error' : 'Nothing flagged'}
        />
        <MetricTile
          label="Recent Updates"
          value={kpis.recent}
          Icon={ActivityIcon}
          emphasis={kpis.recent > 0 ? 'default' : 'mute'}
          sub="Last 24 hours"
        />
        <MetricTile
          label="Critical"
          value={kpis.critical}
          Icon={AlertCircleIcon}
          emphasis={kpis.critical > 0 ? 'critical' : 'success'}
          sub={kpis.critical > 0 ? 'System errors' : 'No errors'}
        />
        <MetricTile
          label="Total Live"
          value={kpis.total}
          Icon={ClipboardListIcon}
          emphasis={kpis.total > 0 ? 'default' : 'success'}
          sub={`${notifs.length} ever`}
        />
      </section>

      {/* Filters */}
      <FilterBar
        chips={filterChips}
        trailing={filter !== 'all' && (
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
          >
            Clear
          </button>
        )}
      />

      {/* Notification queue */}
      <DataPanel
        title="Recent activity"
        description={
          visible.length === 0
            ? 'No notifications match the current filter.'
            : `${visible.length} of ${live.length} shown`
        }
        Icon={BellIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <NotificationsEmptyState filter={filter} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(n => (
              <li key={n._docId || n.id || n.msg}>
                <NotificationCard n={n} onRead={markRead} onDismiss={dismiss} />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function NotificationsEmptyState({ filter }) {
  if (filter === 'unread')        return <AllClearState title="All caught up" description="No unread notifications." />
  if (filter === 'action-needed') return <AllClearState title="Nothing needs attention" description="No warning or error notifications outstanding." />
  if (filter === 'billing')       return <EmptyState   title="No billing notifications" description="Billing updates will appear here when posted." />
  if (filter === 'change-orders') return <EmptyState   title="No change-order notifications" description="CO approvals and revisions land here." />
  if (filter === 'inspections')   return <EmptyState   title="No inspection notifications" description="Inspection results and rework alerts land here." />
  if (filter === 'system')        return <EmptyState   title="No system notifications" description="System updates and errors land here." />
  if (filter === 'read')          return <EmptyState   title="Nothing read yet" description="Notifications you mark read will move here." />
  return <AllClearState title="No notifications" description="You're all caught up." />
}

function NotificationCard({ n, onRead, onDismiss }) {
  const meta = NOTIF_TYPE_META[n.type] || NOTIF_TYPE_META.info
  const cat = notifCategory(n)
  const CatIcon = NOTIF_CATEGORY_ICON[cat] || InfoIcon
  const TypeIcon = meta.Icon

  // Outer is a clickable div (not <button>) so we can nest the <button>
  // dismiss action without invalid HTML. Keyboard support via role/tabIndex.
  const handleKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) {
      e.preventDefault()
      onRead(n)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { if (!e.target.closest('button')) onRead(n) }}
      onKeyDown={handleKey}
      className={`flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4 cursor-pointer transition-colors hover:bg-white/[0.025] focus:outline-none focus:bg-white/[0.04] ${n.read ? 'opacity-60' : ''}`}
      style={{ borderLeft: `3px solid ${n.read ? 'transparent' : meta.color}` }}
      aria-label={n.read ? `Notification: ${n.msg}` : `Unread notification: ${n.msg}`}
    >
      {/* Type icon tile */}
      <div
        className="shrink-0 mt-0.5 flex items-center justify-center rounded-lg"
        style={{ width: 32, height: 32, backgroundColor: meta.color + '22', color: meta.color }}
      >
        <TypeIcon size={16} strokeWidth={2} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <Pill tone={meta.tone} size="xs">{meta.label}</Pill>
          <Pill tone="neutral" size="xs" Icon={CatIcon}>{NOTIF_CATEGORY_LABEL[cat]}</Pill>
          <span className="text-[10px] text-zinc-500">·</span>
          <span className="text-[10px] text-zinc-400">{notifAgeLabel(n)}</span>
        </div>
        <p className={`text-sm leading-snug ${n.read ? 'text-zinc-300' : 'font-semibold text-white'}`}>
          {n.msg}
        </p>
        {fmtNotifTime(n) && (
          <p className="text-[11px] text-zinc-500 mt-0.5">{fmtNotifTime(n)}</p>
        )}
      </div>

      {/* Right column: unread dot + dismiss */}
      <div className="flex items-start gap-1.5 shrink-0">
        {!n.read && (
          <span
            className="w-2 h-2 rounded-full mt-2"
            style={{ backgroundColor: O }}
            aria-label="Unread"
          />
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(n) }}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          title="Clear notification"
          aria-label="Clear notification"
        >
          <XIcon size={14} />
        </button>
      </div>
    </div>
  )
}
