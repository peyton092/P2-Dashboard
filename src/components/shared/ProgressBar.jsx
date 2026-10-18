// Thin progress bar primitive. Pure presentational: no state, no Firestore.
// Moved out of src/App.jsx in Phase 19.
//
// The fill takes a tone, a name from the status vocabulary in status.js (brand,
// success, warning, critical, info, cyan, neutral or mute), and is painted with
// that tone's color from tokens.js. A tone the vocabulary does not have reads as
// neutral. The bar is the brand color unless it is told otherwise.

import { toneHex } from '@/lib/status'

export function ProgressBar({ value, tone = 'brand', className = '' }) {
  return (
    <div className={`h-2 bg-white/10 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: toneHex(tone) }}
      />
    </div>
  )
}
