import { toLocalDateStr } from '../../lib/dates'
import {
  actorOf, cleanDocId, fail, historyDoc, nonEmptyString, notificationDoc, refuse, requireStaff, scopeForJob,
} from './shared'

// passInspection and failInspection: functions/inspections.js and
// functions/lib/inspections.js, on the demo store.

const JOB_GONE = 'That job no longer exists.'

// ── Inspections (lib/inspections.js and inspections.js) ───────────────────────

export const TRADE_PHASES = Object.freeze({
  electrical: Object.freeze(['roughIn', 'trim', 'final']),
  plumbing: Object.freeze(['roughIn', 'final']),
  hvac: Object.freeze(['roughIn', 'final']),
})

const TRADE_MESSAGE = Object.freeze({ electrical: 'electrical', plumbing: 'plumbing', hvac: 'HVAC' })
const PHASE_MESSAGE = Object.freeze({ roughIn: 'rough in', trim: 'trim', final: 'final' })

export function validateInspection(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const jobDocId = cleanDocId(source.jobDocId)
  if (jobDocId === null) return fail('Choose a job.')
  const { trade, phase } = source
  if (typeof trade !== 'string' || !Object.hasOwn(TRADE_PHASES, trade)) return fail('Choose electrical, plumbing or HVAC.')
  if (typeof phase !== 'string' || !TRADE_PHASES[trade].includes(phase)) return fail('That inspection phase does not exist for this trade.')
  return { ok: true, value: { jobDocId, trade, phase } }
}

// The result and the day it was recorded, the local day of this device.
export function inspectionPatch(trade, phase, result, now = new Date()) {
  if (result !== 'passed' && result !== 'failed') throw new Error(`Unknown inspection result: ${result}`)
  return { [`insp.${trade}.${phase}`]: result, [`insp.${trade}.${phase}Date`]: toLocalDateStr(now) }
}

export function inspectionActivity(job, trade, phase, result) {
  const id = nonEmptyString(job?.id) ? job.id : 'Job'
  const words = `${id} ${TRADE_MESSAGE[trade]} ${PHASE_MESSAGE[phase]} ${result}`
  return { type: result === 'passed' ? 'success' : 'error', action: result, msg: words, summary: words }
}

function recordInspection(context, result) {
  const { data, store } = context
  const checked = validateInspection(data)
  if (!checked.ok) throw refuse('invalid-argument', checked.message)
  const { jobDocId, trade, phase } = checked.value

  const actor = actorOf(context)
  const job = store.get('jobs', jobDocId)
  if (!job) throw refuse('not-found', JOB_GONE)

  const activity = inspectionActivity(job, trade, phase, result)
  const jobId = nonEmptyString(job.id) ? job.id : null
  store.update('jobs', jobDocId, inspectionPatch(trade, phase, result))
  store.add('notifications', notificationDoc({ type: activity.type, msg: activity.msg, jobId, scope: scopeForJob(job), actor }))
  store.add('history', historyDoc({ type: 'inspection', action: activity.action, summary: activity.summary, jobId, actor }))
  return { ok: true }
}

export const inspectionCallables = {
  passInspection: (context) => {
    requireStaff(context)
    return recordInspection(context, 'passed')
  },
  failInspection: (context) => {
    requireStaff(context)
    return recordInspection(context, 'failed')
  },
}
