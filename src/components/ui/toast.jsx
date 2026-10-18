import { useState, useCallback, useEffect, useRef } from 'react'
import { ToastContext } from './use-toast'
import { CheckCircleIcon, AlertCircleIcon, InfoIcon, XIcon } from 'lucide-react'
import { BRAND, SEMANTIC } from '@/lib/tokens'
import { Button } from './button'

const TONE = {
  success: { color: SEMANTIC.success,  Icon: CheckCircleIcon },
  error:   { color: SEMANTIC.critical, Icon: AlertCircleIcon },
  info:    { color: SEMANTIC.info,     Icon: InfoIcon },
  brand:   { color: BRAND,             Icon: InfoIcon },
}

// How long a toast stays. One that carries an action, such as Undo, stays longer, because
// the person has to read it, decide, and reach the button. duration in the options wins,
// and 0 means it stays until it is dismissed.
const DURATION = 4000
const DURATION_WITH_ACTION = 8000

// The key that takes a person using the keyboard to the newest toast.
const SHORTCUT = 'F8'

let nextId = 0

// What a screen reader says about a toast: the title, then the description, and for a toast
// with an action the label of the action and the key that reaches it. Each part ends with a
// full stop, so that the parts do not run together.
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`)
function spoken(t) {
  const parts = [t.title, t.description].filter(Boolean).map(sentence)
  if (t.action) parts.push(`${t.action.label} available, press ${SHORTCUT}.`)
  return parts.join(' ')
}

// One toast, and the timer that takes it away. The timer runs only while neither the
// pointer is over the toast nor focus is inside it, and starts again from the full
// duration when both have left, so a person who is reading it, or has tabbed to its
// button, is not raced. It is cleared when the toast goes, whichever way it goes.
//
// A toast has no live role of its own. What a screen reader is told is written into the two
// live elements of the region (see ToastProvider), so that it is told once, and the toast on
// the screen is there to be seen and to be reached.
function ToastItem({ t, newest, onDismiss }) {
  const [pointerIn, setPointerIn] = useState(false)
  const [focusIn, setFocusIn] = useState(false)
  const paused = pointerIn || focusIn

  useEffect(() => {
    if (!(t.duration > 0) || paused) return
    const timer = setTimeout(() => onDismiss(t.id), t.duration)
    return () => clearTimeout(timer)
  }, [t.id, t.duration, paused, onDismiss])

  const meta = TONE[t.tone] || TONE.info
  const Icon = meta.Icon

  return (
    <div
      data-toast={t.id}
      onPointerEnter={() => setPointerIn(true)}
      onPointerLeave={() => setPointerIn(false)}
      onFocus={() => setFocusIn(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusIn(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') onDismiss(t.id) }}
      className="pointer-events-auto sm:w-80 sm:ml-auto flex items-start gap-2.5 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur px-3.5 py-3 shadow-xl"
      style={{ borderLeft: `3px solid ${meta.color}` }}
    >
      <Icon size={16} style={{ color: meta.color }} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {t.title && <p className="text-sm font-semibold text-white leading-snug">{t.title}</p>}
        {t.description && <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{t.description}</p>}
      </div>
      {t.action && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-keyshortcuts={SHORTCUT}
          className="shrink-0 -my-1 max-md:min-h-11 focus-visible:ring-2 focus-visible:ring-brand"
          onClick={() => {
            onDismiss(t.id)
            t.action.onClick()
          }}
        >
          {t.action.label}
        </Button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        aria-keyshortcuts={newest && !t.action ? SHORTCUT : undefined}
        onClick={() => onDismiss(t.id)}
        className="shrink-0 -my-1.5 -mr-1.5 inline-flex size-8 max-md:size-11 items-center justify-center rounded-md text-zinc-400 outline-none transition-colors hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <XIcon size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

// useToast() returns toast(options | title). The options are { title, description, tone,
// duration, action }, and action is { label, onClick }: a button on the toast that runs
// onClick and takes the toast away.
//
// What is read out. Screen readers announce a live region reliably only when it was in the
// page before its content changed, and a status element that is inserted already holding its
// words is commonly skipped. So the region holds two visually hidden live elements from the
// first render, one polite (role status) and one assertive (role alert), empty until needed.
// A toast's words go into the assertive one when it is an error and into the polite one
// otherwise, and come out again when the toast goes. The toasts themselves are plain
// elements, so nothing is read twice. Each message sits in a node of its own, keyed by the
// toast, so that a second toast with the same words is a new node and is announced again.
//
// The region itself says aria-live="off", and not nothing, for a reason that has nothing to
// do with reading. A modal dialog hides everything outside itself from a screen reader, and
// the one thing it leaves alone is a branch of the page that holds an aria-live attribute. A
// region with none is hidden when a dialog opens, and then an error toast about the work the
// dialog started (a disconnect that was refused) would be shown and never read. "off" is the
// value that keeps the region in view of the dialog and still announces nothing itself; the
// two live elements inside it set their own live roles, which "off" does not override.
//
// Keyboard. The region is last in the page, so a person using the keyboard would have to tab
// through all of it to reach the Undo on a toast that goes in eight seconds. F8 moves focus
// to the first button of the newest toast, and the toast holds still while focus is in it.
// It does nothing while a modal dialog is open, because a dialog keeps focus inside itself.
// When a toast that holds focus goes, focus returns to the control it came from, or failing
// that to the newest toast left, so that the person does not lose their place.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [said, setSaid] = useState({ polite: null, assertive: null })
  const regionRef = useRef(null)
  // The control that had focus before it went into a toast, to give it back.
  const cameFrom = useRef(null)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== SHORTCUT || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const region = regionRef.current
      const shown = region?.querySelectorAll('[data-toast]')
      const button = shown?.[shown.length - 1]?.querySelector('button')
      if (!button) return
      event.preventDefault()
      const active = document.activeElement
      if (active && active !== document.body && !region.contains(active)) cameFrom.current = active
      button.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const dismiss = useCallback((id) => {
    const region = regionRef.current
    const gone = region?.querySelector(`[data-toast="${id}"]`)
    if (gone?.contains(document.activeElement)) {
      const back = cameFrom.current
      cameFrom.current = null
      if (back?.isConnected && !region.contains(back)) {
        back.focus()
      } else {
        const left = [...region.querySelectorAll('[data-toast]')].filter((el) => el !== gone)
        left[left.length - 1]?.querySelector('button')?.focus()
      }
    }
    setToasts(list => list.filter(t => t.id !== id))
    setSaid(now => ({
      polite: now.polite?.id === id ? null : now.polite,
      assertive: now.assertive?.id === id ? null : now.assertive,
    }))
  }, [])

  const toast = useCallback((opts) => {
    const id = ++nextId
    const base = typeof opts === 'string' ? { title: opts } : (opts || {})
    const t = {
      tone: 'info',
      ...base,
      id,
      duration: base.duration ?? (base.action ? DURATION_WITH_ACTION : DURATION),
    }
    setToasts(list => [...list, t])
    const lane = t.tone === 'error' ? 'assertive' : 'polite'
    setSaid(now => ({ ...now, [lane]: { id, text: spoken(t) } }))
    return id
  }, [])

  // Focus coming into the region from outside, by F8 or by Tab, is remembered, and focus going
  // out to another control is forgotten, so that what is given back is where the person was.
  const onRegionFocus = (event) => {
    const from = event.relatedTarget
    if (from && !event.currentTarget.contains(from)) cameFrom.current = from
  }
  const onRegionBlur = (event) => {
    const to = event.relatedTarget
    if (to && !event.currentTarget.contains(to)) cameFrom.current = null
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        ref={regionRef}
        role="region"
        aria-label="Notifications"
        aria-live="off"
        onFocus={onRegionFocus}
        onBlur={onRegionBlur}
        className="fixed z-(--z-toast) bottom-4 max-md:bottom-20 right-4 left-4 sm:left-auto flex flex-col gap-2 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div role="status" className="sr-only">
          {said.polite && <span key={said.polite.id}>{said.polite.text}</span>}
        </div>
        <div role="alert" className="sr-only">
          {said.assertive && <span key={said.assertive.id}>{said.assertive.text}</span>}
        </div>
        {toasts.map((t, i) => <ToastItem key={t.id} t={t} newest={i === toasts.length - 1} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  )
}
