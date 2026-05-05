import { cn } from '@/lib/utils'

const O = '#F47920'

// Container for a section of related data with optional header strip.
// Pass `tone="elevated"` for the prominent flagship sections, `tone="flat"` for
// background panels.
export default function DataPanel({
  title,
  description,
  Icon,
  badge,
  actions,
  footer,
  tone = 'elevated',
  padding = 'default',
  className = '',
  contentClassName = '',
  children,
}) {
  const padCls =
    padding === 'tight' ? 'p-3' :
    padding === 'none'  ? 'p-0' :
    'p-4 sm:p-5'

  return (
    <section
      className={cn(
        'rounded-xl border overflow-hidden',
        tone === 'elevated'
          ? 'border-white/10 bg-white/[0.025]'
          : 'border-white/5 bg-transparent',
        className,
      )}
    >
      {(title || actions) && (
        <header
          className={cn(
            'flex items-center justify-between gap-3',
            'px-4 sm:px-5 py-3',
            'border-b border-white/5',
          )}
        >
          <div className="min-w-0 flex items-center gap-3">
            {Icon && (
              <div
                className="shrink-0 flex items-center justify-center rounded-lg"
                style={{ width: 32, height: 32, backgroundColor: O + '22', color: O }}
              >
                <Icon size={18} strokeWidth={2} />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-white truncate">
                  {title}
                </h3>
                {badge}
              </div>
              {description && (
                <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
          )}
        </header>
      )}
      <div className={cn(padCls, contentClassName)}>
        {children}
      </div>
      {footer && (
        <footer className="border-t border-white/5 px-4 sm:px-5 py-2.5 text-xs text-zinc-400">
          {footer}
        </footer>
      )}
    </section>
  )
}
