import { describe, it, expect } from 'vitest'
import { validateUpload, sanitizeFileName, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_TYPES } from '../uploads'

const TYPE_REASON = 'That file type is not allowed. Upload a JPEG, PNG, HEIC, WebP or PDF.'
const SIZE_REASON = 'That file is larger than 25 MB.'

describe('constants', () => {
  it('match the agreed limits', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024)
    expect(ALLOWED_UPLOAD_TYPES).toEqual(['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'])
  })
})

describe('validateUpload', () => {
  it('rejects a 26 MB jpeg with the size reason', () => {
    expect(validateUpload({ type: 'image/jpeg', size: 26 * 1024 * 1024 })).toEqual({ ok: false, reason: SIZE_REASON })
  })
  it('rejects a zip with the type reason', () => {
    expect(validateUpload({ type: 'application/zip', size: 1024 })).toEqual({ ok: false, reason: TYPE_REASON })
  })
  it('accepts a small pdf', () => {
    expect(validateUpload({ type: 'application/pdf', size: 1024 })).toEqual({ ok: true })
  })
  it('accepts a file exactly at the limit', () => {
    expect(validateUpload({ type: 'image/png', size: MAX_UPLOAD_BYTES })).toEqual({ ok: true })
  })
  it('rejects an empty or missing type', () => {
    expect(validateUpload({ type: '', size: 10 })).toEqual({ ok: false, reason: TYPE_REASON })
    expect(validateUpload({ size: 10 })).toEqual({ ok: false, reason: TYPE_REASON })
  })
  it('checks type before size', () => {
    expect(validateUpload({ type: 'application/zip', size: 99 * 1024 * 1024 })).toEqual({ ok: false, reason: TYPE_REASON })
  })
  it('rejects a missing file', () => {
    expect(validateUpload(null)).toEqual({ ok: false, reason: TYPE_REASON })
  })
})

describe('sanitizeFileName', () => {
  it('strips path traversal', () => {
    expect(sanitizeFileName('../../x.pdf')).toBe('x.pdf')
  })
  it('collapses unsafe runs to one underscore', () => {
    expect(sanitizeFileName('my  photo (1).jpg')).toBe('my_photo_1_.jpg')
  })
  it('caps at 120 characters', () => {
    expect(sanitizeFileName('a'.repeat(200)).length).toBe(120)
  })
  it('falls back to file', () => {
    expect(sanitizeFileName('???')).toBe('file')
    expect(sanitizeFileName('')).toBe('file')
    expect(sanitizeFileName('...')).toBe('file')
    expect(sanitizeFileName(undefined)).toBe('file')
  })
})
