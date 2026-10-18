export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']

const TYPE_REASON = 'That file type is not allowed. Upload a JPEG, PNG, HEIC, WebP or PDF.'
const SIZE_REASON = 'That file is larger than 25 MB.'

export function validateUpload(file) {
  if (!file || !file.type || !ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return { ok: false, reason: TYPE_REASON }
  }
  if (!(file.size <= MAX_UPLOAD_BYTES)) {
    return { ok: false, reason: SIZE_REASON }
  }
  return { ok: true }
}

// Safe for use as a single Storage path segment: drops any directory part,
// keeps [A-Za-z0-9._-], collapses other runs to one underscore, strips leading
// dots, caps at 120 characters. Falls back to "file" when nothing usable is left.
export function sanitizeFileName(name) {
  if (typeof name !== 'string') return 'file'
  const base = name.split(/[\\/]/).pop()
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'file'
}
