import { useState, useCallback, useEffect } from 'react'
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

let nextId = 0

// One toast, and the timer that takes it away. The timer runs only while neither the
// pointer is over the toast nor focus is inside it, and starts again from the full
// duration when both have left, so a person who is reading it, or has tabbed to its
// button, is not raced. It is cleared when the toast goes, whichever way it goes.
function ToastItem({ t, onDismiss }) {
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
      role={t.tone === 'error' ? 'alert' : 'status'}
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
// onClick and takes the toast away. A toast that is an error is an alert, which a screen
// reader reads at once; the others are statuses, read when it is quiet. The region they sit
// in is named, and is not a live region itself, so that nothing is read twice.
//
// That region says aria-live="off", and not nothing, for a reason that has nothing to do
// with reading. A modal dialog hides everything outside itself from a screen reader, and the
// one thing it leaves alone is a branch of the page that holds an aria-live attribute. A
// region with none is hidden when a dialog opens, and then an error toast about the work the
// dialog started (a disconnect that was refused) would be shown and never read. "off" is
// the value that keeps the region in view of the dialog and still announces nothing itself.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id))
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
    return id
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="off"
        className="fixed z-(--z-toast) bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {toasts.map(t => <ToastItem key={t.id} t={t} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  )
}
