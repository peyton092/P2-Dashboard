import { jsPDF } from 'jspdf'

const ORANGE     = [244, 121, 32]
const BLACK      = [20, 20, 20]
const GRAY       = [120, 120, 120]
const LIGHT_GRAY = [230, 230, 230]
const WHITE      = [255, 255, 255]
const GREEN      = [34, 197, 94]

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseDateStr(str) {
  if (!str) return null
  const [m, d, y] = str.split('/')
  if (!m || !d || !y) return null
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function generateInvoicePdf(job) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612
  const H = 792
  const M = 48
  const cW = W - M * 2

  // ── Header ───────────────────────────────────────────────────────────────────
  doc.setFillColor(...ORANGE)
  doc.rect(0, 0, W, 72, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...WHITE)
  doc.text('P2', M, 47)

  doc.setFontSize(9)
  doc.setCharSpace(2)
  doc.text('FIELD CONTROL', M + 40, 47)
  doc.setCharSpace(0)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('INVOICE', W - M, 34, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`#${job.invoiceNum || '—'}`, W - M, 52, { align: 'right' })

  // ── Info block ───────────────────────────────────────────────────────────────
  let y = 96
  const C1 = M
  const C2 = M + 210
  const C3 = M + 380

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setCharSpace(1)
  doc.setTextColor(...GRAY)
  doc.text('BILL TO',       C1, y)
  doc.text('JOB',           C2, y)
  doc.text('INVOICE DATE',  C3, y)
  doc.setCharSpace(0)

  y += 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text(job.client || job.name || '—', C1, y, { maxWidth: 190 })
  doc.text(job.name   || job.id  || '—', C2, y, { maxWidth: 160 })
  doc.text(job.invoiceDate || '—',        C3, y)

  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(job.id || '',       C2, y)

  // Due date (net 30)
  const invoiceDateObj = parseDateStr(job.invoiceDate)
  const dueDate = invoiceDateObj ? addDays(invoiceDateObj, 30) : '—'

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setCharSpace(1)
  y += 22
  doc.text('DUE DATE', C3, y)
  doc.setCharSpace(0)
  y += 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...ORANGE)
  doc.text(dueDate, C3, y)
  doc.setTextColor(...BLACK)

  y += 22
  doc.setDrawColor(...LIGHT_GRAY)
  doc.setLineWidth(1)
  doc.line(M, y, W - M, y)
  y += 20

  // ── Line items ────────────────────────────────────────────────────────────────
  const contractValue = job.contractValue || 18000
  const lineItems = [
    { desc: job.type || 'MEP Services', detail: `Project: ${job.id} — ${job.name || job.client}`, amount: contractValue },
  ]

  // Table header
  doc.setFillColor(240, 240, 240)
  doc.rect(M, y, cW, 22, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setCharSpace(0.5)
  doc.setTextColor(...GRAY)
  doc.text('DESCRIPTION',  M + 4, y + 15)
  doc.text('AMOUNT',       W - M - 4, y + 15, { align: 'right' })
  doc.setCharSpace(0)
  y += 22

  lineItems.forEach((li, i) => {
    const rH = 34
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 250)
      doc.rect(M, y, cW, rH, 'F')
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...BLACK)
    doc.text(li.desc, M + 4, y + 13, { maxWidth: cW - 140 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...GRAY)
    doc.text(li.detail || '', M + 4, y + 26, { maxWidth: cW - 140 })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ORANGE)
    doc.text(money(li.amount), W - M - 4, y + 18, { align: 'right' })
    y += rH
  })

  doc.setDrawColor(...LIGHT_GRAY)
  doc.setLineWidth(0.75)
  doc.line(M, y, W - M, y)
  y += 20

  // ── Total ─────────────────────────────────────────────────────────────────────
  const tLabelX = W - M - 200
  const tValueX = W - M

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...GRAY)
  doc.text('Subtotal', tLabelX, y)
  doc.text(money(contractValue), tValueX, y, { align: 'right' })
  y += 16
  doc.text('Tax (0%)', tLabelX, y)
  doc.text('$0.00', tValueX, y, { align: 'right' })
  y += 8
  doc.setDrawColor(...LIGHT_GRAY)
  doc.line(tLabelX, y, W - M, y)
  y += 14

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...ORANGE)
  doc.text('TOTAL DUE', tLabelX, y)
  doc.text(money(contractValue), tValueX, y, { align: 'right' })
  y += 30

  // ── Payment instructions ──────────────────────────────────────────────────────
  if (y < H - 200) {
    doc.setDrawColor(...LIGHT_GRAY)
    doc.setLineWidth(0.75)
    doc.line(M, y, W - M, y)
    y += 16

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setCharSpace(1)
    doc.setTextColor(...GRAY)
    doc.text('PAYMENT INSTRUCTIONS', M, y)
    doc.setCharSpace(0)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...BLACK)
    doc.text('Make checks payable to P2 Electrical & Mechanical.', M, y)
    y += 13
    doc.text('ACH / Wire details available upon request.', M, y)
    y += 13
    doc.text(`Payment due within 30 days of invoice date.`, M, y)
  }

  // ── Status badge (INVOICED) ──────────────────────────────────────────────────
  doc.setFillColor(...GREEN)
  doc.roundedRect(W - M - 76, 84, 76, 18, 4, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setCharSpace(1)
  doc.setTextColor(...WHITE)
  doc.text('INVOICED', W - M - 38, 96, { align: 'center' })
  doc.setCharSpace(0)

  // ── Footer ────────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('P2 Electrical & Mechanical  ·  Middle Tennessee', W / 2, H - 28, { align: 'center' })
  doc.text('Generated by P2 Field Control', W / 2, H - 16, { align: 'center' })
  doc.text(`Printed: ${new Date().toLocaleDateString()}`, W - M, H - 16, { align: 'right' })

  doc.save(`Invoice-${job.invoiceNum || job.id}.pdf`)
}
