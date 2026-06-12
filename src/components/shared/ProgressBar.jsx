// Thin progress bar primitive. Pure presentational — no state, no Firestore.
// Moved out of src/App.jsx in Phase 19. Behavior preserved exactly.

const O = '#F47920' // Brand orange — kept local to avoid coupling to App.jsx.

export function ProgressBar({ value, color = O, className = '', label }) {
  const v = Math.min(100, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-2 bg-white/10 rounded-full overflow-hidden ${className}`}
    >
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${v}%`, backgroundColor: color }}
      />
    </div>
  )
}
