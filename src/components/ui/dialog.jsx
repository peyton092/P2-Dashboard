import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { useFocusTrap } from '../../lib/useFocusTrap'

const O = '#F47920'

const DialogContext = createContext(null)

// useDialog() → { confirm, prompt }.
//
// confirm({ title, description, confirmLabel, cancelLabel, tone }) → Promise<boolean>
// prompt({ title, description, placeholder, defaultValue, confirmLabel, cancelLabel })
//   → Promise<string | null>   (null when user cancels; string — possibly "" — when confirmed)
//
// Replaces window.confirm / window.prompt with a branded modal that traps
// focus, dismisses on Esc + backdrop click, and restores focus to the
// triggering element on close.
export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>')
  return ctx
}

export function DialogProvider({ children }) {
  const [state, setState] = useState(null)
  const resolverRef = useRef(null)

  const close = useCallback((value) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setState(null)
  }, [])

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      const base = typeof opts === 'string' ? { title: opts } : (opts || {})
      setState({ kind: 'confirm', ...base })
    })
  }, [])

  const prompt = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      const base = typeof opts === 'string' ? { title: opts } : (opts || {})
      setState({ kind: 'prompt', defaultValue: '', ...base })
    })
  }, [])

  const value = { confirm, prompt }

  return (
    <DialogContext.Provider value={value}>
      {children}
      {state && <DialogModal state={state} onClose={close} />}
    </DialogContext.Provider>
  )
}

function DialogModal({ state, onClose }) {
  const ref = useRef(null)
  const inputRef = useRef(null)
  const [text, setText] = useState(state.defaultValue || '')
  useFocusTrap(ref, true)

  // Focus input on open for prompt; focus the confirm button otherwise so
  // the user can press Enter to accept.
  useEffect(() => {
    const t = setTimeout(() => {
      if (state.kind === 'prompt') inputRef.current?.focus()
      else ref.current?.querySelector('[data-confirm]')?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [state.kind])

  // Esc cancels; backdrop click cancels.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose(state.kind === 'prompt' ? null : false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.kind, onClose])

  const cancel = () => onClose(state.kind === 'prompt' ? null : false)
  const confirm = () => onClose(state.kind === 'prompt' ? text : true)
  const onSubmit = (e) => { e.preventDefault(); confirm() }

  const destructive = state.tone === 'critical' || state.tone === 'destructive'
  const accent = destructive ? '#ef4444' : O

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={cancel}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role={state.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={state.description ? 'dialog-desc' : undefined}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
      >
        <form onSubmit={onSubmit} className="p-5">
          <h2 id="dialog-title" className="text-base font-semibold text-white">{state.title}</h2>
          {state.description && (
            <p id="dialog-desc" className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
              {state.description}
            </p>
          )}
          {state.kind === 'prompt' && (state.multiline ? (
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Cmd+Enter / Ctrl+Enter submits multiline prompts (the form's
                // default Enter handler doesn't fire for textareas).
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  confirm()
                }
              }}
              placeholder={state.placeholder || ''}
              rows={state.rows || 4}
              className="mt-4 w-full bg-white/[0.04] border border-white/15 rounded-lg text-sm text-zinc-100 px-3 py-2 placeholder:text-zinc-500 focus:outline-none focus:border-white/30 resize-y"
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={state.placeholder || ''}
              className="mt-4 w-full bg-white/[0.04] border border-white/15 rounded-lg text-sm text-zinc-100 px-3 py-2 placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
            />
          ))}
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={cancel}
              className="text-xs font-semibold px-3 py-2 rounded-lg border border-white/15 text-zinc-200 hover:text-white hover:border-white/30 transition-colors"
            >
              {state.cancelLabel || 'Cancel'}
            </button>
            <button
              type="submit"
              data-confirm
              className="text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
              style={{ backgroundColor: accent }}
            >
              {state.confirmLabel || (state.kind === 'prompt' ? 'Save' : 'Confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
