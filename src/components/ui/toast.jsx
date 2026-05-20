import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircleIcon, AlertCircleIcon, InfoIcon, XIcon } from 'lucide-react'

const O = '#F47920'

const TONE = {
  success: { color: '#22c55e', Icon: CheckCircleIcon },
  error:   { color: '#ef4444', Icon: AlertCircleIcon },
  info:    { color: '#3b82f6', Icon: InfoIcon },
  brand:   { color: O,         Icon: InfoIcon },
}

const ToastContext = createContext(() => {})

// useToast() → toast(opts | string). opts: { title, description, tone, duration }
export function useToast() {
  return useContext(ToastContext)
}

let nextId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((opts) => {
    const id = ++nextId
    const base = typeof opts === 'string' ? { title: opts } : (opts || {})
    const t = { id, tone: 'info', duration: 4000, ...base }
    setToasts(list => [...list, t])
    if (t.duration > 0) setTimeout(() => dismiss(id), t.duration)
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="fixed z-[100] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-live="polite"
      >
        {toasts.map(t => {
          const meta = TONE[t.tone] || TONE.info
          const Icon = meta.Icon
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto sm:w-80 sm:ml-auto flex items-start gap-2.5 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur px-3.5 py-3 shadow-xl"
              style={{ borderLeft: `3px solid ${meta.color}` }}
            >
              <Icon size={16} style={{ color: meta.color }} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-semibold text-white leading-snug">{t.title}</p>}
                {t.description && <p className="text-xs text-zinc-400 mt-0.5 leading-snug">{t.description}</p>}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <XIcon size={14} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
