import { useState, useMemo } from 'react'
import { useData } from '../use-data'
import { useNow } from '../hooks/useNow'
import { toLocalDateStr } from '../lib/dates'
import { PageHeader, Pill } from './shared'
import { ChevronLeftIcon, ChevronRightIcon, CalendarClockIcon } from 'lucide-react'
import { BRAND } from '@/lib/tokens'
import { INSPECTION_STATUS, statusColor, statusLabel, toneHex } from '../lib/status'
import { PHASE_LABEL } from '../lib/inspections'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Each kind of event has a color for its dot and a word that is written before it, so what
// an event is never rests on its color: an inspection says Passed or Failed.
const EVENT_META = {
  target: { color: BRAND,                                    word: 'Target',                                   label: 'Target completion' },
  start:  { color: toneHex('info'),                          word: 'Start',                                    label: 'Job start' },
  pass:   { color: statusColor(INSPECTION_STATUS, 'passed'), word: statusLabel(INSPECTION_STATUS, 'passed'), label: 'Inspection passed' },
  fail:   { color: statusColor(INSPECTION_STATUS, 'failed'), word: statusLabel(INSPECTION_STATUS, 'failed'), label: 'Inspection failed' },
}

// The date on a phase is the day its result was recorded, and a phase set back to scheduled,
// pending or any other status keeps that date. Then the day says nothing about the phase, so
// an inspection is on the calendar only while its result stands: passed or failed.
const RESULT_EVENT = { passed: 'pass', failed: 'fail' }

const jobLabel = (j) => j.name || j.client || j.id
const isoDay = (d) => (d || '').toString().slice(0, 10)
const openJob = (id) => window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id } }))

function jobEvents(job) {
  const evs = []
  if (job.target) evs.push({ date: isoDay(job.target), type: 'target', jobId: job.id, label: jobLabel(job) })
  if (job.start)  evs.push({ date: isoDay(job.start),  type: 'start',  jobId: job.id, label: jobLabel(job) })
  const insp = job.insp || {}
  ;['electrical', 'plumbing', 'hvac'].forEach(t => {
    const tr = insp[t] || {}
    ;['roughIn', 'final'].forEach(phase => {
      const type = RESULT_EVENT[tr[phase]]
      const date = tr[`${phase}Date`]
      if (type && date) evs.push({ date: isoDay(date), type, jobId: job.id, label: `${job.id} ${t} ${PHASE_LABEL[phase].toLowerCase()}` })
    })
  })
  return evs
}

export default function Calendar() {
  const { jobs = [] } = useData()
  // The day that is marked moves on at midnight, with the tab left open.
  const now = useNow()
  const todayKey = toLocalDateStr(now)
  const [cursor, setCursor] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }))

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
      const key = toLocalDateStr(d)
      return {
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === cursor.month,
        isToday: key === todayKey,
        events: byDay[key] || [],
      }
    })
  }, [cursor, byDay, todayKey])

  const monthEventCount = cells.filter(c => c.inMonth).reduce((s, c) => s + c.events.length, 0)

  const shift = (delta) => setCursor(c => {
    const m = c.month + delta
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
  })
  const goToday = () => setCursor({ year: now.getFullYear(), month: now.getMonth() })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calendar"
        title="Schedule"
        subtitle="Target completions, job starts, and inspection results across the portfolio."
        meta={<><span>{MONTHS[cursor.month]} {cursor.year}</span><span>{monthEventCount} event{monthEventCount === 1 ? '' : 's'} this month</span></>}
        actions={
          <div className="flex items-center gap-1.5">
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
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} /> {m.label}
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
                {/* Today is filled with the brand color, a day of another month is dimmer. */}
                <span
                  aria-current={c.isToday ? 'date' : undefined}
                  className={`text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full ${
                    c.isToday ? 'bg-brand text-brand-foreground' : c.inMonth ? 'text-zinc-200' : 'text-zinc-400'
                  }`}
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
                      title={`${m.word} ${e.label}`}
                      className="w-full text-left flex items-center gap-1 rounded px-1 py-0.5 text-[10px] truncate hover:bg-white/[0.06] transition-colors"
                    >
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                      <span className="shrink-0 font-semibold text-zinc-100">{m.word}</span>{' '}
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
