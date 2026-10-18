// Pure rules for recording an inspection result: which trades and phases exist,
// what the job update looks like, and the words written about it. Nothing here
// imports Firebase, so it is unit tested directly. The callables that apply
// these rules live in ../inspections.js.
//
// The words end up in notifications and history that people read, so they carry
// no dashes. Job ids (QBS-003) are data and keep theirs.

import { businessDay } from './business-time.js'
import { cleanDocId } from './doc-id.js'

// The phases each trade is inspected in. The browser lists the same ones
// (src/lib/inspections.js TRADE_META).
export const TRADE_PHASES = Object.freeze({
  electrical: Object.freeze(['roughIn', 'trim', 'final']),
  plumbing: Object.freeze(['roughIn', 'final']),
  hvac: Object.freeze(['roughIn', 'final']),
})

// How each is written in a sentence.
export const TRADE_MESSAGE = Object.freeze({ electrical: 'electrical', plumbing: 'plumbing', hvac: 'HVAC' })
export const PHASE_MESSAGE = Object.freeze({ roughIn: 'rough in', trim: 'trim', final: 'final' })

const fail = (message) => ({ ok: false, message })

// input: whatever the caller sent as the callable's data,
//   { jobDocId, trade, phase }
// where jobDocId is the Firestore document id of the job (not its QBS-001 id).
//
// Returns { ok: true, value: { jobDocId, trade, phase } } or
// { ok: false, message }, checking the job, then the trade, then the phase. A
// phase has to be one the trade has: plumbing and HVAC have no trim.
export function validateInspection(input) {
  const source = input !== null && typeof input === 'object' ? input : {}

  const jobDocId = cleanDocId(source.jobDocId)
  if (jobDocId === null) return fail('Choose a job.')

  const { trade, phase } = source
  if (typeof trade !== 'string' || !Object.hasOwn(TRADE_PHASES, trade)) {
    return fail('Choose electrical, plumbing or HVAC.')
  }
  if (typeof phase !== 'string' || !TRADE_PHASES[trade].includes(phase)) {
    return fail('That inspection phase does not exist for this trade.')
  }

  return { ok: true, value: { jobDocId, trade, phase } }
}

// The update to the job: the result and the day it was recorded (YYYY-MM-DD, the day in
// the business time zone, see business-time.js), as dotted field paths so only that phase
// changes. result is passed or failed.
export function inspectionPatch(trade, phase, result, now = new Date()) {
  if (result !== 'passed' && result !== 'failed') {
    throw new Error(`Unknown inspection result: ${result}`)
  }
  return {
    [`insp.${trade}.${phase}`]: result,
    [`insp.${trade}.${phase}Date`]: businessDay(now),
  }
}

// How a result reads in the Activity feed, and the kind of alert it raises:
//   { type, action, msg, summary }
// A pass is a success and a fail is an error (push.js titles the alert by it).
export function inspectionActivity(job, trade, phase, result) {
  const id = typeof job?.id === 'string' && job.id !== '' ? job.id : 'Job'
  const text = `${id} ${TRADE_MESSAGE[trade]} ${PHASE_MESSAGE[phase]} ${result}`
  return {
    type: result === 'passed' ? 'success' : 'error',
    action: result,
    msg: text,
    summary: text,
  }
}
