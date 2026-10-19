import { createDemoStore } from '../store'
import { demoSession } from '../demoSession'

// firebase/app for the demo build. The demo app holds no Firebase configuration: what
// it is given is how to make the demo's store and which session to use, and its
// options are empty. The other shims take what they need from it, as the real ones
// take theirs from a FirebaseApp:
//
//   initializeApp({ demo: { store: { seed, storage, version }, session } })
//
// store is what createDemoStore is given, and the store is made the first time it is
// asked for. session is a session from demoSession.js, the demo's own when none is
// given.

export function initializeApp(options = {}) {
  const demo = options?.demo ?? {}
  let store = null
  return {
    name: '[DEFAULT]',
    options: {},
    automaticDataCollectionEnabled: false,
    demoStore() {
      if (store === null) store = createDemoStore(demo.store ?? {})
      return store
    },
    demoSession() {
      return demo.session ?? demoSession()
    },
  }
}
