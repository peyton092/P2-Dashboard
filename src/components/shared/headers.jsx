import { cn } from '@/lib/utils'

const O = '#F47920'

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
  className = '',
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 pb-5 mb-6 border-b border-white/5',
        'sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: O }}
          >
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight leading-tight text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-zinc-300 mt-1.5 max-w-2xl">
            {subtitle}
          </p>
        )}
        {meta && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-zinc-400">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </header>
  )
}

export function SectionHeader({
  title,
  count,
  description,
  Icon,
  actions,
  className = '',
}) {
  return (
    <div className={cn('flex items-end justify-between gap-3 mb-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon
              size={16}
              style={{ color: O }}
              className="shrink-0"
              aria-hidden="true"
            />
          )}
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-zinc-100">
            {title}
          </h2>
          {typeof count === 'number' && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white/90"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            >
              {count}
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
