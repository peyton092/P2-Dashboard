// Status metadata and lookup helpers for the legacy InspBadge / JobBadge.
// Split from legacy-badges.jsx so that file only exports components.

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
