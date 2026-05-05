import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initErrorLogger } from './lib/errorLogger'

initErrorLogger()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
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
      } catch {}
    }

    if (event.data?.type === 'FLUSH_QUEUE') {
      try {
        const pending = JSON.parse(localStorage.getItem('p2_offline_queue') || '[]')
        if (pending.length === 0) return
        const failed = []
        for (const entry of pending) {
          try {
            await fetch(entry.url, {
              method: entry.method,
              headers: entry.headers,
              body: entry.body || undefined,
            })
          } catch {
            failed.push(entry)
          }
        }
        localStorage.setItem('p2_offline_queue', JSON.stringify(failed))
      } catch {}
    }
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
