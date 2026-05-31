import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const O = '#F47920'

// Tri-state header checkbox for "select all visible" bulk-action UIs.
// state: 'all' | 'some' | 'none'.
// All-state shows a check, some-state shows a dash, none-state is empty.
// aria-checked uses 'mixed' for the partial state so assistive tech reads it
// as a tri-state checkbox.
export function MasterCheckbox({ state, onClick, ariaLabel }) {
  const checked = state === 'all'
  const partial = state === 'some'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked ? true : partial ? 'mixed' : false}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'w-4 h-4 rounded border transition-colors inline-flex items-center justify-center',
        checked || partial ? 'text-white' : 'bg-white/[0.04] border-white/20 text-transparent hover:border-white/40',
      )}
      style={checked || partial ? { backgroundColor: O, borderColor: O } : undefined}
    >
      {partial
        ? <span className="w-2 h-[1.5px] bg-white rounded" />
        : <CheckIcon size={11} strokeWidth={3} />}
    </button>
  )
}
