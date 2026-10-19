import { useId, useState, useEffect, useMemo, useRef } from 'react'
import { useData } from '../use-data'
import {
  SearchIcon, GaugeIcon, HardHatIcon, UsersRoundIcon, FilePenLineIcon,
  ClipboardSignatureIcon, BoxesIcon, DollarSignIcon, CornerDownLeftIcon,
} from 'lucide-react'
import { BRAND, withAlpha } from '@/lib/tokens'

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

// A modal dialog other than the palette, such as a Dialog or a ConfirmDialog, is open. It
// holds focus in itself and hides the page from a screen reader, so the palette does not
// open over it: a palette there could be neither reached nor read.
const modalDialogOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]:not([data-command-palette])')

// The search a person opens with Ctrl or Cmd and K, or with the Search button of the
// sidebar. It is a modal dialog: focus stays in its search box, which is a combobox that
// points at the active option of the results, a listbox. The arrow keys move the active
// option and scroll it into view, Enter opens it, and Escape closes the palette and gives
// focus back to whatever had it before. The pointer makes an option active too, but does
// not scroll the list, which would move the option out from under it.
export default function CommandPalette() {
  const { jobs = [], subs = [], extras = [], materials = [] } = useData()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  // Set by the arrow keys, so that only they scroll the list.
  const scrollToActive = useRef(false)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (idx) => `${baseId}-option-${idx}`

  const reset = () => { setQuery(''); setActive(0) }
  const close = () => { setOpen(false); reset() }

  // Open on Cmd/Ctrl+K, on a 'p2:open-search' event (sidebar button), close on Esc.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (modalDialogOpen()) return
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

  // Focus goes into the search box when the palette opens, and back to what had it before,
  // when that is still on the page, when the palette closes.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      clearTimeout(t)
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus()
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups = []

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
  // The active option, kept inside the list when the results change under it.
  const current = Math.min(active, Math.max(flat.length - 1, 0))

  const select = (item) => {
    if (!item) return
    if (item.job) window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: item.job } }))
    else navigate(item.tab)
    close()
  }

  // An arrow key moves the active option, and only then is the list scrolled to it.
  const move = (to) => {
    if (to === current) return
    scrollToActive.current = true
    setActive(to)
  }

  // Focus stays in the search box, the one control of the palette, so Tab goes nowhere.
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(Math.min(current + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(Math.max(current - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); select(flat[current]) }
    else if (e.key === 'Tab') e.preventDefault()
  }

  useEffect(() => {
    if (!scrollToActive.current) return
    scrollToActive.current = false
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
  })

  if (!open) return null

  let runningIndex = -1
  const listed = flat.length > 0

  return (
    <div className="fixed inset-0 z-(--z-palette) flex items-start justify-center p-4 sm:pt-[12vh] bg-black/60 backdrop-blur-sm" onClick={close}>
      <div
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        data-command-palette=""
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-white/10">
          <SearchIcon size={16} className="text-zinc-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={listed}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={listed ? optionId(current) : undefined}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onInputKey}
            placeholder="Search jobs, subs, change orders, permits, pages…"
            className="flex-1 bg-transparent py-3.5 text-sm text-white placeholder:text-zinc-400 focus-visible:-outline-offset-2"
            aria-label="Search query"
          />
          <kbd className="hidden sm:inline text-[10px] font-semibold text-zinc-400 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        {listed ? (
          <div id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto py-2">
            {results.map((group, groupIdx) => (
              <div key={group.heading} role="group" aria-labelledby={`${baseId}-group-${groupIdx}`} className="mb-1">
                <div id={`${baseId}-group-${groupIdx}`} role="presentation" className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <group.Icon size={11} aria-hidden="true" /> {group.heading}
                </div>
                {group.items.map(item => {
                  runningIndex++
                  const idx = runningIndex
                  const isActive = idx === current
                  // An option is not a stop of its own for Tab: the search box points at it,
                  // and keeps focus when an option is pressed with the pointer.
                  return (
                    <div
                      key={item.key}
                      id={optionId(idx)}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => { if (!isActive) setActive(idx) }}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => select(item)}
                      className="w-full text-left flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors"
                      style={{ backgroundColor: isActive ? withAlpha(BRAND, 0.12) : 'transparent' }}
                    >
                      <span className="block min-w-0 flex-1">
                        <span className="block text-sm text-white truncate">{item.title}</span>
                        {item.sub && <span className="block text-[11px] text-zinc-400 truncate">{item.sub}</span>}
                      </span>
                      {isActive && <CornerDownLeftIcon size={13} className="text-zinc-400 shrink-0" aria-hidden="true" />}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <p role="status" className="px-4 py-8 text-center text-sm text-zinc-400">
            {query ? 'No matches.' : 'Type to search across the workspace.'}
          </p>
        )}

        <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-t border-white/10 text-[10px] text-zinc-400">
          <span className="flex items-center gap-1"><DollarSignIcon size={11} /> Tip:</span>
          <span>↑↓ to navigate · ↵ to open · ⌘K to toggle</span>
        </div>
      </div>
    </div>
  )
}
