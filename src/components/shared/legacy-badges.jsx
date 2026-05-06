// Legacy InspBadge / JobBadge primitives, kept for screens that haven't yet
// migrated to the modern Pill-based system from `./badges`. Pure presentation.
// Moved out of src/App.jsx in Phase 19. Behavior preserved exactly.

const O = '#F47920' // Brand orange — kept local to avoid coupling to App.jsx.

export const inspMeta = {
  passed:    { color: '#22c55e', label: 'PASSED'    },
  failed:    { color: '#ef4444', label: 'FAILED'    },
  scheduled: { color: '#eab308', label: 'SCHEDULED' },
  pending:   { color: '#6b7280', label: 'PENDING'   },
  blocked:   { color: '#3b82f6', label: 'BLOCKED'   },
  'n/a':     { color: '#374151', label: 'N/A'       },
}
export const iMeta = (s) => inspMeta[s] || { color: '#6b7280', label: (s || '').toUpperCase() }

export const statusMeta = {
  'on-track':     { color: '#22c55e', label: 'ON TRACK'     },
  'needs-action': { color: O,         label: 'NEEDS ACTION' },
  'at-risk':      { color: '#eab308', label: 'AT RISK'      },
  'blocked':      { color: '#ef4444', label: 'BLOCKED'      },
  'complete':     { color: '#22c55e', label: 'COMPLETE'     },
  'completed':    { color: '#22c55e', label: 'COMPLETED'    },
  'active':       { color: O,         label: 'ACTIVE'       },
  'hold':         { color: '#ef4444', label: 'ON HOLD'      },
  'pending':      { color: '#6b7280', label: 'PENDING'      },
}
export const sMeta = (s) => statusMeta[s] || { color: '#6b7280', label: s.toUpperCase() }

export function InspBadge({ status }) {
  const { color, label } = iMeta(status)
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full tracking-wider"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  )
}

export function JobBadge({ status }) {
  const { color, label } = sMeta(status)
  return (
    <span className="text-xs font-bold px-3 py-1 rounded-full tracking-wider"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
      {label}
    </span>
  )
}
