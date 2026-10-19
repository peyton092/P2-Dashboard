// One vocabulary for every status the app shows: the words people read, the tone
// they read in, and where each one sorts. Screens ask this module instead of
// keeping tables of their own, so a blocked job, a passed inspection or a change
// order that was sent reads the same on every screen.
//
// Each map is { key: { label, tone, order } }.
//   key    the value stored on the document, written exactly as stored. A job
//          status is on-track, a change order status is Sent to Builder.
//   label  what a person reads. Sentence case, and no dash of any kind.
//   tone   a name from TONE_HEX in tokens.js: brand, success, warning, critical,
//          info, cyan, neutral or mute.
//   order  where the status sorts, lowest first. Maps of things that need
//          attention (jobs, inspections, severity, notifications) run most
//          urgent first. Maps of a process (phases, permits, change orders,
//          billing, materials, subcontractors) run in the order the process
//          goes, and the trades in the order the app lists them.
//
// A color is never written here. toneHex turns a tone into the hex in tokens.js.

import { TONE_HEX, TONE_TEXT } from '@/lib/tokens'
import { extraState } from '@/lib/extraStatus'

// Freezes a map and each of its entries, so no screen can add to the vocabulary
// or change a word of it.
function vocabulary(map) {
  Object.values(map).forEach(Object.freeze)
  return Object.freeze(map)
}

// What job.status holds. The brand color is for navigation and actions, so no job
// status wears it: Needs action reads as a warning and Active as info. At risk is a
// warning too, and its words are what tell the two apart.
export const JOB_STATUS = vocabulary({
  blocked:        { label: 'Blocked',      tone: 'critical', order: 0 },
  hold:           { label: 'On hold',      tone: 'critical', order: 1 },
  'at-risk':      { label: 'At risk',      tone: 'warning',  order: 2 },
  'needs-action': { label: 'Needs action', tone: 'warning',  order: 3 },
  active:         { label: 'Active',       tone: 'info',     order: 4 },
  'on-track':     { label: 'On track',     tone: 'success',  order: 5 },
  pending:        { label: 'Pending',      tone: 'mute',     order: 6 },
  complete:       { label: 'Complete',     tone: 'success',  order: 7 },
  completed:      { label: 'Completed',    tone: 'success',  order: 8 },
})

// One phase of an inspection. Pending is an inspection that has not been called
// in; Pending verification is one a sub reports done and the project manager has
// not confirmed.
export const INSPECTION_STATUS = vocabulary({
  failed:                 { label: 'Failed',               tone: 'critical', order: 0 },
  blocked:                { label: 'Blocked',              tone: 'info',     order: 1 },
  'pending-verification': { label: 'Pending verification', tone: 'mute',     order: 2 },
  scheduled:              { label: 'Scheduled',            tone: 'warning',  order: 3 },
  pending:                { label: 'Pending',              tone: 'mute',     order: 4 },
  'not-started':          { label: 'Not started',          tone: 'mute',     order: 5 },
  passed:                 { label: 'Passed',               tone: 'success',  order: 6 },
  'n/a':                  { label: 'N/A',                  tone: 'neutral',  order: 7 },
})

// A permit, as the Permits screen stores it for each trade.
export const PERMIT_STATUS = vocabulary({
  pending:  { label: 'Pending',  tone: 'mute',     order: 0 },
  applied:  { label: 'Applied',  tone: 'info',     order: 1 },
  approved: { label: 'Approved', tone: 'success',  order: 2 },
  finaled:  { label: 'Finaled',  tone: 'success',  order: 3 },
  denied:   { label: 'Denied',   tone: 'critical', order: 4 },
})

// job.billingStatus. A job on hold is placed there and released from the billing
// queue.
export const BILLING_STATUS = vocabulary({
  'not-invoiced': { label: 'Not invoiced', tone: 'mute',    order: 0 },
  invoiced:       { label: 'Invoiced',     tone: 'info',    order: 1 },
  'partial-pay':  { label: 'Partial pay',  tone: 'warning', order: 2 },
  paid:           { label: 'Paid',         tone: 'success', order: 3 },
  hold:           { label: 'On hold',      tone: 'warning', order: 4 },
})

// The status a change order is stored with: Title Case, as the Change Orders
// screen and the Cloud Functions write it. Older writes and the demo data use
// lower case; normalizeCoStatus reads those onto these keys.
export const CO_STATUS = vocabulary({
  Draft:             { label: 'Draft',           tone: 'mute',     order: 0 },
  'Sent to Builder': { label: 'Sent to builder', tone: 'info',     order: 1 },
  Approved:          { label: 'Approved',        tone: 'success',  order: 2 },
  Rejected:          { label: 'Rejected',        tone: 'critical', order: 3 },
})

// A material, as the materials screen stores it.
export const MATERIAL_STATUS = vocabulary({
  Ordered:       { label: 'Ordered',     tone: 'info',    order: 0 },
  'In Transit':  { label: 'In transit',  tone: 'warning', order: 1 },
  Delivered:     { label: 'Delivered',   tone: 'success', order: 2 },
  'At Job Site': { label: 'At job site', tone: 'success', order: 3 },
  Used:          { label: 'Used',        tone: 'mute',    order: 4 },
  Cancelled:     { label: 'Cancelled',   tone: 'mute',    order: 5 },
})

// A subcontractor's standing on one job.
export const SUB_STATUS = vocabulary({
  active: { label: 'Active', tone: 'success',  order: 0 },
  done:   { label: 'Done',   tone: 'mute',     order: 1 },
  issue:  { label: 'Issue',  tone: 'critical', order: 2 },
})

// How serious an alert or a briefing item is.
export const SEVERITY = vocabulary({
  critical: { label: 'Critical', tone: 'critical', order: 0 },
  warning:  { label: 'Warning',  tone: 'warning',  order: 1 },
  info:     { label: 'Info',     tone: 'info',     order: 2 },
})

// The type a notification is written with.
export const NOTIF_TYPE = vocabulary({
  error:   { label: 'Error',   tone: 'critical', order: 0 },
  warn:    { label: 'Warning', tone: 'warning',  order: 1 },
  info:    { label: 'Update',  tone: 'info',     order: 2 },
  success: { label: 'Done',    tone: 'success',  order: 3 },
})

// The three trades, in the order the app lists them. A trade is a color to read
// by, not a status: electrical keeps the brand color it has always had.
export const TRADE = vocabulary({
  electrical: { label: 'Electrical', tone: 'brand', order: 0 },
  plumbing:   { label: 'Plumbing',   tone: 'cyan',  order: 1 },
  hvac:       { label: 'HVAC',       tone: 'info',  order: 2 },
})

// The phases a job goes through, in order. A phase says where the work is, not
// how it is going, so the phases between the first and the last are neutral.
export const PHASE = vocabulary({
  precon:            { label: 'Precon',          tone: 'mute',    order: 0 },
  'rough-in':        { label: 'Rough in',        tone: 'neutral', order: 1 },
  'service-release': { label: 'Service release', tone: 'neutral', order: 2 },
  trim:              { label: 'Trim',            tone: 'neutral', order: 3 },
  final:             { label: 'Final',           tone: 'neutral', order: 4 },
  closeout:          { label: 'Closeout',        tone: 'neutral', order: 5 },
  complete:          { label: 'Complete',        tone: 'success', order: 6 },
})

const UNKNOWN = Object.freeze({ label: 'Unknown', tone: 'mute', order: 99 })

// The label, tone and position of a status. A key the map does not hold, a
// missing one included, reads as Unknown: muted, and sorted after every known
// status.
export function statusMeta(map, key) {
  return Object.hasOwn(map, key) ? map[key] : UNKNOWN
}

export const statusLabel = (map, key) => statusMeta(map, key).label
export const statusTone  = (map, key) => statusMeta(map, key).tone
export const statusOrder = (map, key) => statusMeta(map, key).order

// The hex of a tone, from tokens.js. A tone the palette does not have reads as
// neutral, as the Pill does.
export function toneHex(tone) {
  return Object.hasOwn(TONE_HEX, tone) ? TONE_HEX[tone] : TONE_HEX.neutral
}

// The hex to set small text in, from TONE_TEXT in tokens.js. A tone's own color is
// meant for dots, rules, fills and large figures. Where it is too dim to read at 12 px
// on a card the text color is lighter (critical, info and brand), and text in a muted
// tone uses the neutral gray. A tone the palette does not have reads as neutral.
export function toneText(tone) {
  return Object.hasOwn(TONE_TEXT, tone) ? TONE_TEXT[tone] : TONE_TEXT.neutral
}

export const statusColor = (map, key) => toneHex(statusTone(map, key))

// A map as menu entries, { value, label, tone, order }, in the order of the map.
export function statusOptions(map) {
  return Object.entries(map)
    .map(([value, meta]) => ({ value, ...meta }))
    .sort((a, b) => a.order - b.order)
}

// The job status menu offers every job status. The phase menu offers every phase.
export const JOB_STATUS_OPTIONS = statusOptions(JOB_STATUS)
export const PHASE_OPTIONS      = statusOptions(PHASE)

const CO_KEY = {
  draft:    'Draft',
  pending:  'Sent to Builder',
  approved: 'Approved',
  rejected: 'Rejected',
}

// A stored change order status as a key of CO_STATUS. It reads the status the way
// extraState does (Phase 1, kept the same as the server's copy), so the screens
// and the Cloud Functions agree: pending, sent-to-qbs, a missing status and any
// text it does not recognize wait for the builder, and only Draft is a draft.
export const normalizeCoStatus = (raw) => CO_KEY[extraState({ status: raw })]

// Whether a change order waits for the builder to decide.
export const isCoAwaitingBuilder = (extra) => extraState(extra) === 'pending'

// A finished job. The status is complete or, in older data, completed.
export function isJobComplete(job) {
  return job?.status === 'complete' || job?.status === 'completed'
}
