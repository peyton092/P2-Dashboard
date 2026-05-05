import { cn } from '@/lib/utils'
import { SearchIcon, ChevronRightIcon } from 'lucide-react'
import { StatusBadge, BillingBadge, PriorityBadge } from './badges'

const O = '#F47920'

// ── ActionBar ─────────────────────────────────────────────────────────────────
// Inline horizontal bar for primary actions sitting above content sections.

export function ActionBar({ children, className = '' }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  )
}

// ── FilterBar ─────────────────────────────────────────────────────────────────
// Search input + filter chips. Headless-ish — pass `value`, `onChange`, `chips`.

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  chips,
  trailing,
  className = '',
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 mb-4', className)}>
      {typeof search === 'string' && onSearchChange && (
        <label className="relative flex-1 min-w-[200px] max-w-md">
          <SearchIcon
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg text-sm text-zinc-100 pl-8 pr-3 py-2 placeholder:text-zinc-500 focus:outline-none focus:border-white/30 transition-colors"
          />
        </label>
      )}
      {chips && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map(chip => (
            <button
              key={chip.value}
              type="button"
              onClick={() => chip.onClick?.()}
              aria-pressed={chip.active || undefined}
              className={cn(
                'text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors',
                chip.active
                  ? 'border-white/30 text-white bg-white/[0.06]'
                  : 'border-white/10 text-zinc-300 hover:text-white hover:border-white/20',
              )}
              style={chip.active && chip.accent ? { borderColor: chip.accent + '88', color: chip.accent } : undefined}
            >
              {chip.label}
              {typeof chip.count === 'number' && chip.count > 0 && (
                <span className="ml-1.5 text-zinc-400">{chip.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  )
}

// ── ResponsiveTable ───────────────────────────────────────────────────────────
// Headless. Renders rows (the children) inside a horizontally scrollable wrapper
// on small screens. Use the `<TableHeader columns={[…]} />` helper for thead.

export function ResponsiveTable({ children, className = '' }) {
  return (
    <div className={cn('overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0', className)}>
      <table className="w-full text-sm border-separate border-spacing-y-1.5">
        {children}
      </table>
    </div>
  )
}

export function TableHeader({ columns }) {
  return (
    <thead>
      <tr>
        {columns.map(col => (
          <th
            key={col.key}
            className={cn(
              'text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400 px-3 pb-2',
              col.align === 'right'  && 'text-right',
              col.align === 'center' && 'text-center',
              col.className,
            )}
            style={col.width ? { width: col.width } : undefined}
          >
            {col.label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function TableRow({ children, onClick, className = '' }) {
  const base = 'group bg-white/[0.025] hover:bg-white/[0.05] transition-colors text-zinc-100'
  return (
    <tr
      onClick={onClick}
      className={cn(
        base,
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function TableCell({ children, align, className = '', first, last, onClick }) {
  return (
    <td
      onClick={onClick}
      className={cn(
        'px-3 py-2.5 align-middle border-y border-white/5',
        first && 'rounded-l-lg border-l',
        last  && 'rounded-r-lg border-r',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  )
}

// ── JobRow ────────────────────────────────────────────────────────────────────
// Compact row used inside DataPanels to list jobs that need attention.

export function JobRow({
  job,
  onClick,
  meta,         // optional ReactNode rendered as the right-side detail
  badges,       // optional array of badge ReactNodes
  action,       // optional trailing action node (e.g., "Open ›")
  className = '',
}) {
  const label = job?.name || job?.client?.split?.(' ')?.[0] || job?.id || '—'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg',
        'border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15',
        'text-left transition-colors',
        className,
      )}
    >
      <span className="text-[11px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
        {job?.id || '—'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-100 truncate">{label}</p>
        {meta && (
          <p className="text-[11px] text-zinc-400 truncate mt-0.5">{meta}</p>
        )}
      </div>
      {badges && badges.length > 0 && (
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {badges}
        </div>
      )}
      {action ? action : (
        <ChevronRightIcon
          size={16}
          className="text-zinc-400 shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      )}
    </button>
  )
}

// ── JobCard ───────────────────────────────────────────────────────────────────
// Larger card variant for grid-style lists (mobile-friendly).

export function JobCard({
  job,
  status,            // override or use job.status
  billingStatus,
  priority,
  pmLabel,
  meta,
  footer,
  onClick,
  className = '',
}) {
  const label = job?.name || job?.client?.split?.(' ')?.[0] || job?.id || '—'
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      onClick={onClick}
      className={cn(
        'group relative text-left w-full overflow-hidden rounded-xl',
        'border border-white/10 bg-white/[0.025]',
        'p-4',
        onClick && 'hover:border-white/25 hover:bg-white/[0.04] transition-colors cursor-pointer',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">
            {job?.id || '—'}
          </span>
          <p className="text-base font-bold text-white mt-1.5 truncate">{label}</p>
          {pmLabel && (
            <p className="text-xs text-zinc-400 mt-0.5 truncate">{pmLabel}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {priority && <PriorityBadge priority={priority} size="xs" />}
          {(status || job?.status) && (
            <StatusBadge status={status || job?.status} size="xs" />
          )}
          {billingStatus && <BillingBadge status={billingStatus} size="xs" />}
        </div>
      </div>
      {meta && (
        <div className="text-xs text-zinc-300 space-y-0.5 mt-2">{meta}</div>
      )}
      {footer && (
        <div className="mt-3 pt-3 border-t border-white/5 text-xs text-zinc-300">{footer}</div>
      )}
    </Cmp>
  )
}
