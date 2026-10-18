// Firebase Admin setup shared by every function module. Any module that needs
// Firestore imports `db` from here, which also guarantees the default app
// exists before getAuth() or getMessaging() are called. index.js no longer
// initializes the app itself.
//
// initializeApp() throws if the default app already exists, so it only runs
// when nothing else (an emulator, a test, another entry point) has created it.

import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) initializeApp()

export const db = getFirestore()
