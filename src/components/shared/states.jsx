import { cn } from '@/lib/utils'
import { AlertTriangleIcon, CheckCircleIcon, InboxIcon, RefreshCwIcon } from 'lucide-react'

const O = '#F47920'

export function EmptyState({
  Icon = InboxIcon,
  title = 'Nothing here yet',
  description,
  action,
  tone = 'neutral',
  className = '',
}) {
  const accent = tone === 'success' ? '#22c55e' : O
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'py-10 px-6 rounded-xl border border-dashed border-white/10',
        className,
      )}
    >
      <div
        className="flex items-center justify-center rounded-xl mb-3"
        style={{
          width: 44,
          height: 44,
          backgroundColor: accent + '22',
          color: accent,
        }}
      >
        <Icon size={20} strokeWidth={2} />
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && (
        <p className="text-xs text-zinc-400 mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function AllClearState({ title = 'All clear', description, className = '' }) {
  return (
    <EmptyState
      Icon={CheckCircleIcon}
      tone="success"
      title={title}
      description={description}
      className={className}
    />
  )
}

export function LoadingState({ label = 'Loading…', className = '' }) {
  return (
    <div className={cn('flex items-center justify-center gap-3 py-10', className)}>
      <span
        className="w-5 h-5 rounded-full border-2 animate-spin"
        style={{ borderColor: O + '33', borderTopColor: O }}
      />
      <p className="text-sm text-zinc-300">{label}</p>
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'Please try again.',
  onRetry,
  className = '',
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'py-8 px-6 rounded-xl border border-red-500/30',
        className,
      )}
      style={{ backgroundColor: '#ef44440a' }}
    >
      <div
        className="flex items-center justify-center rounded-xl mb-3"
        style={{ width: 44, height: 44, backgroundColor: '#ef444422', color: '#ef4444' }}
      >
        <AlertTriangleIcon size={20} strokeWidth={2} />
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-zinc-400 mt-1 max-w-sm">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-200 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 hover:text-white transition-colors"
        >
          <RefreshCwIcon size={13} /> Retry
        </button>
      )}
    </div>
  )
}
