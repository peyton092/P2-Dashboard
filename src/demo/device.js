// The storage of this browser, for what the demo keeps between visits. Every call is
// guarded: reading window.localStorage can throw where storage is blocked (a private
// window, some embedded browsers), and a write can throw when it is full. A refused
// call reads as nothing stored, so the demo works and simply forgets on reload.

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
    setItem(key, value) {
      try {
        local().setItem(key, value)
      } catch {
        // Full or blocked. The demo keeps working in memory.
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
