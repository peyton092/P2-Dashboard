// Client-side CSV export. No dependencies — builds the file and triggers a
// download. columns: [{ key, label, get?(row) }]; get() wins over key.

function escapeCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
