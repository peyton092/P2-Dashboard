import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import { exportToIcs } from '../lib/exportIcs'
import { jobEvents, EVENT_META } from '../lib/jobEvents'
import { PageHeader, Pill } from './shared'
import { ChevronLeftIcon, ChevronRightIcon, CalendarClockIcon, DownloadIcon } from 'lucide-react'

const O = '#F47920'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const openJob = (id) => window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id } }))

export default function Calendar() {
  const { jobs = [] } = useData()
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() } })

  const byDay = useMemo(() => {
    const map = {}
    jobs.forEach(j => jobEvents(j).forEach(e => {
      if (!e.date) return
      ;(map[e.date] ||= []).push(e)
    }))
    return map
  }, [jobs])

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const startDow = first.getDay()
    const gridStart = new Date(cursor.year, cursor.month, 1 - startDow)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return {
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === cursor.month,
        isToday: key === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
        events: byDay[key] || [],
      }
    })
  }, [cursor, byDay, today])

  const monthEventCount = cells.filter(c => c.inMonth).reduce((s, c) => s + c.events.length, 0)

  const shift = (delta) => setCursor(c => {
    const m = c.month + delta
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
  })
  const goToday = () => setCursor({ year: today.getFullYear(), month: today.getMonth() })

  const exportIcs = () => {
    const events = jobs.flatMap(j => jobEvents(j).map((e, i) => ({
      uid: `${e.jobId}-${e.type}-${e.date}-${i}`,
      date: e.date,
      summary: e.label,
      description: (EVENT_META[e.type] || {}).label,
    })))
    exportToIcs('p2-schedule', events)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calendar"
        title="Schedule"
        subtitle="Target completions, job starts, and inspection results across the portfolio."
        meta={<><span>{MONTHS[cursor.month]} {cursor.year}</span><span>{monthEventCount} event{monthEventCount === 1 ? '' : 's'} this month</span></>}
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={exportIcs} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25" title="Download all events as a calendar file (.ics)"><DownloadIcon size={13} /> Export .ics</button>
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="p-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25"><ChevronLeftIcon size={14} /></button>
            <button type="button" onClick={goToday} className="text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25">Today</button>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="p-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25"><ChevronRightIcon size={14} /></button>
          </div>
        }
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(EVENT_META).map(([k, m]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} /> {m.label}
          </span>
        ))}
      </div>

      {/* Month grid */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="grid grid-cols-7 border-b border-white/10">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-400 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => (
            <div
              key={c.key}
              className="min-h-[92px] border-b border-r border-white/5 p-1.5 last:border-r-0"
              style={{ backgroundColor: c.inMonth ? 'transparent' : 'rgba(255,255,255,0.015)', borderRight: (i % 7 === 6) ? 'none' : undefined }}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full"
                  style={c.isToday ? { backgroundColor: O, color: '#fff' } : { color: c.inMonth ? '#d4d4d8' : '#52525b' }}
                >
                  {c.day}
                </span>
                {c.events.length > 3 && <span className="text-[9px] text-zinc-400">+{c.events.length - 3}</span>}
              </div>
              <div className="space-y-1">
                {c.events.slice(0, 3).map((e, idx) => {
                  const m = EVENT_META[e.type] || EVENT_META.target
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openJob(e.jobId)}
                      title={e.label}
                      className="w-full text-left flex items-center gap-1 rounded px-1 py-0.5 text-[10px] truncate hover:bg-white/[0.06] transition-colors"
                      style={{ color: m.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                      <span className="truncate text-zinc-300">{e.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {monthEventCount === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <CalendarClockIcon size={15} /> No scheduled events this month.
          <Pill tone="neutral" size="xs">Try another month</Pill>
        </div>
      )}
    </div>
  )
}
