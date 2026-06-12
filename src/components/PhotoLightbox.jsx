import { useEffect, useCallback, useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, XIcon, DownloadIcon, ExternalLinkIcon } from 'lucide-react'
import { useFocusTrap } from '../lib/useFocusTrap'

// Reusable image lightbox. Renders fullscreen when `index >= 0`; expects the
// parent to own the index (so the same photo grid stays in sync). Closes on
// backdrop click, Esc, or the X button; navigates with the arrow keys.
//
//   photos: [{ url, name? }]
//   index:  number   — currently open photo, or -1 to close
//   onClose()        — called when user dismisses
//   onIndexChange(i) — called when user navigates prev/next
export default function PhotoLightbox({ photos = [], index = -1, onClose, onIndexChange }) {
  const total = photos.length
  const open = index >= 0 && index < total
  const photo = open ? photos[index] : null
  const dialogRef = useRef(null)
  useFocusTrap(dialogRef, open)

  const go = useCallback((delta) => {
    if (!open) return
    const next = (index + delta + total) % total
    onIndexChange?.(next)
  }, [open, index, total, onIndexChange])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, go])

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={photo.name || 'Photo'}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 text-zinc-200">
        <div className="text-xs">
          <span className="font-semibold">{index + 1}</span>
          <span className="text-zinc-400"> / {total}</span>
          {photo.name && <span className="ml-3 text-zinc-400 truncate max-w-[40vw] inline-block align-middle">{photo.name}</span>}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={photo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white"
            title="Open in new tab"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLinkIcon size={16} />
          </a>
          <a
            href={photo.url}
            download={photo.name || ''}
            className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            <DownloadIcon size={16} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white"
            aria-label="Close"
            title="Close (Esc)"
          >
            <XIcon size={18} />
          </button>
        </div>
      </div>

      {/* Prev / Next */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(-1) }}
            className="absolute left-2 sm:left-4 p-2 rounded-full bg-white/5 hover:bg-white/15 text-zinc-200"
            aria-label="Previous photo (left arrow)"
          >
            <ChevronLeftIcon size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(1) }}
            className="absolute right-2 sm:right-4 p-2 rounded-full bg-white/5 hover:bg-white/15 text-zinc-200"
            aria-label="Next photo (right arrow)"
          >
            <ChevronRightIcon size={22} />
          </button>
        </>
      )}

      {/* Image */}
      <img
        src={photo.url}
        alt={photo.name || 'Jobsite photo'}
        className="max-w-[92vw] max-h-[86vh] object-contain rounded-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
