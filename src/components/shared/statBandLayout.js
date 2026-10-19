import { cn } from '@/lib/utils'

// How a stat band lays its cells out. StatBand draws the figures and the loading
// skeleton draws their placeholders, and both take their frame, their grid and the
// span of the last cell from here, so a page does not jump when its figures arrive.
//
// Two across on a phone, four across from 768 pixels, and from 1280 pixels one
// row of equal cells whatever their number. Hairlines come from the cells and not
// from a gap: each cell draws a line on its top and its left, and the grid sits one
// pixel up and left of the frame, which clips the lines on the outer edge. That
// works at every width and for every count, and leaves nothing drawn in the empty
// space after the last cell.

export const BAND_FRAME = 'overflow-hidden rounded-[10px] border border-white/10 bg-white/[0.025]'

export const BAND_CELL = 'min-w-0 border-t border-l border-white/10'

// Fewer than four stats get as many columns as they have, so no column is empty.
const TABLET_COLUMNS = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' }

export function bandGrid(count) {
  return cn(
    '-mt-px -ml-px grid grid-cols-2',
    TABLET_COLUMNS[count] ?? 'md:grid-cols-4',
    // The four columns of md are cleared at xl, which would leave one empty for
    // three stats, and the cells flow into as many columns as there are.
    'xl:grid-cols-none xl:grid-flow-col xl:auto-cols-fr',
  )
}

// The last cell fills the row it ends: the whole of a phone's last row when the
// count is odd, and the whole of a tablet's when a fifth, a ninth and so on would
// stand alone in it. The rest of the cells span nothing.
export function bandCellSpan(index, count) {
  if (index !== count - 1) return undefined
  const phone = count % 2 === 1
  const tablet = count > 4 && count % 4 === 1
  if (!phone && !tablet) return undefined
  return cn(
    phone && 'col-span-2',
    tablet ? 'md:col-span-4' : 'md:col-span-1',
    'xl:col-span-1',
  )
}
