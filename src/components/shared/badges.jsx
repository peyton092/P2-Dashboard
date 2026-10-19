import { cn } from '@/lib/utils'
import { withAlpha } from '@/lib/tokens'
import {
  JOB_STATUS, INSPECTION_STATUS, PERMIT_STATUS, BILLING_STATUS,
  statusLabel, statusTone, toneHex, toneText,
} from '@/lib/status'

// How each tone paints a pill: a tint of the tone's color for the fill and a stronger
// tint for the border, and the tone's text color for the words. The words are 9 to 11
// pixels, so they take the text color, which is lighter than the tone where the tone is
// too dim for small text on a card (see TONE_TEXT in tokens.js). Neutral and mute sit on
// white at a low alpha so they read as quiet, and muted words are in the neutral gray.
const tint = (tone) => ({
  fg: toneText(tone),
  bg: withAlpha(toneHex(tone), 0.13),
  bd: withAlpha(toneHex(tone), 0.33),
})
const TONE = {
  brand:    tint('brand'),
  success:  tint('success'),
  warning:  tint('warning'),
  critical: tint('critical'),
  info:     tint('info'),
  cyan:     tint('cyan'),
  neutral:  { fg: toneText('neutral'), bg: 'rgba(255,255,255,0.06)', bd: 'rgba(255,255,255,0.12)' },
  mute:     { fg: toneText('mute'),    bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.08)' },
}

const SIZE = {
  xs: 'text-[9px] px-1.5 py-0.5 tracking-wide',
  sm: 'text-[10px] px-2 py-0.5 tracking-wide',
  md: 'text-[11px] px-2.5 py-1 tracking-wide',
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

// The status badges read their words and tones from status.js, so a status looks
// the same here as in a menu, a chart or a list.
function StatusPill({ map, status, size, className }) {
  return <Pill tone={statusTone(map, status)} size={size} className={className}>{statusLabel(map, status)}</Pill>
}

// Job status pill
export function StatusBadge({ status, size = 'sm', className = '' }) {
  return <StatusPill map={JOB_STATUS} status={status} size={size} className={className} />
}

// Inspection result pill
export function InspectionBadge({ status, size = 'sm', className = '' }) {
  return <StatusPill map={INSPECTION_STATUS} status={status} size={size} className={className} />
}

// Permit status pill
export function PermitBadge({ status, size = 'sm', className = '' }) {
  return <StatusPill map={PERMIT_STATUS} status={status} size={size} className={className} />
}

// Billing status pill. A job with no billing status has not been invoiced.
export function BillingBadge({ status, size = 'sm', className = '' }) {
  return <StatusPill map={BILLING_STATUS} status={status || 'not-invoiced'} size={size} className={className} />
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
