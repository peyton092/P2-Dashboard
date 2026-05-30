// Daily Field Report PDF — mirrors the existing CO/Invoice generators.
// jsPDF is dynamically imported so the heavy lib stays out of the initial
// bundle and only loads on the first export.

const ORANGE = [244, 121, 32]
const BLACK  = [20, 20, 20]
const GRAY   = [120, 120, 120]
const LIGHT  = [230, 230, 230]
const GREEN  = [34, 197, 94]
const AMBER  = [234, 179, 8]
const RED    = [239, 68, 68]

function fmtDate(value) {
  if (!value) return ''
  try {
    let d
    if (typeof value === 'string') {
      // Allow either 'YYYY-MM-DD' or a parseable string
      d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value)
    } else if (value?.seconds) {
      d = new Date(value.seconds * 1000)
    } else {
      d = new Date(value)
    }
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

export async function generateDailyReportPdf(report) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612

  // Orange header bar
  doc.setFillColor(...ORANGE)
  doc.rect(0, 0, W, 70, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('DAILY FIELD REPORT', 40, 38)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('P2 Electrical & Mechanical', 40, 56)

  let y = 100

  // Job + date block
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(report.jobName || report.jobId || 'Untitled job', 40, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...GRAY)
  const meta = [
    report.jobId,
    fmtDate(report.date || report.createdAt),
    report.phase,
  ].filter(Boolean).join('  ·  ')
  if (meta) doc.text(meta, 40, y)
  y += 18

  doc.setDrawColor(...LIGHT)
  doc.line(40, y, W - 40, y)
  y += 18

  // Crew + status row (2 columns)
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('CREW', 40, y)
  doc.text('STATUS', W / 2, y)
  y += 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(report.crewMember || '—', 40, y)
  const statusColor = report.inspectionReady === true ? GREEN
    : (report.blocker && report.blocker !== 'None') ? AMBER : GRAY
  const statusLabel = report.inspectionReady === true ? 'Ready for inspection'
    : (report.blocker && report.blocker !== 'None') ? `Blocker: ${report.blocker}` : 'In progress'
  doc.setTextColor(...statusColor)
  doc.text(statusLabel, W / 2, y)
  doc.setTextColor(...BLACK)
  y += 24

  // Work completed
  const work = Array.isArray(report.workCompleted) ? report.workCompleted : []
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`WORK COMPLETED (${work.length})`, 40, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  if (work.length === 0) {
    doc.setTextColor(...GRAY)
    doc.text('No items checked.', 40, y)
    doc.setTextColor(...BLACK)
    y += 14
  } else {
    work.forEach(item => {
      doc.setFillColor(...GREEN)
      doc.circle(46, y - 3, 2, 'F')
      doc.text(String(item), 56, y)
      y += 14
      if (y > 720) { doc.addPage(); y = 60 }
    })
  }
  y += 8

  // Materials used / needed (two short paragraphs)
  const writeBlock = (label, text, tone = BLACK) => {
    if (!text || !String(text).trim()) return
    if (y > 700) { doc.addPage(); y = 60 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...BLACK)
    doc.text(label, 40, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...tone)
    const lines = doc.splitTextToSize(String(text), W - 80)
    doc.text(lines, 40, y)
    y += lines.length * 12 + 10
    doc.setTextColor(...BLACK)
  }

  writeBlock('MATERIALS USED', report.materialsUsed)
  writeBlock('MATERIALS NEEDED', report.materialsNeeded, AMBER)
  writeBlock('BLOCKER', report.blocker && report.blocker !== 'None' ? report.blocker : '', RED)
  writeBlock('NEXT STEP', report.nextStep)

  // Photos count footnote
  const photoCount = Array.isArray(report.photoUrls) ? report.photoUrls.length : 0
  if (photoCount > 0) {
    if (y > 720) { doc.addPage(); y = 60 }
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY)
    doc.text(`${photoCount} photo${photoCount === 1 ? '' : 's'} attached in the app.`, 40, y)
    y += 14
  }

  // Footer
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text(`Generated ${new Date().toLocaleString()}`, 40, 770)
    doc.text(`Page ${i} of ${pages}`, W - 80, 770)
  }

  const safeJob  = (report.jobId || 'job').replace(/[^\w-]+/g, '-')
  const safeDate = (report.date || new Date().toISOString().slice(0, 10)).replace(/[^\d-]/g, '')
  doc.save(`DailyReport-${safeJob}-${safeDate}.pdf`)
}
