import { useEffect, useRef } from 'react'

// Keep keyboard focus inside the modal/dialog. Pass a ref to the container
// element; when `active` is true, the hook:
//   1. moves focus into the container on open (first focusable child, or
//      the container itself if the caller wants it programmatically focusable),
//   2. catches Tab / Shift+Tab to cycle within the focusable set,
//   3. restores focus to whatever had it before open when the trap turns off.
//
// Pure DOM — no library deps. The host component still handles Esc / backdrop
// dismissal; this only constrains Tab.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="switch"]:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useFocusTrap(containerRef, active = true) {
  const previouslyFocused = useRef(null)

  useEffect(() => {
    if (!active) return
    const root = containerRef.current
    if (!root) return

    previouslyFocused.current = document.activeElement

    // Move focus into the dialog. Prefer the first focusable child; otherwise
    // make the container itself focusable as a fallback.
    const initialFocus = () => {
      const focusables = root.querySelectorAll(FOCUSABLE_SELECTOR)
      const target = focusables[0]
      if (target && target instanceof HTMLElement) {
        target.focus()
      } else if (root instanceof HTMLElement) {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
        root.focus()
      }
    }
    // Defer one frame so the dialog finishes mounting before we measure focusables.
    const t = setTimeout(initialFocus, 0)

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const focusables = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(el => el instanceof HTMLElement && !el.hasAttribute('aria-hidden'))
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last  = focusables[focusables.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else if (activeEl === last || !root.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }

    root.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(t)
      root.removeEventListener('keydown', onKeyDown)
      const restore = previouslyFocused.current
      if (restore && restore instanceof HTMLElement && document.contains(restore)) {
        restore.focus()
      }
    }
  }, [containerRef, active])
}
