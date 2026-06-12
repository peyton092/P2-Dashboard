// Captures the browser-fired `beforeinstallprompt` event so a UI button can
// trigger the PWA install flow later. Browsers fire this exactly once per
// session, well before any UI is ready to use it — we stash it on a module
// scope ref and a custom event so subscribers can react when it arrives.

import { useEffect, useState } from 'react'

let storedEvent = null
const SUBS = new Set()

export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop the browser from showing its mini-infobar; we surface a custom
    // button in Settings instead.
    e.preventDefault()
    storedEvent = e
    SUBS.forEach(fn => fn(true))
  })
  window.addEventListener('appinstalled', () => {
    storedEvent = null
    SUBS.forEach(fn => fn(false))
  })
}

// React hook: returns { available, install }. `install()` triggers the
// prompt; resolves to 'accepted' / 'dismissed' / 'unavailable'.
export function useInstallPrompt() {
  const [available, setAvailable] = useState(Boolean(storedEvent))
  useEffect(() => {
    SUBS.add(setAvailable)
    return () => SUBS.delete(setAvailable)
  }, [])
  return {
    available,
    install: async () => {
      const e = storedEvent
      if (!e) return 'unavailable'
      try {
        e.prompt()
        const choice = await e.userChoice
        storedEvent = null
        SUBS.forEach(fn => fn(false))
        return choice?.outcome || 'dismissed'
      } catch {
        return 'dismissed'
      }
    },
  }
}
