import { useEffect, useState } from 'react'
import { CloudOffIcon, CheckIcon } from 'lucide-react'

// Small global indicator that appears when the browser reports it's offline.
// When connectivity comes back, briefly show a "back online" pulse before
// hiding. Writes the offline app makes still flow into Firestore's local
// persistence layer and the service-worker queue (see src/main.jsx), so the
// banner is purely informational — users just like knowing.
export default function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [justBack, setJustBack] = useState(false)

  useEffect(() => {
    let backTimer = null
    const handleOnline = () => {
      setOnline(true)
      setJustBack(true)
      if (backTimer) clearTimeout(backTimer)
      backTimer = setTimeout(() => setJustBack(false), 2500)
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (backTimer) clearTimeout(backTimer)
    }
  }, [])

  if (online && !justBack) return null

  const offline = !online
  const bg = offline ? 'rgba(234,179,8,0.95)' : 'rgba(34,197,94,0.95)'
  const Icon = offline ? CloudOffIcon : CheckIcon
  const label = offline
    ? 'You’re offline — changes will sync when you reconnect.'
    : 'Back online. Syncing…'

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 px-3 py-1.5 text-[12px] font-semibold text-zinc-900 shadow-md"
      style={{ backgroundColor: bg }}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
