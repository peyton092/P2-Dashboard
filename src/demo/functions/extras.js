import { extraState } from '../../lib/extraStatus'
import { serverTimestampValue } from '../timestamp'
import {
  actorOf, canActOnExtra, cleanDocId, historyDoc, nonEmptyString, notificationDoc, refuse,
  requireAuth, requireStaff, scopeForJob, text,
} from './shared'

// sendExtraToBuilder, approveExtra and rejectExtra: functions/extras.js and
// functions/lib/extras.js, on the demo store.

// ── Change orders (lib/extras.js and extras.js) ───────────────────────────────

export const NOTE_MAX = 1000
export const NOTE_REQUIRED = 'Say what should be revised.'
export const TOTAL_CHANGED = 'This change order changed since you opened it. Review it again.'

export const EXTRA_GONE = 'That change order no longer exists.'
export const JOB_GONE = 'That job no longer exists.'
export const NOT_YOURS = 'You can only act on change orders for your own projects.'

export function cleanRevisionNote(note) {
  if (typeof note !== 'string') return null
  const trimmed = note.trim()
  return trimmed !== '' && trimmed.length <= NOTE_MAX ? trimmed : null
}

const totalOf = (extra) => extra?.total ?? extra?.amount ?? 0

export function totalChanged(extra, expectedTotal) {
  if (expectedTotal === undefined) return false
  return Number(expectedTotal) !== Number(totalOf(extra))
}

const whoActed = (actor) => ({ uid: actor.uid, email: actor.email, displayName: actor.displayName })

export function extraTransition(extra, action, actor, note) {
  const state = extraState(extra)

  if (action === 'send') {
    if (state === 'approved') throw refuse('failed-precondition', 'This change order is already approved.')
    return { status: 'Sent to Builder', qbs: true, qbsSentAt: serverTimestampValue(), sentAt: serverTimestampValue() }
  }

  if (action === 'approve' || action === 'reject') {
    if (state === 'draft') throw refuse('failed-precondition', 'This change order has not been sent for approval.')
    if (state !== 'pending') throw refuse('failed-precondition', 'This change order has already been decided.')
    if (action === 'approve') {
      return { status: 'Approved', approvedBy: whoActed(actor), approvedAt: serverTimestampValue() }
    }
    const reason = cleanRevisionNote(note)
    if (reason === null) throw refuse('invalid-argument', NOTE_REQUIRED)
    return { status: 'Rejected', rejectedBy: whoActed(actor), rejectedAt: serverTimestampValue(), rejectNotes: reason }
  }

  throw new Error(`Unknown change order action: ${action}`)
}

// Whole dollars, and a credit in brackets rather than with a minus sign.
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  currencySign: 'accounting',
  maximumFractionDigits: 0,
})

const labelOf = (extra) => text(extra?.id) ?? text(extra?.coNumber) ?? 'CO'

const amountOf = (extra) => {
  const amount = Number(extra?.total ?? extra?.amount ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

export function extraActivity(extra, action, actor, note) {
  const label = labelOf(extra)
  const job = text(extra?.job)
  const inJob = job ? ` (${job})` : ''
  const money = dollars.format(amountOf(extra))
  const who = actor.displayName

  if (action === 'send') {
    return { type: 'info', action: 'sent', msg: `${label} sent to the builder: ${money}${inJob}`, summary: `${label} sent to the builder: ${money}` }
  }
  if (action === 'approve') {
    return { type: 'success', action: 'approved', msg: `${label} approved by ${who}: ${money}${inJob}`, summary: `${label} approved: ${money}` }
  }
  if (action === 'reject') {
    const reason = cleanRevisionNote(note)
    const oneLine = reason === null ? '' : reason.replace(/\s+/g, ' ')
    const cut = (length) => (reason === null ? '' : `: ${oneLine.slice(0, length).trimEnd()}`)
    return { type: 'warn', action: 'rejected', msg: `${label} revision requested by ${who}${inJob}${cut(80)}`, summary: `${label} revision requested${cut(60)}` }
  }
  throw new Error(`Unknown change order action: ${action}`)
}

// The extra as the access check should see it, and the scope to write onto it: its
// own when it is stamped, else its job's, which is then written onto it. A draft that
// is being sent always takes its job's.
function scopeOf(store, extra, action) {
  const draftBeingSent = action === 'send' && extraState(extra) === 'draft'
  const stamped = !draftBeingSent && nonEmptyString(extra.tenantId) && Array.isArray(extra.clientUids)
  if (stamped) return { scoped: extra, stamp: {} }

  if (!nonEmptyString(extra.job)) throw refuse('not-found', JOB_GONE)
  const [found] = store.find('jobs', { filters: [{ field: 'id', op: '==', value: extra.job }], limit: 1 })
  if (!found) throw refuse('not-found', JOB_GONE)
  const scope = scopeForJob(found.data)
  return { scoped: { ...extra, ...scope }, stamp: scope }
}

function applyAction(context, claims, action) {
  const { data, store } = context
  const extraId = cleanDocId(data?.extraId)
  if (extraId === null) throw refuse('invalid-argument', 'Choose a change order.')

  const note = data?.note
  if (action === 'reject' && cleanRevisionNote(note) === null) throw refuse('invalid-argument', NOTE_REQUIRED)

  const actor = actorOf(context)
  const extra = store.get('extras', extraId)
  if (!extra) throw refuse('not-found', EXTRA_GONE)

  const { scoped, stamp } = scopeOf(store, extra, action)
  if (!canActOnExtra(claims, scoped)) throw refuse('permission-denied', NOT_YOURS)

  const patch = extraTransition(extra, action, actor, note)
  if (action !== 'send' && totalChanged(extra, data?.expectedTotal)) throw refuse('failed-precondition', TOTAL_CHANGED)
  const activity = extraActivity(extra, action, actor, note)
  const jobId = nonEmptyString(extra.job) ? extra.job : null

  store.update('extras', extraId, { ...patch, ...stamp })
  store.add('notifications', notificationDoc({ type: activity.type, msg: activity.msg, jobId, scope: scopeForJob(scoped), actor }))
  store.add('history', historyDoc({ type: 'change-order', action: activity.action, summary: activity.summary, jobId, extraId, actor }))
  return { ok: true }
}

export const extrasCallables = {
  sendExtraToBuilder: (context) => applyAction(context, requireStaff(context), 'send'),
  approveExtra: (context) => applyAction(context, requireAuth(context), 'approve'),
  rejectExtra: (context) => applyAction(context, requireAuth(context), 'reject'),
}
