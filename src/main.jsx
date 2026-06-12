import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './components/ui/toast'
import { DialogProvider } from './components/ui/dialog'
import { ServiceWorkerUpdateNotifier } from './components/ui/ServiceWorkerUpdateNotifier'
import { initErrorLogger } from './lib/errorLogger'
import { captureInstallPrompt } from './lib/installPrompt'
import { auth } from './firebase'

// Drop queued writes older than this on replay — a stale write that's been
// sitting for hours is more likely to overwrite valid intervening edits than
// to be the user's intent. Matches Firestore's ID-token lifetime.
const QUEUE_TTL_MS = 60 * 60 * 1000

initErrorLogger()
captureInstallPrompt()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Watch for an updated build. sw.js calls skipWaiting on install, so the
      // newly-found worker transitions installing → activated. Firing only when
      // there's already a controller skips the first-ever install (no point
      // telling the user to reload a page they just opened).
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('p2:sw-update'))
          }
        })
      })
    }).catch(() => {})
  })

  window.addEventListener('online', () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'ONLINE' })
  })

  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data?.type === 'WRITE_QUEUED') {
      try {
        const pending = JSON.parse(localStorage.getItem('p2_offline_queue') || '[]')
        pending.push(event.data.entry)
        localStorage.setItem('p2_offline_queue', JSON.stringify(pending.slice(-50)))
      } catch { /* storage unavailable — drop the queued write */ }
    }

    if (event.data?.type === 'FLUSH_QUEUE') {
      try {
        const pending = JSON.parse(localStorage.getItem('p2_offline_queue') || '[]')
        if (pending.length === 0) return
        const now = Date.now()
        // Re-mint a fresh ID token; the persisted entries no longer carry
        // their original Authorization header (sw.js strips it).
        const idToken = await auth.currentUser?.getIdToken?.().catch(() => null)
        const failed = []
        for (const entry of pending) {
          if (entry.timestamp && now - entry.timestamp > QUEUE_TTL_MS) continue
          try {
            const headers = idToken
              ? { ...entry.headers, Authorization: `Bearer ${idToken}` }
              : entry.headers
            await fetch(entry.url, {
              method: entry.method,
              headers,
              body: entry.body || undefined,
            })
          } catch {
            failed.push(entry)
          }
        }
        localStorage.setItem('p2_offline_queue', JSON.stringify(failed))
      } catch { /* storage unavailable — skip flush */ }
    }
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <ServiceWorkerUpdateNotifier />
        <App />
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
)
