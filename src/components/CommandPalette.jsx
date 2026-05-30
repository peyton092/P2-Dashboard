import { useState, useEffect, useMemo, useRef } from 'react'
import { useData } from '../DataContext'
import {
  SearchIcon, GaugeIcon, HardHatIcon, UsersRoundIcon, FilePenLineIcon,
  ClipboardSignatureIcon, BoxesIcon, DollarSignIcon, CornerDownLeftIcon,
  ClockIcon,
} from 'lucide-react'
import { getRecentJobs } from '../lib/recentJobs'

const O = '#F47920'

// Pages a search result can jump to (ids match TAB_COMPONENTS in App.jsx).
const PAGES = [
  { id: 'command-center', label: 'Command Center' },
  { id: 'war-room',       label: 'War Room' },
  { id: 'pm-dashboard',   label: 'PM Dashboard' },
  { id: 'alerts',         label: 'Alerts' },
  { id: 'billing-queue',  label: 'Billing Queue' },
  { id: 'extras',         label: 'Change Orders' },
  { id: 'invoice-auditor',label: 'Invoice Auditor' },
  { id: 'jobs',           label: 'Job Status' },
  { id: 'inspections',    label: 'Inspections' },
  { id: 'daily-report',   label: 'Daily Report' },
  { id: 'morning',        label: 'Morning Briefing' },
  { id: 'materials',      label: 'Materials' },
  { id: 'permits',        label: 'Permits' },
  { id: 'subs',           label: 'Subs' },
  { id: 'folders',        label: 'Documents' },
  { id: 'submit',         label: 'Submit' },
  { id: 'notifications',  label: 'Notifications' },
  { id: 'analytics',      label: 'Reports' },
  { id: 'team',           label: 'Team' },
  { id: 'settings',       label: 'Settings' },
]

const navigate = (id) => window.dispatchEvent(new CustomEvent('p2:navigate', { detail: { id } }))

export default function CommandPalette() {
  const { jobs = [], subs = [], extras = [], materials = [] } = useData()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const reset = () => { setQuery(''); setActive(0) }
  const close = () => { setOpen(false); reset() }

  // Open on Cmd/Ctrl+K, on a 'p2:open-search' event (sidebar button), close on Esc.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => {
          if (o) { setQuery(''); setActive(0) }
          return !o
        })
      } else if (e.key === 'Escape') {
        setOpen(false); setQuery(''); setActive(0)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('p2:open-search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('p2:open-search', onOpen)
    }
  }, [])

  // Focus the input when the palette opens (DOM side-effect only).
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups = []

    // When the palette opens fresh (no query), surface recently-viewed jobs.
    if (!q) {
      const recentIds = getRecentJobs()
      const recentJobs = recentIds
        .map(id => jobs.find(j => j.id === id))
        .filter(Boolean)
        .slice(0, 5)
      if (recentJobs.length) {
        groups.push({
          heading: 'Recent jobs',
          Icon: ClockIcon,
          items: recentJobs.map(j => ({
            key: `recent_${j.id}`,
            title: `${j.id} — ${j.name || j.client || ''}`.trim(),
            sub: j.address || j.pm || '',
            job: j.id,
          })),
        })
      }
    }

    const pageHits = PAGES.filter(p => !q || p.label.toLowerCase().includes(q)).slice(0, q ? 6 : 8)
    if (pageHits.length) groups.push({ heading: 'Pages', Icon: GaugeIcon, items: pageHits.map(p => ({ key: `page_${p.id}`, title: p.label, sub: 'Go to page', tab: p.id })) })

    if (q) {
      const jobHits = jobs.filter(j =>
        [j.id, j.name, j.address, j.client, j.pm, j.permitNumber].some(v => (v || '').toString().toLowerCase().includes(q)),
      ).slice(0, 8)
      if (jobHits.length) groups.push({ heading: 'Jobs', Icon: HardHatIcon, items: jobHits.map(j => ({ key: `job_${j.id}`, title: `${j.id} — ${j.name || j.client || ''}`.trim(), sub: j.address || j.pm || '', job: j.id })) })

      const subHits = subs.filter(s =>
        [s.name, s.co, s.trade].some(v => (v || '').toString().toLowerCase().includes(q)),
      ).slice(0, 6)
      if (subHits.length) groups.push({ heading: 'Subcontractors', Icon: UsersRoundIcon, items: subHits.map(s => ({ key: `sub_${s.id}`, title: s.name, sub: `${s.trade || ''}${s.co ? ` · ${s.co}` : ''}`, tab: 'subs' })) })

      const coHits = extras.filter(e =>
        [e.id, e.desc, e.job].some(v => (v || '').toString().toLowerCase().includes(q)),
      ).slice(0, 6)
      if (coHits.length) groups.push({ heading: 'Change Orders', Icon: FilePenLineIcon, items: coHits.map(e => ({ key: `co_${e._docId || e.id}`, title: `${e.id || 'CO'} — ${e.desc || ''}`.trim(), sub: `${e.job || ''} · $${Number(e.amount || 0).toLocaleString()}`, tab: 'extras' })) })

      const permitHits = jobs.filter(j => (j.permitNumber || '').toString().toLowerCase().includes(q)).slice(0, 5)
      if (permitHits.length) groups.push({ heading: 'Permits', Icon: ClipboardSignatureIcon, items: permitHits.map(j => ({ key: `permit_${j.id}`, title: j.permitNumber, sub: `${j.id} — ${j.address || ''}`, tab: 'permits' })) })

      const matHits = materials.filter(m =>
        [m.item, m.job, m.vendor].some(v => (v || '').toString().toLowerCase().includes(q)),
      ).slice(0, 5)
      if (matHits.length) groups.push({ heading: 'Materials', Icon: BoxesIcon, items: matHits.map(m => ({ key: `mat_${m._docId || m.id}`, title: m.item, sub: `${m.job || ''}${m.vendor ? ` · ${m.vendor}` : ''}`, tab: 'materials' })) })
    }

    return groups
  }, [query, jobs, subs, extras, materials])

  const flat = useMemo(() => results.flatMap(g => g.items), [results])

  const select = (item) => {
    if (!item) return
    if (item.job) window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: item.job } }))
    else navigate(item.tab)
    close()
  }

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); select(flat[active]) }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  let runningIndex = -1

  return (
    <div className="dark fixed inset-0 z-[90] flex items-start justify-center p-4 sm:pt-[12vh] bg-black/60 backdrop-blur-sm" onClick={close}>
      <div
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Search"
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-white/10">
          <SearchIcon size={16} className="text-zinc-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onInputKey}
            placeholder="Search jobs, subs, change orders, permits, pages…"
            className="flex-1 bg-transparent py-3.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none"
            aria-label="Search query"
          />
          <kbd className="hidden sm:inline text-[10px] font-semibold text-zinc-400 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">
              {query ? 'No matches.' : 'Type to search across the workspace.'}
            </p>
          ) : (
            results.map(group => (
              <div key={group.heading} className="mb-1">
                <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <group.Icon size={11} aria-hidden="true" /> {group.heading}
                </p>
                {group.items.map(item => {
                  runningIndex++
                  const idx = runningIndex
                  const isActive = idx === active
                  return (
                    <button
                      key={item.key}
                      data-idx={idx}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => select(item)}
                      className="w-full text-left flex items-center gap-3 px-4 py-2 transition-colors"
                      style={{ backgroundColor: isActive ? O + '1f' : 'transparent' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{item.title}</p>
                        {item.sub && <p className="text-[11px] text-zinc-400 truncate">{item.sub}</p>}
                      </div>
                      {isActive && <CornerDownLeftIcon size={13} className="text-zinc-400 shrink-0" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-t border-white/10 text-[10px] text-zinc-400">
          <span className="flex items-center gap-1"><DollarSignIcon size={11} /> Tip:</span>
          <span>↑↓ to navigate · ↵ to open · ⌘K to toggle</span>
        </div>
      </div>
    </div>
  )
}
