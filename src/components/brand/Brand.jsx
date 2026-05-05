import { useEffect, useState } from 'react'

const O = '#F47920'

// P2 brand mark.
//
// Behavior:
//   1. If `public/p2-logo.svg` exists, the full lockup uses it via <img>.
//   2. If `public/p2-mark.svg` exists, the icon-only mark uses it via <img>.
//   3. Otherwise, a clearly-marked SVG placeholder renders (orange circle +
//      gear ring + lightning bolt) using only the brand orange `#F47920`
//      already present in the codebase. No new colors are introduced.
//
// To replace the placeholder with the official artwork:
//   - Drop the full lockup at:   public/p2-logo.svg
//   - Drop the icon-only mark at: public/p2-mark.svg
// The component will pick them up automatically — no code change required.

const LOGO_PATH = '/p2-logo.svg'
const MARK_PATH = '/p2-mark.svg'

function useAssetExists(path) {
  const [ok, setOk] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(path, { method: 'HEAD' })
      .then(r => { if (!cancelled) setOk(r.ok && (r.headers.get('content-type') || '').includes('svg')) })
      .catch(() => { if (!cancelled) setOk(false) })
    return () => { cancelled = true }
  }, [path])
  return ok
}

export function BrandMark({ size = 36, className = '', title = 'P2 Electrical & Mechanical' }) {
  const hasMark = useAssetExists(MARK_PATH)

  if (hasMark) {
    return (
      <img
        src={MARK_PATH}
        alt={title}
        width={size}
        height={size}
        className={className}
        style={{ display: 'block' }}
      />
    )
  }

  // Inline placeholder mark — orange circle + gear ring + lightning bolt.
  // Uses only the existing brand orange.
  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
    >
      <title>{title}</title>
      {/* Gear ring (12 teeth) — same orange */}
      <g fill={O}>
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * Math.PI * 2) / 12
          const x = 32 + Math.cos(a) * 28
          const y = 32 + Math.sin(a) * 28
          return (
            <rect
              key={i}
              x={x - 3}
              y={y - 5}
              width="6"
              height="10"
              rx="1.5"
              transform={`rotate(${(i * 360) / 12} ${x} ${y})`}
            />
          )
        })}
      </g>
      {/* Solid orange disc */}
      <circle cx="32" cy="32" r="24" fill={O} />
      {/* Inner ring cutout for gear feel */}
      <circle cx="32" cy="32" r="20" fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="1.5" />
      {/* Lightning bolt — black for high contrast on orange */}
      <path
        d="M34 16 L22 36 L30 36 L28 50 L42 28 L34 28 Z"
        fill="#0a0a0a"
      />
    </svg>
  )
}

export function BrandWord({ tone = 'light', className = '' }) {
  // Wordmark: "P2" + sub "ELECTRICAL & MECHANICAL"
  const titleColor = tone === 'light' ? '#ffffff' : '#0a0a0a'
  const subColor   = tone === 'light' ? '#9ca3af' : '#4b5563'
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span
        className="font-black tracking-tight"
        style={{ color: titleColor, fontSize: '1.05rem', letterSpacing: '-0.02em' }}
      >
        P2
      </span>
      <span
        className="font-semibold"
        style={{
          color: subColor,
          fontSize: '0.55rem',
          letterSpacing: '0.08em',
          marginTop: '2px',
        }}
      >
        ELECTRICAL &amp; MECHANICAL
      </span>
    </div>
  )
}

export default function Brand({
  size = 36,
  showWord = true,
  tone = 'light',
  layout = 'horizontal',
  className = '',
}) {
  const hasFullLogo = useAssetExists(LOGO_PATH)

  if (hasFullLogo && showWord) {
    return (
      <img
        src={LOGO_PATH}
        alt="P2 Electrical & Mechanical"
        height={size}
        className={className}
        style={{ display: 'block', height: size, width: 'auto' }}
      />
    )
  }

  if (layout === 'stacked') {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`}>
        <BrandMark size={size} />
        {showWord && <BrandWord tone={tone} className="items-center text-center" />}
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      {showWord && <BrandWord tone={tone} />}
    </div>
  )
}
