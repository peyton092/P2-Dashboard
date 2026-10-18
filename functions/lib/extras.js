// Pure rules for change orders (the extras collection): which state one is in,
// what a send, an approval or a revision request changes, and the words written
// about it. Nothing here reads or writes Firestore, so it is unit tested
// directly. The callables that apply these rules live in ../extras.js.
//
// The words end up in notifications and history that people read, so they carry
// no dashes. Job ids and change order numbers (QBS-003, CO-004) are data and keep
// theirs.

import { HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'

// A revision note is 1 to 1000 characters once trimmed.
export const NOTE_MAX = 1000
export const NOTE_REQUIRED = 'Say what should be revised.'
export const TOTAL_CHANGED = 'This change order changed since you opened it. Review it again.'

// Where a change order stands. Stored statuses are mixed: the Change Orders
// screen writes Title Case, and older browser writes and the demo data use lower
// case. Only 'Draft' is a draft. Sent to Builder, pending, a missing status and
// anything unrecognized all wait for a decision.
//
// The browser has a copy of this function (src/lib/extraStatus.js), kept
// identical and tested the same way.
export function extraState(extra) {
  const status = typeof extra?.status === 'string' ? extra.status : ''
  if (status === 'Draft') return 'draft'
  if (status === 'Approved' || status === 'approved') return 'approved'
  if (status === 'Rejected' || status === 'rejected') return 'rejected'
  return 'pending'
}

// The note as it is stored: trimmed, or null when it is missing, not a string,
// blank or longer than NOTE_MAX.
export function cleanRevisionNote(note) {
  if (typeof note !== 'string') return null
  const trimmed = note.trim()
  return trimmed !== '' && trimmed.length <= NOTE_MAX ? trimmed : null
}

// The total a change order stands at, as stored: its total, else its amount, else 0.
export const totalOf = (extra) => extra?.total ?? extra?.amount ?? 0

// Whether the total a person was shown (expectedTotal, which the portals send with
// an approval or a revision request) is no longer the stored one. The two are
// compared as numbers. No expectedTotal (undefined) means the caller did not say,
// and that is never a change.
export function totalChanged(extra, expectedTotal) {
  if (expectedTotal === undefined) return false
  return Number(expectedTotal) !== Number(totalOf(extra))
}

// Only the three fields of who acted are stored, whatever else the caller holds.
const whoActed = (actor) => ({ uid: actor.uid, email: actor.email, displayName: actor.displayName })

// What changes on the extra for an action, as a Firestore update patch.
//
//   send     Draft, rejected or already sent -> Sent to Builder. An approved extra
//            is refused. qbs and both send times are set (the Change Orders
//            screen ages a change order by sentAt).
//   approve  Pending -> Approved, with who and when.
//   reject   Pending -> Rejected, with who, when and the note.
//
// Approving or rejecting a draft (never sent) or an extra that is already decided
// is refused. These throw HttpsErrors written for people, so a caller can pass
// them straight on. An action it does not know is a bug in the caller and throws
// a plain Error.
export function extraTransition(extra, action, actor, note) {
  const state = extraState(extra)

  if (action === 'send') {
    if (state === 'approved') {
      throw new HttpsError('failed-precondition', 'This change order is already approved.')
    }
    return {
      status: 'Sent to Builder',
      qbs: true,
      qbsSentAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
    }
  }

  if (action === 'approve' || action === 'reject') {
    if (state === 'draft') {
      throw new HttpsError('failed-precondition', 'This change order has not been sent for approval.')
    }
    if (state !== 'pending') {
      throw new HttpsError('failed-precondition', 'This change order has already been decided.')
    }
    if (action === 'approve') {
      return { status: 'Approved', approvedBy: whoActed(actor), approvedAt: FieldValue.serverTimestamp() }
    }
    const reason = cleanRevisionNote(note)
    if (reason === null) throw new HttpsError('invalid-argument', NOTE_REQUIRED)
    return {
      status: 'Rejected',
      rejectedBy: whoActed(actor),
      rejectedAt: FieldValue.serverTimestamp(),
      rejectNotes: reason,
    }
  }

  throw new Error(`Unknown change order action: ${action}`)
}

// Whole dollars. Negative amounts (a credit) are written in brackets, not with a
// minus sign, so the wording stays free of dashes.
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  currencySign: 'accounting',
  maximumFractionDigits: 0,
})

const textOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

// What people call the change order: its id, else its change order number.
const labelOf = (extra) => textOf(extra?.id) ?? textOf(extra?.coNumber) ?? 'CO'

const amountOf = (extra) => {
  const amount = Number(extra?.total ?? extra?.amount ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

// How an action reads in the Activity feed, and the kind of alert it raises:
//   { type, action, msg, summary }
// type and msg are for the notification (success, warn or info), action and
// summary for the history entry. The note is put on one line and cut to 80
// characters in the notification and 60 in the history line.
export function extraActivity(extra, action, actor, note) {
  const label = labelOf(extra)
  const job = textOf(extra?.job)
  const inJob = job ? ` (${job})` : ''
  const money = dollars.format(amountOf(extra))
  const who = actor.displayName

  if (action === 'send') {
    return {
      type: 'info',
      action: 'sent',
      msg: `${label} sent to the builder: ${money}${inJob}`,
      summary: `${label} sent to the builder: ${money}`,
    }
  }

  if (action === 'approve') {
    return {
      type: 'success',
      action: 'approved',
      msg: `${label} approved by ${who}: ${money}${inJob}`,
      summary: `${label} approved: ${money}`,
    }
  }

  if (action === 'reject') {
    const reason = cleanRevisionNote(note)
    const oneLine = reason === null ? '' : reason.replace(/\s+/g, ' ')
    const cut = (length) => (reason === null ? '' : `: ${oneLine.slice(0, length).trimEnd()}`)
    return {
      type: 'warn',
      action: 'rejected',
      msg: `${label} revision requested by ${who}${inJob}${cut(80)}`,
      summary: `${label} revision requested${cut(60)}`,
    }
  }

  throw new Error(`Unknown change order action: ${action}`)
}
