// Client-side CSV export. No dependencies — builds the file and triggers a
// download. columns: [{ key, label, get?(row) }]; get() wins over key.

function escapeCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Stamp the filename with today's date so repeated exports stack in the
// Downloads folder instead of overwriting each other. Caller-supplied .csv
// extensions and pre-stamped names are respected as-is.
function stampedFilename(filename) {
  if (filename.endsWith('.csv')) return filename
  if (/_\d{4}-\d{2}-\d{2}$/.test(filename)) return `${filename}.csv`
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${filename}_${ymd}.csv`
}

export function exportToCsv(filename, columns, rows) {
  const header = columns.map(c => escapeCell(c.label)).join(',')
  const body = (rows || []).map(row =>
    columns.map(c => escapeCell(c.get ? c.get(row) : row[c.key])).join(','),
  )
  const csv = [header, ...body].join('\r\n')

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = stampedFilename(filename)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
