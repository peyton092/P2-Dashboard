// Tiny localStorage-backed "saved views" registry.
//
// A view is just a JSON-serializable object (the page picks the shape) keyed
// by a human name within a scope (e.g. 'jobs'). Each scope's views live under
// a single localStorage key so reading and writing is one parse / serialize.
//
// The hook re-broadcasts updates within the tab via a custom event so two
// view-pickers in the same page see each other's saves.

import { useEffect, useState } from 'react'

const PREFIX = 'p2_views_'
const EVT = 'p2:views-changed'

function key(scope) { return `${PREFIX}${scope}` }

function read(scope) {
  try {
    const raw = localStorage.getItem(key(scope))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(scope, views) {
  try {
    localStorage.setItem(key(scope), JSON.stringify(views))
    window.dispatchEvent(new CustomEvent(EVT, { detail: { scope } }))
  } catch { /* storage full or blocked */ }
}

export function getSavedViews(scope) {
  return read(scope)
}

export function saveView(scope, name, payload) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return false
  const views = read(scope)
  views[trimmed] = { payload, updatedAt: Date.now() }
  write(scope, views)
  return true
}

export function deleteView(scope, name) {
  const views = read(scope)
  if (!(name in views)) return false
  delete views[name]
  write(scope, views)
  return true
}

// Hook returns the current views map and re-renders when the registry changes
// (same tab via custom event, other tabs via the storage event).
export function useSavedViews(scope) {
  const [views, setViews] = useState(() => read(scope))
  useEffect(() => {
    const sync = () => setViews(read(scope))
    const onCustom = (e) => { if (e.detail?.scope === scope) sync() }
    const onStorage = (e) => { if (e.key === key(scope)) sync() }
    window.addEventListener(EVT, onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVT, onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }, [scope])
  return views
}
