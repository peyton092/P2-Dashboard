import { useEffect, useRef } from 'react'
import { useToast } from './toast'

// Listens for the 'p2:sw-update' event main.jsx dispatches after a new service
// worker activates, and surfaces a single toast with a Reload action. Guarded
// against firing twice in the same session (a flapping update would otherwise
// spawn duplicate toasts).
export function ServiceWorkerUpdateNotifier() {
  const toast = useToast()
  const shown = useRef(false)
  useEffect(() => {
    const handler = () => {
      if (shown.current) return
      shown.current = true
      toast({
        tone: 'info',
        title: 'New version available',
        description: 'Reload to pick up the latest changes.',
        duration: 0,
        action: {
          label: 'Reload',
          onClick: () => window.location.reload(),
        },
      })
    }
    window.addEventListener('p2:sw-update', handler)
    return () => window.removeEventListener('p2:sw-update', handler)
  }, [toast])
  return null
}
