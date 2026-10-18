// Thin progress bar primitive. Pure presentational — no state, no Firestore.
// Moved out of src/App.jsx in Phase 19. Behavior preserved exactly.

import { BRAND } from '@/lib/tokens'

export function ProgressBar({ value, color = BRAND, className = '' }) {
  return (
    <div className={`h-2 bg-white/10 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
      />
    </div>
  )
}
