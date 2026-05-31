import { useMemo } from 'react'
import { useData } from '../DataContext'
import { updateNotification } from '../hooks/useFirestore'
import { useToast } from '@/components/ui/toast'
import { useStickyState } from '../lib/useStickyState'
import { exportToCsv } from '../lib/exportCsv'
import {
  PageHeader, MetricTile, DataPanel, Pill, LiveDot,
  EmptyState, AllClearState, FilterBar,
} from './shared'
import {
  NOTIF_FILTERS, notifIsWithinHours, notifMatchesFilter,
  notifTimestampMs, fmtNotifTime,
  NOTIF_TYPE_META, NOTIF_CATEGORY_LABEL, NOTIF_CATEGORY_ICON,
  notifCategory, notifAgeLabel,
} from '../lib/notifications'
import {
  ActivityIcon, AlertCircleIcon, BellIcon, CatIcon, CheckIcon,
  ClipboardListIcon, DownloadIcon, InfoIcon, TrashIcon, TriangleAlertIcon, TypeIcon,
} from 'lucide-react'

const O = '#F47920'

// ── Tab: Notifications ────────────────────────────────────────────────────────


export default function Notifications() {
  const { notifs = [] } = useData()
  const [filter, setFilter] = useStickyState('notifications.filter', 'all')
  const toast = useToast()

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
    const docId = n._docId
    const wasRead = !!n.read
    updateNotification(docId, { dismissed: true, read: true })
    toast({
      tone: 'info',
      title: 'Notification dismissed',
      description: (n.msg || '').slice(0, 60),
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => updateNotification(docId, { dismissed: false, read: wasRead }),
      },
    })
  }
  const markAll = () => {
    live.filter(n => !n.read && n._docId).forEach(n => updateNotification(n._docId, { read: true }))
  }
  const dismissAll = () => {
    const targets = visible.filter(n => n._docId)
    if (targets.length === 0) return
    if (!window.confirm(`Dismiss ${targets.length} notification${targets.length === 1 ? '' : 's'}?`)) return
    // Snapshot read state per-doc so Undo restores exactly what was there.
    const snapshot = targets.map(n => ({ docId: n._docId, wasRead: !!n.read }))
    snapshot.forEach(s => updateNotification(s.docId, { dismissed: true, read: true }))
    toast({
      tone: 'info',
      title: `Dismissed ${targets.length} notification${targets.length === 1 ? '' : 's'}`,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => snapshot.forEach(s => updateNotification(s.docId, { dismissed: false, read: s.wasRead })),
      },
    })
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
            <LiveDot />
            <span>{kpis.total} live</span>
            {kpis.unread > 0 && <span>{kpis.unread} unread</span>}
            {kpis.actionNeeded > 0 && (
              <span className="text-amber-300">{kpis.actionNeeded} need attention</span>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => exportToCsv('p2-notifications', [
                { label: 'When',     get: n => { const ms = notifTimestampMs(n); return ms ? new Date(ms).toISOString() : '' } },
                { label: 'Type',     get: n => n.type || '' },
                { label: 'Category', get: n => NOTIF_CATEGORY_LABEL[notifCategory(n)] || '' },
                { label: 'Message',  get: n => n.msg || '' },
                { label: 'Read',     get: n => n.read ? 'yes' : 'no' },
              ], visible)}
              disabled={visible.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Export the current notifications view to CSV"
            >
              <DownloadIcon size={13} /> Export
            </button>
            {kpis.unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
              >
                <CheckIcon size={13} /> Mark all read
              </button>
            )}
            {visible.length > 0 && (
              <button
                type="button"
                onClick={dismissAll}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-red-400/40 transition-colors"
                title="Dismiss every notification in the current view"
              >
                <TrashIcon size={13} /> Dismiss all
              </button>
            )}
          </>
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
          <span className="text-[10px] text-zinc-400">·</span>
          <span className="text-[10px] text-zinc-400">{notifAgeLabel(n)}</span>
        </div>
        <p className={`text-sm leading-snug ${n.read ? 'text-zinc-300' : 'font-semibold text-white'}`}>
          {n.msg}
        </p>
        {fmtNotifTime(n) && (
          <p className="text-[11px] text-zinc-400 mt-0.5">{fmtNotifTime(n)}</p>
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
