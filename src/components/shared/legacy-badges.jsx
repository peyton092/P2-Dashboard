// Legacy InspBadge / JobBadge primitives, kept for screens that haven't yet
// migrated to the modern Pill-based system from `./badges`. Pure presentation.
// Moved out of src/App.jsx in Phase 19. Behavior preserved exactly.

import { iMeta, sMeta } from './legacy-badge-meta'
import { withAlpha } from '@/lib/tokens'

export function InspBadge({ status }) {
  const { color, label } = iMeta(status)
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full tracking-wider"
      style={{ backgroundColor: withAlpha(color, 0.13), color, border: `1px solid ${withAlpha(color, 0.27)}` }}>
      {label}
    </span>
  )
}

export function JobBadge({ status }) {
  const { color, label } = sMeta(status)
  return (
    <span className="text-xs font-bold px-3 py-1 rounded-full tracking-wider"
      style={{ backgroundColor: withAlpha(color, 0.13), color, border: `1px solid ${withAlpha(color, 0.33)}` }}>
      {label}
    </span>
  )
}
