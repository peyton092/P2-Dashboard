import { cn } from '@/lib/utils'
import { BAND_CELL, BAND_FRAME, bandCellSpan, bandGrid } from './statBandLayout'

// One strip of figures across the width of the page, for the top of a screen: what
// needs attention, what is blocked, what is ready to bill. The figures are
// separated by hairlines and are not tiles, so nothing here floats as a small
// rounded box.
//
//   <StatBand aria-label="Billing pipeline" stats={[
//     { label: 'Ready to invoice', value: '$48K', sub: '3 jobs', tone: 'success' },
//     { label: 'Aging 30 plus', value: 2, sub: '$12K outstanding', tone: 'critical', onClick },
//   ]} />
//
// A stat is { label, value, sub?, note?, tone?, onClick? }. The tone is a name from
// status.js, brand through mute, and colors the value alone: the words under it say
// what it means, so color is never the only carrier. A stat with an onClick is a
// button that spans its cell. aria-label names the strip as a region.

// Written out in full, because Tailwind finds a class by reading it in the source.
const VALUE_TONE = {
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  critical: 'text-critical',
  info: 'text-info',
  cyan: 'text-cyan',
  neutral: 'text-neutral',
  mute: 'text-mute',
}

function StatCell({ stat, className }) {
  const { label, value, sub, note, tone, onClick } = stat

  // Spans only, so the same markup is valid inside a button.
  const content = (
    <>
      <span className="block text-[11px] leading-tight font-semibold tracking-[0.08em] text-neutral uppercase">
        {label}
      </span>
      {/* The value is 32 pixels, which is large text, so even the dim mute tone
          clears 3 to 1. The lines under it are small, and they stay neutral. */}
      <span
        className={cn(
          'mt-2 block font-display text-[32px] leading-none font-semibold tabular-nums break-words',
          Object.hasOwn(VALUE_TONE, tone) ? VALUE_TONE[tone] : 'text-foreground'
        )}>
        {value}
      </span>
      {sub ? <span className="mt-2 block text-xs leading-snug text-neutral">{sub}</span> : null}
      {note ? <span className="mt-1 block text-[11px] leading-snug text-neutral">{note}</span> : null}
    </>
  )

  return (
    <li data-slot="stat" className={cn(BAND_CELL, className)}>
      {onClick ? (
        // A button centers its content in a cell taller than it, unless it is a column.
        // The focus ring is drawn inside the cell, because the strip clips what is outside it.
        // The shared focus rule is not in a layer, so only an important utility beats its offset.
        <button
          type="button"
          onClick={onClick}
          className="flex h-full w-full cursor-pointer flex-col px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:-outline-offset-2! sm:px-5 sm:py-4">
          {content}
        </button>
      ) : (
        <div className="h-full px-4 py-3 sm:px-5 sm:py-4">{content}</div>
      )}
    </li>
  );
}

function StatBand({ stats, className, ...props }) {
  if (!stats?.length) return null
  return (
    <section data-slot="stat-band" className={cn(BAND_FRAME, className)} {...props}>
      <ul role="list" className={bandGrid(stats.length)}>
        {stats.map((stat, index) => (
          <StatCell key={stat.label} stat={stat} className={bandCellSpan(index, stats.length)} />
        ))}
      </ul>
    </section>
  );
}

export { StatBand }
