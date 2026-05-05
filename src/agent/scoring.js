const TODAY = new Date()

function daysSince(date) {
  if (!date) return null
  try {
    const d = date?.toDate ? date.toDate() : new Date(date)
    if (isNaN(d.getTime())) return null
    return Math.floor((TODAY - d) / 86400000)
  } catch { return null }
}

function hasFailedInspection(job) {
  const insp = job.insp || {}
  return Object.values(insp).some(t =>
    Object.values(t || {}).some(s => s === 'failed')
  )
}

function hasPendingInspection(job) {
  const insp = job.insp || {}
  return Object.values(insp).some(t =>
    Object.values(t || {}).some(s => s === 'pending-verification' || s === 'scheduled')
  )
}

function isHvacStartupBlocked(job) {
  const trades = (job.type || '').toLowerCase()
  if (!trades.includes('hvac') && !(job.subs?.hvac)) return false
  const insp = job.insp || {}
  const hvacRough = insp.hvac?.roughIn
  const eServiceRelease = job.phase?.includes('service-release') || job.eServiceRelease === 'obtained'
  return hvacRough === 'passed' && !eServiceRelease
}

function isBillingReady(job, extras) {
  if (job.billingStatus === 'invoiced' || job.billingStatus === 'paid') return false
  const insp = job.insp || {}
  const anyFinal = ['electrical', 'plumbing', 'hvac'].some(t => insp[t]?.final === 'passed')
  const anyRough = ['electrical', 'plumbing', 'hvac'].some(t => insp[t]?.roughIn === 'passed')
  return anyFinal || anyRough
}

// ── Priority score 0–100 ──────────────────────────────────────────────────────

export function scoreJob(job, extras = []) {
  if (['complete', 'completed'].includes(job.status)) return 0

  let score = 0

  // Failed inspection → immediate top priority
  if (hasFailedInspection(job)) score += 80

  // HVAC startup blocked → high priority
  if (isHvacStartupBlocked(job)) score += 60

  // Needs action status
  if (job.status === 'needs-action') score += 40

  // Stale job (no update)
  const stale = daysSince(job.lastStatusChange || job.start)
  if (stale !== null) {
    if (stale >= 7)  score += 35
    else if (stale >= 3) score += 20
    else if (stale >= 2) score += 10
  }

  // Billing ready but not invoiced
  if (isBillingReady(job, extras)) score += 25

  // Inspection pending (needs coordination)
  if (hasPendingInspection(job)) score += 15

  // High progress = closer to completion = higher priority
  const progress = job.progress || 0
  if (progress >= 75) score += 10
  else if (progress >= 50) score += 5

  return Math.min(100, score)
}

// ── Classify job for War Room risk board ─────────────────────────────────────

export function classifyRisk(job) {
  if (['complete', 'completed'].includes(job.status)) return null

  const stale = daysSince(job.lastStatusChange || job.start)
  const failed = hasFailedInspection(job)
  const hvacBlocked = isHvacStartupBlocked(job)

  if (failed) return { level: 'critical', reason: 'Failed inspection — rework required' }
  if (hvacBlocked) return { level: 'critical', reason: 'HVAC startup blocked — E service missing' }
  if (stale !== null && stale >= 7) return { level: 'critical', reason: `Stalled ${stale} days — no update` }
  if (stale !== null && stale >= 3) return { level: 'warning', reason: `${stale} days since last update` }
  if (job.status === 'needs-action') return { level: 'warning', reason: 'Status: Needs Action' }
  if (stale !== null && stale >= 2) return { level: 'info', reason: '48h+ without update' }
  return null
}

export { daysSince, hasFailedInspection, isBillingReady, isHvacStartupBlocked }
