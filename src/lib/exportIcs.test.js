import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { exportToIcs } from './exportIcs'

describe('exportToIcs', () => {
  let createObjectURL, revokeObjectURL, anchorClick, capturedBlob, lastAnchor

  beforeEach(() => {
    capturedBlob = null
    lastAnchor = null
    createObjectURL = vi.fn((blob) => {
      capturedBlob = blob
      return 'blob:fake'
    })
    revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    // Stub anchor.click so jsdom doesn't try to navigate. Also remember the
    // most recently clicked anchor so tests can read its href / download.
    anchorClick = vi.fn(function () { lastAnchor = this })
    HTMLAnchorElement.prototype.click = anchorClick
  })
  afterEach(() => {
    delete HTMLAnchorElement.prototype.click
  })

  async function blobText() {
    return capturedBlob ? await capturedBlob.text() : ''
  }

  it('emits a valid VCALENDAR wrapper', async () => {
    exportToIcs('test', [{ uid: '1', date: '2025-05-15', summary: 'Sample' }])
    const text = await blobText()
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text.includes('END:VCALENDAR')).toBe(true)
    expect(text.includes('VERSION:2.0')).toBe(true)
  })

  it('emits VEVENT entries for each event', async () => {
    exportToIcs('test', [
      { uid: 'a', date: '2025-05-15', summary: 'First' },
      { uid: 'b', date: '2025-06-20', summary: 'Second' },
    ])
    const text = await blobText()
    const begins = (text.match(/BEGIN:VEVENT/g) || []).length
    expect(begins).toBe(2)
    expect(text.includes('DTSTART;VALUE=DATE:20250515')).toBe(true)
    expect(text.includes('DTSTART;VALUE=DATE:20250620')).toBe(true)
  })

  it('skips events with an invalid date', async () => {
    exportToIcs('test', [
      { uid: 'a', date: '2025-05-15', summary: 'Valid' },
      { uid: 'b', date: 'invalid',     summary: 'Skip me' },
    ])
    const text = await blobText()
    expect((text.match(/BEGIN:VEVENT/g) || []).length).toBe(1)
  })

  it('escapes commas, semicolons, and backslashes in summary', async () => {
    exportToIcs('test', [{ uid: '1', date: '2025-05-15', summary: 'Hello, world; \\path' }])
    const text = await blobText()
    expect(text).toMatch(/SUMMARY:Hello\\, world\\; \\\\path/)
  })

  it('stamps the filename with today\'s date when no extension', async () => {
    exportToIcs('schedule', [{ uid: '1', date: '2025-05-15', summary: 'X' }])
    const d = new Date()
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(lastAnchor.getAttribute('download')).toBe(`schedule_${ymd}.ics`)
  })

  it('preserves an existing .ics extension verbatim', async () => {
    exportToIcs('schedule.ics', [{ uid: '1', date: '2025-05-15', summary: 'X' }])
    expect(lastAnchor.getAttribute('download')).toBe('schedule.ics')
  })

  it('does not re-stamp a name that already has a date suffix', async () => {
    exportToIcs('schedule_2025-01-01', [{ uid: '1', date: '2025-05-15', summary: 'X' }])
    expect(lastAnchor.getAttribute('download')).toBe('schedule_2025-01-01.ics')
  })

  it('triggers the download and cleans up the object URL', async () => {
    exportToIcs('x', [{ uid: '1', date: '2025-05-15', summary: 'Y' }])
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('handles an empty events list — just emits an empty calendar', async () => {
    exportToIcs('test', [])
    const text = await blobText()
    expect(text.includes('BEGIN:VEVENT')).toBe(false)
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text.includes('END:VCALENDAR')).toBe(true)
  })
})
