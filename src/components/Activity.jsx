import { useMemo, useState } from 'react'
import { useData } from '../DataContext'
import { useHistory } from '../hooks/useFirestore'
import { exportToCsv } from '../lib/exportCsv'
import { PageHeader, DataPanel, Pill, EmptyState, STATUS_COLORS } from './shared'
import {
  ActivityIcon, FilePenLineIcon, BadgeCheckIcon, DollarSignIcon,
  BellIcon, HardHatIcon, InfoIcon, DownloadIcon,
} from 'lucide-react'

const O = STATUS_COLORS.brand

const TYPE_META = {
  'change-order': { Icon: FilePenLineIcon, color: STATUS_COLORS.brand },
  inspection:     { Icon: BadgeCheckIcon,  color: STATUS_COLORS.success },
  billing:        { Icon: DollarSignIcon,  color: STATUS_COLORS.info },
  job:            { Icon: HardHatIcon,     color: STATUS_COLORS.warning },
  notification:   { Icon: BellIcon,        color: STATUS_COLORS.neutral },
  default:        { Icon: InfoIcon,        color: STATUS_COLORS.neutral },
}

function toMs(v) {
  if (!v) return 0
  if (typeof v?.toMillis === 'function') return v.toMillis()
  const d = new Date(v)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

function relTime(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const NOTIF_TYPE_MAP = { success: 'inspection', warn: 'job', error: 'job', info: 'notification' }

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
function dayBucket(ts) {
  if (!ts) return 'Earlier'
  const today = startOfDay(Date.now())
  const day = startOfDay(ts)
  const diff = Math.round((today - day) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7)   return 'Earlier this week'
  if (diff < 30)  return 'Earlier this month'
  return 'Older'
}

export default function Activity() {
  const { notifs = [] } = useData()
  const { history } = useHistory()
  const [filter, setFilter] = useState('all')

  const feed = useMemo(() => {
    const items = []
    history.forEach(h => items.push({
      id: `h_${h._docId}`,
      ts: toMs(h.createdAt),
      type: h.type || 'default',
      text: h.summary || h.desc || `${h.entity || ''} ${h.action || 'updated'}`.trim(),
      actor: h.actor || h.by || null,
      jobId: h.jobId || h.entity || null,
      source: 'change',
    }))
    notifs.forEach(n => items.push({
      id: `n_${n._docId || n.id}`,
      ts: toMs(n.createdAt),
      type: NOTIF_TYPE_MAP[n.type] || 'notification',
      text: n.msg || '',
      actor: null,
      jobId: null,
      source: 'event',
    }))
    return items.filter(i => i.text).sort((a, b) => b.ts - a.ts)
  }, [history, notifs])

  const filtered = filter === 'all' ? feed : feed.filter(i => i.source === filter)

  const chips = [
    { id: 'all',    label: 'All',     count: feed.length },
    { id: 'change', label: 'Changes', count: feed.filter(i => i.source === 'change').length },
    { id: 'event',  label: 'Events',  count: feed.filter(i => i.source === 'event').length },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Activity"
        title="Activity log"
        subtitle="Chronological feed of changes and system events across the workspace."
        meta={<><span>{feed.length} entries</span></>}
        actions={
          <button
            type="button"
            onClick={() => exportToCsv('p2-activity', [
              { label: 'When',   get: i => i.ts ? new Date(i.ts).toISOString() : '' },
              { label: 'Source', key: 'source' },
              { label: 'Type',   key: 'type' },
              { label: 'Detail', key: 'text' },
              { label: 'Actor',  get: i => i.actor || '' },
              { label: 'Job',    get: i => i.jobId || '' },
            ], filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Export the current activity view to CSV"
          >
            <DownloadIcon size={13} /> Export CSV
          </button>
        }
      />

      <div className="flex gap-1.5 flex-wrap">
        {chips.map(c => {
          const active = filter === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap transition-colors"
              style={{
                borderColor: active ? O + '88' : 'rgba(255,255,255,0.10)',
                backgroundColor: active ? O + '22' : 'transparent',
                color: active ? O : '#d4d4d8',
              }}
            >
              {c.label}{c.count > 0 && <span className="ml-1.5 opacity-70">{c.count}</span>}
            </button>
          )
        })}
      </div>

      <DataPanel title="Recent activity" Icon={ActivityIcon} padding="none">
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState Icon={ActivityIcon} title="No activity yet" description="Approvals, status changes, and system events will appear here as they happen." />
          </div>
        ) : (
          (() => {
            // Group the (capped) feed by relative day so the list reads like
            // a timeline rather than an undifferentiated stream.
            const slice = filtered.slice(0, 100)
            const order = ['Today', 'Yesterday', 'Earlier this week', 'Earlier this month', 'Older', 'Earlier']
            const grouped = slice.reduce((acc, item) => {
              const key = dayBucket(item.ts)
              ;(acc[key] ||= []).push(item)
              return acc
            }, {})
            return order.filter(k => grouped[k]).map(k => (
              <div key={k}>
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">{k}</p>
                <ul className="divide-y divide-white/5">
                  {grouped[k].map(item => {
                    const meta = TYPE_META[item.type] || TYPE_META.default
                    const Icon = meta.Icon
                    const clickable = Boolean(item.jobId)
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={() => clickable && window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: item.jobId } }))}
                          className="w-full text-left flex items-start gap-3 px-4 py-3 transition-colors disabled:cursor-default enabled:hover:bg-white/[0.02]"
                        >
                          <div className="shrink-0 flex items-center justify-center rounded-lg mt-0.5" style={{ width: 30, height: 30, backgroundColor: meta.color + '22', color: meta.color }}>
                            <Icon size={14} aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-zinc-100 leading-snug">{item.text}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {item.actor && <span className="text-[11px] text-zinc-400">{item.actor}</span>}
                              <span className="text-[11px] text-zinc-400">{relTime(item.ts)}</span>
                              {item.jobId && <Pill tone="neutral" size="xs">{item.jobId}</Pill>}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          })()
        )}
      </DataPanel>
    </div>
  )
}
