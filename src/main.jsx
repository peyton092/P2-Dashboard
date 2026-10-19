import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './components/ui/toast'
import { initErrorLogger } from './lib/errorLogger'

initErrorLogger()

// The demo build (npm run build:demo, see docs/demo-preview.md) runs this app on sample
// data held in the browser. It starts from src/demo/start.jsx, which shows the demo
// banner above the app, and it registers no service worker. The condition is fixed
// when the app is built, so the production build drops this branch and carries none of
// the demo code.
if (import.meta.env.VITE_DEMO === '1') {
  import('./demo/start.jsx')
} else {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  )
}
