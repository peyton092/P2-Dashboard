import { XIcon } from 'lucide-react'

const O = '#F47920'

// BulkActionBar — sticky-top container for bulk-action UIs across the queue
// tabs. Renders the "N selected" count, the optional "Select all M visible"
// link, the page-specific action slot, and a Clear button. Each page passes
// its own action buttons / selects as children to keep the per-page mutation
// logic local.
//
// Props:
//   count                — number of selected items
//   busy                 — disables every interactive child
//   onClear              — called when the Clear button is clicked
//   visibleIds           — array of ids currently in view; enables Select-all
//   onSelectAllVisible   — handler that selects every visibleId
//   ariaLabel            — region label for assistive tech
//   countSuffix          — copy after the count (e.g. "selected" / "items")
//   children             — page-specific action slot (selects, buttons)
export function BulkActionBar({
  count,
  busy = false,
  onClear,
  visibleIds,
  onSelectAllVisible,
  ariaLabel = 'Bulk actions',
  countSuffix = 'selected',
  children,
}) {
  const allVisibleSelected = visibleIds && visibleIds.length > 0 && visibleIds.length === count
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className="sticky top-0 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-orange-400/30 bg-zinc-900/95 backdrop-blur-md px-3 py-2 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: O }}
    >
      <span className="text-xs font-bold text-white">{count} {countSuffix}</span>
      {busy && (
        <span
          className="w-3.5 h-3.5 rounded-full border-2 animate-spin"
          style={{ borderColor: O + '33', borderTopColor: O }}
          aria-label="Working…"
          role="status"
        />
      )}
      {visibleIds && !allVisibleSelected && (
        <button
          type="button"
          onClick={onSelectAllVisible}
          disabled={busy}
          className="text-[11px] font-semibold text-zinc-300 hover:text-white underline-offset-2 hover:underline disabled:opacity-60"
        >
          Select all {visibleIds.length} visible
        </button>
      )}
      {children}
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-300 hover:text-white px-2 py-1.5 rounded-md hover:bg-white/5 disabled:opacity-60"
      >
        <XIcon size={12} /> Clear
      </button>
    </div>
  )
}
