// The storage of this browser, for what the demo keeps between visits. Every call is
// guarded: reading window.localStorage can throw where storage is blocked (a private
// window, some embedded browsers), and a write can throw when it is full. A refused
// read is nothing stored, and a refused write answers false, so the demo works and the
// store can tell the page that what it saves no longer fits.

const local = () => window.localStorage

export function deviceStorage() {
  return {
    getItem(key) {
      try {
        return local().getItem(key)
      } catch {
        return null
      }
    },
    // True when the value is kept, false when the browser refuses it.
    setItem(key, value) {
      try {
        local().setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    removeItem(key) {
      try {
        local().removeItem(key)
      } catch {
        // Blocked. Nothing was stored.
      }
    },
  }
}

// What the store sends the page when a save does not fit (firebase.js wires it), and
// the banner listens for, to say so once (DemoBanner.jsx). It is an event on window
// because the store knows nothing of the page, and the banner is inside the toasts.
export const DEMO_SAVE_FAILED_EVENT = 'p2-demo-save-failed'

export function announceSaveFailed() {
  window.dispatchEvent(new Event(DEMO_SAVE_FAILED_EVENT))
}
