// Money helpers. A missing amount is null and is never replaced by a default,
// an estimate or a percentage of something else. Pure, no React or Firestore.

function toAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export function contractValue(job) {
  return toAmount(job?.contractValue)
}

export function invoiceAmount(job) {
  return toAmount(job?.invoiceAmount)
}

export function fmtMoney(n) {
  if (n === null || n === undefined) return 'No contract value'
  return '$' + Math.round(Number(n)).toLocaleString('en-US')
}

function sumBy(jobs, read) {
  let total = 0
  let missing = 0
  for (const job of jobs || []) {
    const v = read(job)
    if (v === null) missing += 1
    else total += v
  }
  return { total, missing }
}

export function sumContracts(jobs) {
  return sumBy(jobs, contractValue)
}

export function sumInvoices(jobs) {
  return sumBy(jobs, invoiceAmount)
}

export function missingNote(count, kind) {
  if (!count || count <= 0) return ''
  const what = kind === 'invoice' ? 'invoice amount' : 'contract value'
  return count === 1
    ? `1 job has no ${what} and is excluded`
    : `${count} jobs have no ${what} and are excluded`
}
