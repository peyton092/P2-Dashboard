import { cn } from '@/lib/utils'
import { BAND_CELL, BAND_FRAME, bandCellSpan, bandGrid } from './statBandLayout'

// Content-shaped loading placeholder. Pass through className for sizing
// (e.g. "h-4 w-32"); rounding defaults to a small radius.
export function Skeleton({ className = '', rounded = 'rounded-md', style }) {
  return <div className={cn('p2-skeleton', rounded, className)} style={style} aria-hidden="true" />
}

// A strip of figures, drawn the way StatBand draws them: one frame, with hairlines
// between the cells and no tile for any of them.
function TilesSkeleton({ count }) {
  return (
    <div className={BAND_FRAME}>
      <div className={bandGrid(count)}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={cn(BAND_CELL, 'px-4 py-3 sm:px-5 sm:py-4', bandCellSpan(i, count))}>
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-8 w-24 mt-2" />
            <Skeleton className="h-2.5 w-28 mt-2" />
          </div>
        ))}
      </div>
    </div>
  )
}

// A list-row placeholder.
function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
      <Skeleton className="h-9 w-9" rounded="rounded-lg" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16" rounded="rounded-full" />
    </div>
  )
}

// Full-page loading scaffold used as the route Suspense fallback. Mirrors the
// common page shape (header + KPI strip + data panel) so transitions land
// without a layout jump. To a screen reader it is one busy status named Loading,
// and the shapes inside it are hidden. aria-label needs a role to sit on.
export function PageSkeleton({ tiles = 5, rows = 6 }) {
  return (
    <div className="space-y-6 p2-page-enter" role="status" aria-busy="true" aria-label="Loading">
      <div className="pb-5 mb-1 border-b border-white/5">
        <Skeleton className="h-2.5 w-24 mb-3" />
        <Skeleton className="h-7 w-64 mb-3" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <TilesSkeleton count={tiles} />
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <Skeleton className="h-3.5 w-40" />
        </div>
        {Array.from({ length: rows }).map((_, i) => <RowSkeleton key={i} />)}
      </div>
    </div>
  )
}
