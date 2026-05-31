import { useEffect, useState, useRef } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap'
import { XIcon } from 'lucide-react'

const O = '#F47920'

// Press "?" anywhere outside an input to open. Centralizes the shortcuts the
// app has scattered (palette, navigation, etc.) so they're discoverable.
const SHORTCUTS = [
  {
    section: 'Navigation',
    items: [
      { keys: ['⌘', 'K'],   desc: 'Open command palette',         alt: ['Ctrl', 'K'] },
      { keys: ['/'],        desc: 'Open command palette' },
      { keys: ['Esc'],      desc: 'Close the active modal / palette' },
      { keys: ['?'],        desc: 'Open this shortcuts list' },
    ],
  },
  {
    section: 'Inside dialogs',
    items: [
      { keys: ['Tab'],      desc: 'Cycle focus within the dialog' },
      { keys: ['Enter'],    desc: 'Confirm / submit' },
      { keys: ['Esc'],      desc: 'Cancel and close' },
    ],
  },
  {
    section: 'Inside the command palette',
    items: [
      { keys: ['↑', '↓'],   desc: 'Move between results' },
      { keys: ['Enter'],    desc: 'Open the highlighted result' },
    ],
  },
]

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useFocusTrap(ref, open)

  useEffect(() => {
    const onKey = (e) => {
      if (open && e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        return
      }
      if (!open && e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4" role="presentation">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 id="shortcuts-title" className="text-base font-semibold text-white">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close shortcuts"
            className="text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {SHORTCUTS.map(group => (
            <section key={group.section}>
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 mb-2">{group.section}</h3>
              <ul className="space-y-2">
                {group.items.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-200">{s.desc}</span>
                    <span className="flex items-center gap-1.5">
                      <Combo keys={s.keys} />
                      {s.alt && (
                        <>
                          <span className="text-[10px] text-zinc-500">or</span>
                          <Combo keys={s.alt} />
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-white/10 text-[11px] text-zinc-400">
          Tip: press <Kbd>?</Kbd> anywhere outside an input to bring this list back.
        </div>
      </div>
    </div>
  )
}

function Combo({ keys }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-zinc-500">+</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  )
}

function Kbd({ children }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[20px] h-6 px-1.5 rounded-md border border-white/15 bg-white/[0.04] text-[11px] font-semibold text-zinc-200"
      style={{ borderColor: O + '40' }}
    >
      {children}
    </kbd>
  )
}
