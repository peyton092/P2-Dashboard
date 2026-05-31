import { useEffect, useRef, useState } from 'react'
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
  // Sticky compact strip: fades in once the user scrolls past the main header.
  // Pure visual aid — the regular header is the source of truth for content
  // and remains scroll-restored when the user scrolls back up.
  const sentinelRef = useRef(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [])

  return (
    <>
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
      <div ref={sentinelRef} aria-hidden="true" />
      <div
        aria-hidden={!stuck}
        className={cn(
          'no-print sticky top-0 z-30 -mt-2 mb-4 backdrop-blur-md',
          'border-b border-white/10 bg-background/80',
          'transition-opacity duration-200',
          stuck ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      >
        <div className="flex items-center justify-between gap-3 py-2 px-1">
          <div className="min-w-0 flex items-baseline gap-2">
            {eyebrow && (
              <span
                className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wider shrink-0"
                style={{ color: O }}
              >
                {eyebrow}
              </span>
            )}
            <span className="text-sm font-semibold text-white truncate">{title}</span>
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
          )}
        </div>
      </div>
    </>
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
