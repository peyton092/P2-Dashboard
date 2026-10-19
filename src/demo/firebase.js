import { initializeApp } from './shims/app'
import {
  initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
} from './shims/firestore'
import { getAuth } from './shims/auth'
import { getStorage } from './shims/storage'
import { getFunctions } from './shims/functions'
import { getMessaging, isSupported as messagingIsSupported } from './shims/messaging'
import { buildSeed, DEMO_SEED_VERSION } from './seed'
import { deviceStorage } from './device'

// src/firebase.js for the demo build. vite.config.js sends every import of
// src/firebase.js here in demo mode, so the app gets the same five exports, built from
// the shims, with no Firebase configuration and no project of any kind behind them.
// The store starts from the seed, dated from the day it is first used, or from what
// this browser saved of an earlier visit.

const app = initializeApp({
  demo: {
    store: { seed: () => buildSeed(new Date()), storage: deviceStorage(), version: DEMO_SEED_VERSION },
  },
})

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
  }),
})
export const auth = getAuth(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

export async function getMessagingIfSupported() {
  try {
    return (await messagingIsSupported()) ? getMessaging(app) : null
  } catch {
    return null
  }
}

// The banner's Reset sample data: the seed again, and what this browser saved forgotten.
export function resetDemoState() {
  app.demoStore().reset()
}

// A write is saved 250 ms after it is made, so one made just before the page goes away
// is saved as it goes.
window.addEventListener('pagehide', () => app.demoStore().flush())
