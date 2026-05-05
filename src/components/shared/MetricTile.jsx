import { cn } from '@/lib/utils'
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from 'lucide-react'

const O = '#F47920'

// Tight, dense KPI tile suitable for a 2-6 column strip.
// `accent` defaults to brand orange — only existing palette tones should be passed.
export default function MetricTile({
  label,
  value,
  sub,
  Icon,
  accent = O,
  trend,           // 'up' | 'down' | 'flat' — visual cue only
  trendLabel,      // free-form string ("+8% vs last month")
  emphasis = 'default', // 'default' | 'critical' | 'warning' | 'success' | 'mute'
  onClick,
  className = '',
}) {
  // emphasis maps to colors that already exist in the codebase
  const emphasisColor = {
    default:  null,
    critical: '#ef4444',
    warning:  '#eab308',
    success:  '#22c55e',
    mute:     '#9ca3af',
  }[emphasis]

  const TrendIcon = trend === 'up' ? ArrowUpIcon : trend === 'down' ? ArrowDownIcon : MinusIcon
  const trendColor =
    trend === 'up'   ? '#22c55e' :
    trend === 'down' ? '#ef4444' : '#9ca3af'

  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={cn(
        'group relative text-left w-full overflow-hidden rounded-xl',
        'border border-white/10 bg-white/[0.025]',
        'px-4 py-3.5',
        'transition-colors',
        onClick && 'hover:border-white/20 hover:bg-white/[0.04] cursor-pointer',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 truncate">
          {label}
        </p>
        {Icon && (
          <div
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{
              width: 32,
              height: 32,
              backgroundColor: (emphasisColor || accent) + '22',
              color: emphasisColor || accent,
            }}
          >
            <Icon size={18} strokeWidth={2} />
          </div>
        )}
      </div>
      <p
        className="text-[26px] font-black tracking-tight leading-none mt-2 text-white"
        style={emphasisColor ? { color: emphasisColor } : undefined}
      >
        {value}
      </p>
      {(sub || trendLabel) && (
        <div className="flex items-center gap-1.5 mt-2 min-h-[14px]">
          {trendLabel && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold"
              style={{ color: trendColor }}
            >
              <TrendIcon size={10} />
              {trendLabel}
            </span>
          )}
          {sub && (
            <p className="text-[11px] text-zinc-400 truncate">
              {sub}
            </p>
          )}
        </div>
      )}
      {/* subtle bottom accent line on hover for clickable tiles */}
      {onClick && (
        <span
          aria-hidden="true"
          className="absolute left-0 bottom-0 h-px w-0 group-hover:w-full transition-all duration-300"
          style={{ backgroundColor: accent }}
        />
      )}
    </Tag>
  )
}
