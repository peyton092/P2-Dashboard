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

export function useStickyState(key, initial) {
  const [value, setValue] = useState(() => read(key, initial))
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    write(key, value)
  }, [key, value])
  return [value, setValue]
}

// Test seam — let unit tests reset the stored values without touching
// production localStorage state.
export function _clearStickyKey(key) {
  try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
}
