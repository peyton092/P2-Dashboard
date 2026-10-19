import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App.jsx'
import { ToastProvider } from '../components/ui/toast'
import DemoBanner from './DemoBanner'

// Where the demo build starts. src/main.jsx imports this module only when the build is
// the demo, and it renders the app as main.jsx does, with the demo banner above it.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <DemoBanner />
      <App />
    </ToastProvider>
  </StrictMode>,
)
