import { initializeApp, getApps } from 'firebase/app'
import {
  initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: 'AIzaSyDm5I5iCbe3_0IZdtabw4WYTMW1YTaL9R4',
  authDomain: 'p2-dashboard.firebaseapp.com',
  projectId: 'p2-dashboard',
  storageBucket: 'p2-dashboard.firebasestorage.app',
  messagingSenderId: '666712594799',
  appId: '1:666712594799:web:48a3a87f6557fdd5e3b09a',
}

const app = initializeApp(firebaseConfig)

// Secondary app used to create users without signing out the current session
const secondaryApp = getApps().find(a => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary')

// Offline-first local cache. Multi-tab manager keeps data consistent across
// multiple browser tabs and desktop (Tauri) windows; unlimited cache size lets
// field crews retain full project data with no connection. Writes made offline
// reflect immediately via the local cache (optimistic UI) and flush on reconnect.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
  }),
})
export const auth = getAuth(app)
export const secondaryAuth = getAuth(secondaryApp)
export const storage = getStorage(app)
export const functions = getFunctions(app)
