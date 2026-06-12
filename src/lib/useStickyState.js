import { useEffect, useRef, useState } from 'react'

// useStickyState — useState that mirrors itself to localStorage so the value
// survives page reloads and tab navigation. Use for ephemeral UI prefs like
// the current filter chip / search query / sort field. Not a replacement for
// saved views — saved views are named snapshots a user opts into, while this
// just remembers the most recent value.
//
// Reads are best-effort: if storage throws (Safari private mode, quota), we
// silently fall back to the in-memory initial value. Writes are debounced
// with a single rAF / microtask so a flurry of setState calls collapse into
// one write.
//
// Values are JSON-serialized; the value must round-trip through JSON.

const PREFIX = 'p2_sticky_'

function read(key, initial) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw == null) return typeof initial === 'function' ? initial() : initial
    return JSON.parse(raw)
  } catch {
    return typeof initial === 'function' ? initial() : initial
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch { /* storage full, blocked, or non-serializable — ignore */ }
}

// opts.crossTabSync — default true. Set false for state that's intentionally
// per-window (e.g. the currently active tab — you don't want window B to
// follow window A's navigation just because both write the same key).
export function useStickyState(key, initial, opts = {}) {
  const { crossTabSync = true } = opts
  const [value, setValue] = useState(() => read(key, initial))
  const firstRun = useRef(true)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    write(key, value)
  }, [key, value])
  // Cross-tab sync — when another tab writes the same key, mirror the change
  // here so a filter changed in tab A appears in tab B without a reload.
  useEffect(() => {
    if (!crossTabSync) return
    const onStorage = (e) => {
      if (e.key !== PREFIX + key) return
      try {
        const next = e.newValue == null ? null : JSON.parse(e.newValue)
        if (JSON.stringify(next) !== JSON.stringify(valueRef.current)) {
          setValue(next)
        }
      } catch { /* ignore malformed payloads from other tabs */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key, crossTabSync])
  return [value, setValue]
}

// Test seam — let unit tests reset the stored values without touching
// production localStorage state.
export function _clearStickyKey(key) {
  try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
}
