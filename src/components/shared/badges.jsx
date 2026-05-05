import { cn } from '@/lib/utils'

const O = '#F47920'

// Existing-palette tones only. Do NOT introduce new colors.
const TONE = {
  brand:    { fg: O,         bg: O + '22',         bd: O + '55' },
  success:  { fg: '#22c55e', bg: '#22c55e22',      bd: '#22c55e55' },
  warning:  { fg: '#eab308', bg: '#eab30822',      bd: '#eab30855' },
  critical: { fg: '#ef4444', bg: '#ef444422',      bd: '#ef444455' },
  info:     { fg: '#3b82f6', bg: '#3b82f622',      bd: '#3b82f655' },
  cyan:     { fg: '#06b6d4', bg: '#06b6d422',      bd: '#06b6d455' },
  neutral:  { fg: '#9ca3af', bg: 'rgba(255,255,255,0.06)', bd: 'rgba(255,255,255,0.12)' },
  mute:     { fg: '#6b7280', bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.08)' },
}

const SIZE = {
  xs: 'text-[9px] px-1.5 py-0.5 tracking-[0.14em]',
  sm: 'text-[10px] px-2 py-0.5 tracking-[0.14em]',
  md: 'text-[11px] px-2.5 py-1 tracking-[0.12em]',
}

export function Pill({ tone = 'neutral', size = 'sm', className = '', children, Icon }) {
  const t = TONE[tone] || TONE.neutral
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-bold uppercase whitespace-nowrap',
        SIZE[size] || SIZE.sm,
        className,
      )}
      style={{ color: t.fg, backgroundColor: t.bg, border: `1px solid ${t.bd}` }}
    >
      {Icon && <Icon size={10} />}
      {children}
    </span>
  )
}

// Job status pill — maps codebase status keys to tones from the existing palette.
const JOB_STATUS = {
  'on-track':     { tone: 'success',  label: 'On Track'     },
  'needs-action': { tone: 'brand',    label: 'Needs Action' },
  'at-risk':      { tone: 'warning',  label: 'At Risk'      },
  'blocked':      { tone: 'critical', label: 'Blocked'      },
  'complete':     { tone: 'success',  label: 'Complete'     },
  'completed':    { tone: 'success',  label: 'Completed'    },
  'active':       { tone: 'brand',    label: 'Active'       },
  'hold':         { tone: 'critical', label: 'On Hold'      },
  'pending':      { tone: 'mute',     label: 'Pending'      },
}
export function StatusBadge({ status, size = 'sm', className = '' }) {
  const meta = JOB_STATUS[status] || { tone: 'neutral', label: (status || '').toUpperCase() || '—' }
  return <Pill tone={meta.tone} size={size} className={className}>{meta.label}</Pill>
}

// Inspection result pill
const INSP_STATUS = {
  'passed':                 { tone: 'success',  label: 'Passed'    },
  'failed':                 { tone: 'critical', label: 'Failed'    },
  'scheduled':              { tone: 'warning',  label: 'Scheduled' },
  'pending':                { tone: 'mute',     label: 'Pending'   },
  'pending-verification':   { tone: 'mute',     label: 'Pending'   },
  'blocked':                { tone: 'info',     label: 'Blocked'   },
  'n/a':                    { tone: 'neutral',  label: 'N/A'       },
  'not-started':            { tone: 'neutral',  label: 'Not Started' },
}
export function InspectionBadge({ status, size = 'sm', className = '' }) {
  const meta = INSP_STATUS[status] || { tone: 'neutral', label: (status || '—').toUpperCase() }
  return <Pill tone={meta.tone} size={size} className={className}>{meta.label}</Pill>
}

// Billing status pill
const BILLING_STATUS = {
  'not-invoiced': { tone: 'mute',    label: 'Not Invoiced' },
  'invoiced':     { tone: 'info',    label: 'Invoiced'     },
  'partial-pay':  { tone: 'warning', label: 'Partial Pay'  },
  'paid':         { tone: 'success', label: 'Paid'         },
}
export function BillingBadge({ status = 'not-invoiced', size = 'sm', className = '' }) {
  const meta = BILLING_STATUS[status] || BILLING_STATUS['not-invoiced']
  return <Pill tone={meta.tone} size={size} className={className}>{meta.label}</Pill>
}

// Priority pill (CRITICAL / HIGH / MEDIUM / LOW)
const PRIORITY = {
  CRITICAL: { tone: 'critical', label: 'Critical' },
  HIGH:     { tone: 'brand',    label: 'High'     },
  MEDIUM:   { tone: 'warning',  label: 'Medium'   },
  LOW:      { tone: 'neutral',  label: 'Low'      },
}
export function PriorityBadge({ priority, size = 'sm', className = '' }) {
  const meta = PRIORITY[priority] || PRIORITY.MEDIUM
  return <Pill tone={meta.tone} size={size} className={className}>{meta.label}</Pill>
}
