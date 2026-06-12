import { DownloadIcon } from 'lucide-react'
import { exportToCsv } from '../../lib/exportCsv'

// Standardized "Export" button used by every queue / dashboard. Wraps the
// callsite's pattern: lucide DownloadIcon + brand-grey outline + disabled
// when rows is empty + delegates to exportToCsv (which date-stamps the
// filename so repeated exports stack in Downloads).
//
// Props:
//   filename — string passed to exportToCsv (no extension required).
//   columns  — exportToCsv column spec (label + key|get).
//   rows     — array of row records to export.
//   title    — optional tooltip / aria-label override.
//   label    — optional button label (defaults to "Export").
export function ExportCsvButton({
  filename,
  columns,
  rows,
  title = 'Export the current view to CSV',
  label = 'Export',
}) {
  const empty = !rows || rows.length === 0
  return (
    <button
      type="button"
      onClick={() => exportToCsv(filename, columns, rows)}
      disabled={empty}
      title={title}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      <DownloadIcon size={13} /> {label}
    </button>
  )
}
