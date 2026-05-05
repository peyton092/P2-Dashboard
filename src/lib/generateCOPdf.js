import { jsPDF } from 'jspdf'

const ORANGE     = [244, 121, 32]
const BLACK      = [20, 20, 20]
const GRAY       = [120, 120, 120]
const LIGHT_GRAY = [230, 230, 230]
const WHITE      = [255, 255, 255]

const STATUS_COLORS = {
  'Draft':           [107, 114, 128],
  'Sent to Builder': [59,  130, 246],
  'Approved':        [34,  197, 94],
  'Rejected':        [239, 68,  68],
}

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function generateCOPdf(co, jobLabel) {
  const doc  = new jsPDF({ unit: 'pt', format: 'letter' })
  const W    = 612
  const H    = 792
  const M    = 48          // margin
  const cW   = W - M * 2  // content width

  // ── Header bar ──────────────────────────────────────────────────────────────
  doc.setFillColor(...ORANGE)
  doc.rect(0, 0, W, 72, 'F')

  // P2 wordmark
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...WHITE)
  doc.text('P2', M, 47)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setCharSpace(2)
  doc.text('FIELD CONTROL', M + 40, 47)
  doc.setCharSpace(0)

  // CO title (right-aligned)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('CHANGE ORDER', W - M, 34, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(co.coNumber || '', W - M, 52, { align: 'right' })

  // ── Info block ───────────────────────────────────────────────────────────────
  let y = 96

  const COLS3 = [M, M + 200, M + 360]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setCharSpace(1)
  doc.setTextColor(...GRAY)
  doc.text('JOB',    COLS3[0], y)
  doc.text('DATE',   COLS3[1], y)
  doc.text('STATUS', COLS3[2], y)
  doc.setCharSpace(0)

  y += 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text(jobLabel || co.job || '—', COLS3[0], y, { maxWidth: 186 })
  doc.text(co.date || '—',           COLS3[1], y)

  const sc = STATUS_COLORS[co.status] || GRAY
  doc.setTextColor(...sc)
  doc.text((co.status || 'Draft').toUpperCase(), COLS3[2], y)
  doc.setTextColor(...BLACK)

  y += 28
  doc.setDrawColor(...LIGHT_GRAY)
  doc.setLineWidth(1)
  doc.line(M, y, W - M, y)
  y += 16

  // ── Line items table ─────────────────────────────────────────────────────────
  const TC = {
    desc:  { x: M,       w: 238 },
    qty:   { x: M + 242, w: 48  },
    unit:  { x: M + 294, w: 46  },
    price: { x: M + 344, w: 84  },
    ext:   { x: M + 432, w: 84  },
  }

  // Header row
  doc.setFillColor(240, 240, 240)
  doc.rect(M, y, cW, 20, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setCharSpace(0.5)
  doc.setTextColor(...GRAY)
  doc.text('DESCRIPTION',  TC.desc.x + 4,                    y + 14)
  doc.text('QTY',          TC.qty.x  + TC.qty.w,             y + 14, { align: 'right' })
  doc.text('UNIT',         TC.unit.x + TC.unit.w / 2,        y + 14, { align: 'center' })
  doc.text('UNIT PRICE',   TC.price.x + TC.price.w,          y + 14, { align: 'right' })
  doc.text('EXTENDED',     TC.ext.x   + TC.ext.w - 4,        y + 14, { align: 'right' })
  doc.setCharSpace(0)
  y += 20

  // Data rows
  const lineItems = co.lineItems || []
  lineItems.forEach((li, i) => {
    const rH = 22
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 250)
      doc.rect(M, y, cW, rH, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...BLACK)
    doc.text(li.desc || '',  TC.desc.x + 4,             y + 15, { maxWidth: TC.desc.w - 8 })
    doc.text(String(li.qty ?? 1), TC.qty.x + TC.qty.w,  y + 15, { align: 'right' })
    doc.text(li.unit || 'EA', TC.unit.x + TC.unit.w / 2, y + 15, { align: 'center' })
    doc.text(money(li.unitPrice), TC.price.x + TC.price.w, y + 15, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...ORANGE)
    doc.text(money(li.extPrice), TC.ext.x + TC.ext.w - 4, y + 15, { align: 'right' })
    y += rH
  })

  doc.setDrawColor(...LIGHT_GRAY)
  doc.setLineWidth(0.75)
  doc.line(M, y, W - M, y)
  y += 18

  // ── Totals ───────────────────────────────────────────────────────────────────
  const tLabelX = W - M - 195
  const tValueX = W - M

  function totRow(label, value, opts = {}) {
    const { bold, big, color } = opts
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(big ? 13 : 9.5)
    doc.setTextColor(...(color || GRAY))
    doc.text(label, tLabelX, y)
    doc.setTextColor(...(color || (bold ? BLACK : GRAY)))
    doc.text(value, tValueX, y, { align: 'right' })
    y += big ? 20 : 15
  }

  totRow('Subtotal', money(co.subtotal ?? co.amount ?? 0))
  totRow(`Markup (${co.markupPct ?? 15}%)`, money(co.markup ?? 0))

  y += 3
  doc.setDrawColor(...LIGHT_GRAY)
  doc.setLineWidth(0.75)
  doc.line(tLabelX, y, W - M, y)
  y += 10

  totRow('TOTAL', money(co.total ?? co.amount ?? 0), { bold: true, big: true, color: ORANGE })
  y += 12

  // ── Notes ────────────────────────────────────────────────────────────────────
  if (co.notes) {
    doc.setDrawColor(...LIGHT_GRAY)
    doc.line(M, y, W - M, y)
    y += 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setCharSpace(1)
    doc.setTextColor(...GRAY)
    doc.text('NOTES / JUSTIFICATION', M, y)
    doc.setCharSpace(0)
    y += 13
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...BLACK)
    const lines = doc.splitTextToSize(co.notes, cW)
    doc.text(lines, M, y)
    y += lines.length * 12 + 16
  }

  // ── Signature lines ───────────────────────────────────────────────────────────
  if (y > H - 145) {
    doc.addPage()
    y = 60
  }
  const sigY = Math.max(y + 24, H - 145)
  const halfW = cW / 2 - 16
  const sig1X = M
  const sig2X = M + cW / 2 + 16

  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.line(sig1X, sigY + 48, sig1X + halfW, sigY + 48)
  doc.line(sig2X, sigY + 48, sig2X + halfW, sigY + 48)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text('Contractor Signature & Date',       sig1X, sigY + 60)
  doc.text('Owner / Builder Signature & Date',  sig2X, sigY + 60)
  doc.text('Authorized Representative',         sig1X, sigY + 71)
  doc.text('Authorized Representative',         sig2X, sigY + 71)

  // ── Footer ────────────────────────────────────────────────────────────────────
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('Generated by P2 Field Control', W / 2, H - 18, { align: 'center' })
  doc.text(`Printed: ${new Date().toLocaleDateString()}`, W - M, H - 18, { align: 'right' })

  doc.save(`${co.coNumber || 'ChangeOrder'}.pdf`)
}
