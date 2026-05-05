import { getZoneId, getZoneName, ZONES } from './zones'
import { daysSince, hasFailedInspection, isBillingReady, isHvacStartupBlocked } from './scoring'

// Deterministic alert ID so we can dedup in Firestore
export function alertId(jobId, type) {
  return jobId ? `${jobId}_${type}` : `global_${type}_${Date.now()}`
}

// ── Core alert generators ─────────────────────────────────────────────────────

function stalledAlerts(jobs) {
  const alerts = []
  const active = jobs.filter(j => !['complete', 'completed', 'pending'].includes(j.status))
  for (const job of active) {
    const days = daysSince(job.lastStatusChange || job.start)
    if (days === null) continue
    if (days >= 5) {
      alerts.push({
        id:             alertId(job.id, 'stalled'),
        jobId:          job.id,
        jobName:        job.name || job.id,
        type:           'stalled',
        severity:       'critical',
        title:          `Stalled ${days} days — ${job.name || job.id}`,
        description:    `No update in ${days} days. Last status: ${job.phase || job.status}.`,
        recommendation: `Contact PM ${job.pm} and lead ${job.lead || '—'} for status. Verify if work is done but not logged.`,
        pm:             job.pm,
        zoneId:         getZoneId(job),
        status:         'open',
      })
    } else if (days >= 2) {
      alerts.push({
        id:             alertId(job.id, 'stalled'),
        jobId:          job.id,
        jobName:        job.name || job.id,
        type:           'stalled',
        severity:       days >= 3 ? 'warning' : 'info',
        title:          `${days} days since update — ${job.name || job.id}`,
        description:    `Last activity ${days} days ago. Phase: ${job.phase || job.status}.`,
        recommendation: `Add a status note or schedule a site visit today.`,
        pm:             job.pm,
        zoneId:         getZoneId(job),
        status:         'open',
      })
    }
  }
  return alerts
}

function hvacBlockedAlerts(jobs) {
  const alerts = []
  for (const job of jobs) {
    if (['complete', 'completed'].includes(job.status)) continue
    const hasSubs = job.subs?.hvac
    const hasHvacTrade = (job.type || '').toLowerCase().includes('hvac')
    if (!hasSubs && !hasHvacTrade) continue

    const insp   = job.insp || {}
    const hvacRI = insp.hvac?.roughIn
    if (hvacRI !== 'passed') continue

    const eServiceOk = (job.phase || '').includes('service-release') || job.eServiceRelease === 'obtained'
    if (eServiceOk) continue

    const blockers = []
    if (!eServiceOk) blockers.push('E service release not obtained')
    if (!job.ePowerOn) blockers.push('Power not on / meter not set')
    if (!job.eDisconnectsInstalled) blockers.push('Disconnects not installed')

    alerts.push({
      id:             alertId(job.id, 'hvac_blocked'),
      jobId:          job.id,
      jobName:        job.name || job.id,
      type:           'hvac_blocked',
      severity:       'critical',
      title:          `HVAC startup blocked — ${job.name || job.id}`,
      description:    `H rough passed but startup cannot proceed. Missing: ${blockers.join('; ')}.`,
      recommendation: `Resolve E-side requirements before scheduling ${job.subs?.hvac || 'HVAC sub'} for startup.`,
      pm:             job.pm,
      zoneId:         getZoneId(job),
      status:         'open',
    })
  }
  return alerts
}

function failedInspectionAlerts(jobs) {
  const alerts = []
  for (const job of jobs) {
    if (['complete', 'completed'].includes(job.status)) continue
    const insp = job.insp || {}
    const failedTrades = []
    for (const [trade, phases] of Object.entries(insp)) {
      for (const [phase, result] of Object.entries(phases || {})) {
        if (result === 'failed') failedTrades.push(`${trade} ${phase}`)
      }
    }
    if (failedTrades.length === 0) continue
    alerts.push({
      id:             alertId(job.id, 'inspection_failed'),
      jobId:          job.id,
      jobName:        job.name || job.id,
      type:           'inspection_failed',
      severity:       'critical',
      title:          `Failed inspection — ${job.name || job.id}`,
      description:    `Inspection failure: ${failedTrades.join(', ')}. Rework required before re-call.`,
      recommendation: `Contact PM ${job.pm} and ${failedTrades.map(t => job.subs?.[t.split(' ')[0]] || 'sub').join(', ')} immediately. Schedule rework.`,
      pm:             job.pm,
      zoneId:         getZoneId(job),
      status:         'open',
    })
  }
  return alerts
}

function noNextActionAlerts(jobs) {
  const alerts = []
  const active = jobs.filter(j => !['complete', 'completed', 'pending'].includes(j.status))
  for (const job of active) {
    if (job.nextAction && job.nextAction.trim() !== '') continue
    alerts.push({
      id:             alertId(job.id, 'no_next_action'),
      jobId:          job.id,
      jobName:        job.name || job.id,
      type:           'no_next_action',
      severity:       'warning',
      title:          `No next action — ${job.name || job.id}`,
      description:    `Active job with no defined next step. Phase: ${job.phase || job.status}.`,
      recommendation: `Define next action: inspection call-in? Material order? Crew dispatch? Sub scheduling?`,
      pm:             job.pm,
      zoneId:         getZoneId(job),
      status:         'open',
    })
  }
  return alerts
}

function billingReadyAlerts(jobs, extras) {
  const alerts = []
  for (const job of jobs) {
    if (!isBillingReady(job, extras)) continue
    const insp = job.insp || {}
    const passedPhases = []
    for (const [trade, phases] of Object.entries(insp)) {
      for (const [phase, result] of Object.entries(phases || {})) {
        if (result === 'passed') passedPhases.push(`${trade} ${phase}`)
      }
    }
    const contractVal = job.contractValue || 18000
    const pct  = passedPhases.some(p => p.includes('final')) ? 0.30 : 0.70
    const amt  = Math.round(contractVal * pct)
    const milestone = passedPhases.some(p => p.includes('final')) ? 'Final (30%)' : 'Rough (70%)'
    alerts.push({
      id:             alertId(job.id, 'billing_ready'),
      jobId:          job.id,
      jobName:        job.name || job.id,
      type:           'billing_ready',
      severity:       'info',
      title:          `Ready to bill — ${job.name || job.id} ${milestone}`,
      description:    `Inspection passed. Estimated billable: $${amt.toLocaleString()} (${milestone} of $${contractVal.toLocaleString()} contract).`,
      recommendation: `Send to Abby/Randi for invoicing. Invoice #${job.invoiceNum || 'TBD'}.`,
      pm:             job.pm,
      zoneId:         getZoneId(job),
      status:         'open',
      billingAmount:  amt,
      milestone,
    })
  }
  return alerts
}

function zoneBatchAlerts(jobs) {
  const alerts = []
  const active = jobs.filter(j => !['complete', 'completed', 'pending'].includes(j.status))
  const zoneMap = {}
  for (const job of active) {
    const z = getZoneId(job)
    if (!zoneMap[z]) zoneMap[z] = []
    zoneMap[z].push(job)
  }
  for (const [zoneId, zJobs] of Object.entries(zoneMap)) {
    if (zJobs.length < 3) continue
    const zoneName = getZoneName(zoneId)
    alerts.push({
      id:             `zone_batch_${zoneId}`,
      jobId:          null,
      jobName:        null,
      type:           'zone_batch',
      severity:       'info',
      title:          `Zone batch opportunity — ${zoneName}`,
      description:    `${zJobs.length} active jobs in ${zoneName}: ${zJobs.slice(0, 5).map(j => j.name || j.id).join(', ')}${zJobs.length > 5 ? '…' : ''}.`,
      recommendation: `Batch these jobs for same crew, same day to save ~30–45 min drive time.`,
      pm:             ZONES[zoneId]?.pm || null,
      zoneId,
      status:         'open',
    })
  }
  return alerts
}

function pmOverloadAlerts(jobs) {
  const alerts = []
  const pmMap = {}
  const active = jobs.filter(j => !['complete', 'completed'].includes(j.status))
  for (const job of active) {
    const pm = job.pm || 'Unassigned'
    if (!pmMap[pm]) pmMap[pm] = 0
    pmMap[pm]++
  }
  for (const [pm, count] of Object.entries(pmMap)) {
    if (count > 15) {
      alerts.push({
        id:             `pm_overload_${pm.replace(/\s+/g, '_')}`,
        jobId:          null,
        jobName:        null,
        type:           'pm_overload',
        severity:       'critical',
        title:          `PM overloaded — ${pm}`,
        description:    `${pm} has ${count} active jobs (max recommended: 15).`,
        recommendation: `Redistribute ${count - 12} jobs to another PM or prioritize closeable jobs.`,
        pm,
        zoneId:         null,
        status:         'open',
      })
    } else if (count > 12) {
      alerts.push({
        id:             `pm_overload_${pm.replace(/\s+/g, '_')}`,
        jobId:          null,
        jobName:        null,
        type:           'pm_overload',
        severity:       'warning',
        title:          `PM near capacity — ${pm}`,
        description:    `${pm} has ${count} active jobs. Watch for dropped items.`,
        recommendation: `Don't assign new jobs until existing ones close out.`,
        pm,
        zoneId:         null,
        status:         'open',
      })
    }
  }
  return alerts
}

// ── Master function ───────────────────────────────────────────────────────────

export function generateAlerts(jobs, extras = []) {
  const all = [
    ...failedInspectionAlerts(jobs),
    ...hvacBlockedAlerts(jobs),
    ...stalledAlerts(jobs),
    ...billingReadyAlerts(jobs, extras),
    ...noNextActionAlerts(jobs),
    ...zoneBatchAlerts(jobs),
    ...pmOverloadAlerts(jobs),
  ]
  // Deduplicate by id (deterministic ids = safe)
  const seen = new Set()
  return all.filter(a => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })
}

export const ALERT_TYPE_LABEL = {
  stalled:           'Stalled Job',
  hvac_blocked:      'HVAC Blocked',
  inspection_failed: 'Failed Inspection',
  no_next_action:    'No Next Action',
  billing_ready:     'Billing Ready',
  zone_batch:        'Zone Batch',
  pm_overload:       'PM Overload',
}

export const SEVERITY_COLOR = {
  critical: '#ef4444',
  warning:  '#f59e0b',
  info:     '#3b82f6',
}

export const SEVERITY_LABEL = {
  critical: 'Critical',
  warning:  'Warning',
  info:     'Info',
}
