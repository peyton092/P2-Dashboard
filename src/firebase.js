import { initializeApp, getApps } from 'firebase/app'
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore'
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

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
})
export const auth = getAuth(app)
export const secondaryAuth = getAuth(secondaryApp)
export const storage = getStorage(app)
export const functions = getFunctions(app)
