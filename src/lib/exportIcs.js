// Minimal iCalendar (.ics) builder — no dependencies. Emits all-day VEVENTs
// (RFC 5545) and triggers a download. events: [{ uid, date 'YYYY-MM-DD',
// summary, description? }].

function fold(line) {
  // RFC 5545 recommends folding lines longer than 75 octets.
  if (line.length <= 75) return line
  const chunks = []
  let i = 0
  while (i < line.length) {
    chunks.push((i === 0 ? '' : ' ') + line.slice(i, i + 73))
    i += 73
  }
  return chunks.join('\r\n')
}

function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

const stamp = (d = new Date()) =>
  d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function exportToIcs(filename, events) {
  const dtstamp = stamp()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//P2 Field Control//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  ;(events || []).forEach((e, i) => {
    const ymd = (e.date || '').slice(0, 10).replace(/-/g, '')
    if (ymd.length !== 8) return
    lines.push('BEGIN:VEVENT')
    lines.push(fold(`UID:${e.uid || `${ymd}-${i}`}@p2field`))
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART;VALUE=DATE:${ymd}`)
    lines.push(fold(`SUMMARY:${esc(e.summary)}`))
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`))
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
