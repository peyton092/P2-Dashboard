import { extraState } from '../lib/extraStatus'
import { toLocalDateStr } from '../lib/dates'
import { serverTimestampValue } from './timestamp'

// The Cloud Functions the app calls, answered on this device from the demo store.
// Each is a port of the function in functions/ of the same name, and applies the same
// transition, writes the same notification and history line, and refuses what the
// function refuses, with the same code and the same sentence, because the screens show
// that sentence (callableMessage). The pure rules are copied from functions/lib so the
// demo bundle carries no server code; the tests compare the copies of jobs.js,
// inspections.js and users-validate.js with the originals.
//
//   sendExtraToBuilder, approveExtra, rejectExtra   functions/extras.js and lib/extras.js
//   passInspection, failInspection                  functions/inspections.js and lib/inspections.js
//   createJob                                       functions/jobs.js and lib/jobs.js
//   createUser                                      functions/users.js and lib/users-validate.js
//
// Two things differ, by design. The day an inspection is dated is the local day of
// the device (toLocalDateStr), not the server's business day. And createUser writes the
// users document only: there is no Auth account to make, and the demo signs in only as
// its own four accounts. Every other name, the QuickBooks and CompanyCam functions and
// the backfill among them, is refused with DEMO_MESSAGE.

export const DEMO_MESSAGE = 'This is a demo. Connections to other systems are turned off.'

// The error the Functions SDK rejects with: code is functions/ and the status.
export class DemoFunctionsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FirebaseError'
    this.code = `functions/${code}`
  }
}

const refuse = (code, message) => new DemoFunctionsError(code, message)

// ── Shared pieces (lib/doc-id.js, lib/roles.js, lib/scope.js, lib/actor.js, lib/activity.js) ──

const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/

export const cleanDocId = (value) => (typeof value === 'string' && DOC_ID.test(value) ? value : null)

const VALID_ROLES = Object.freeze(['owner', 'internal', 'builder', 'client'])
const BUILDER_TENANTS = Object.freeze(['qbs', 'vision'])
const CORE_TENANT = 'p2-core'

const isStaff = (claims) => claims?.role === 'owner' || claims?.role === 'internal'
const isOwner = (claims) => claims?.role === 'owner'
const nonEmptyString = (value) => typeof value === 'string' && value !== ''

export function tenantForRole(role, tenantId) {
  if (role !== 'builder') return CORE_TENANT
  return BUILDER_TENANTS.includes(tenantId) ? tenantId : null
}

// The caller's claims, filled from their users document where the token has none,
// as requireAuth does.
function claimsOf(user, store) {
  const token = user.claims ?? {}
  const claims = {
    uid: user.uid,
    role: token.role ?? null,
    tenantId: token.tenantId ?? null,
    clientJobIds: Array.isArray(token.clientJobIds) ? token.clientJobIds : [],
  }
  if (claims.role) return claims
  const doc = store.get('users', user.uid)
  if (!doc) return claims
  const merged = { ...claims }
  if (VALID_ROLES.includes(doc.role)) merged.role = doc.role
  if (!claims.tenantId && nonEmptyString(doc.tenantId)) merged.tenantId = doc.tenantId
  merged.tenantId = tenantForRole(merged.role, merged.tenantId)
  if (claims.clientJobIds.length === 0 && Array.isArray(doc.clientJobIds)) {
    merged.clientJobIds = doc.clientJobIds.filter(nonEmptyString)
  }
  return merged
}

function requireAuth({ user, store }) {
  if (!user) throw refuse('unauthenticated', 'You must be signed in.')
  return claimsOf(user, store)
}

function requireStaff(context) {
  const claims = requireAuth(context)
  if (!isStaff(claims)) throw refuse('permission-denied', 'Staff access required.')
  return claims
}

function requireOwner(context) {
  const claims = requireAuth(context)
  if (!isOwner(claims)) throw refuse('permission-denied', 'Owner access required.')
  return claims
}

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

// Who is acting, from the caller and their users document, never from the request.
function actorOf({ user, store }) {
  const doc = store.get('users', user.uid)
  const email = text(user.email)
  return { uid: user.uid, email, displayName: text(doc?.displayName) ?? text(user.displayName) ?? email ?? 'Unknown user' }
}

export function scopeForJob(job) {
  const source = job ?? {}
  return {
    tenantId: nonEmptyString(source.tenantId) ? source.tenantId : 'qbs',
    clientUids: Array.isArray(source.clientUids) ? source.clientUids.filter((uid) => typeof uid === 'string') : [],
  }
}

export function canActOnExtra(claims, extra) {
  if (!claims) return false
  if (isStaff(claims)) return true
  if (claims.role === 'builder') return nonEmptyString(claims.tenantId) && claims.tenantId === extra?.tenantId
  if (claims.role === 'client') return nonEmptyString(claims.uid) && scopeForJob(extra).clientUids.includes(claims.uid)
  return false
}

function notificationDoc({ type, msg, jobId, scope, actor }) {
  return {
    type,
    msg,
    jobId: jobId ?? null,
    tenantId: scope.tenantId,
    clientUids: [...scope.clientUids],
    createdBy: actor.uid,
    createdByEmail: actor.email,
    createdAt: serverTimestampValue(),
    read: false,
  }
}

function historyDoc({ type, action, summary, jobId, extraId, actor }) {
  return {
    type,
    action,
    summary,
    actor: actor.displayName,
    actorUid: actor.uid,
    actorEmail: actor.email,
    jobId: jobId ?? null,
    ...(extraId ? { extraId } : {}),
    createdBy: actor.uid,
    createdByEmail: actor.email,
    createdAt: serverTimestampValue(),
  }
}

// ── Change orders (lib/extras.js and extras.js) ───────────────────────────────

export const NOTE_MAX = 1000
export const NOTE_REQUIRED = 'Say what should be revised.'
export const TOTAL_CHANGED = 'This change order changed since you opened it. Review it again.'

const EXTRA_GONE = 'That change order no longer exists.'
const JOB_GONE = 'That job no longer exists.'
const NOT_YOURS = 'You can only act on change orders for your own projects.'

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

// ── Inspections (lib/inspections.js and inspections.js) ───────────────────────

export const TRADE_PHASES = Object.freeze({
  electrical: Object.freeze(['roughIn', 'trim', 'final']),
  plumbing: Object.freeze(['roughIn', 'final']),
  hvac: Object.freeze(['roughIn', 'final']),
})

const TRADE_MESSAGE = Object.freeze({ electrical: 'electrical', plumbing: 'plumbing', hvac: 'HVAC' })
const PHASE_MESSAGE = Object.freeze({ roughIn: 'rough in', trim: 'trim', final: 'final' })

const fail = (message) => ({ ok: false, message })

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

// ── Jobs (lib/jobs.js and jobs.js) ────────────────────────────────────────────

const JOB_TENANTS = Object.freeze(['p2-core', 'qbs', 'vision'])
const JOB_ID = /^[A-Z]+-\d{3}$/
const MAX_DEPTH = 3
const SERVER_FIELDS = ['id', 'tenantId', 'clientUids', 'createdBy', 'createdByEmail', 'createdAt']
const CHECKED_FIELDS = ['address', 'client', 'name']
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const DROP = Symbol('drop')

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const isScalar = (value) =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

function cleanValue(value, depth) {
  if (depth > MAX_DEPTH) return DROP
  if (isScalar(value)) return value
  if (Array.isArray(value)) return value.every(isScalar) ? [...value] : DROP
  if (!isPlainObject(value)) return DROP
  const copy = {}
  for (const [key, inner] of Object.entries(value)) {
    if (!FIELD_NAME.test(key)) continue
    const cleaned = cleanValue(inner, depth + 1)
    if (cleaned !== DROP) copy[key] = cleaned
  }
  return copy
}

export function validateNewJob(input) {
  const source = isPlainObject(input) ? input : {}
  const { id, tenantId } = source
  if (typeof id !== 'string' || !JOB_ID.test(id)) return fail('Job ID must look like QBS-001.')
  const address = text(source.address)
  if (address === null) return fail('Enter the street address.')
  const client = text(source.client)
  if (client === null) return fail('Enter the client name.')
  if (typeof tenantId !== 'string' || !JOB_TENANTS.includes(tenantId)) return fail('Choose a tenant.')

  const fields = {}
  for (const [key, inner] of Object.entries(source)) {
    if (!FIELD_NAME.test(key) || SERVER_FIELDS.includes(key) || CHECKED_FIELDS.includes(key)) continue
    const cleaned = cleanValue(inner, 1)
    if (cleaned !== DROP) fields[key] = cleaned
  }
  const name = text(source.name)
  return { ok: true, value: { id, tenantId, fields: { ...fields, ...(name ? { name } : {}), address, client } } }
}

export function jobActivity(job, actor) {
  return { type: 'info', action: 'created', msg: `${job.id} created by ${actor.displayName}`, summary: `${job.id} created: ${job.address}` }
}

function createJob(context) {
  requireStaff(context)
  const { data, store } = context
  const checked = validateNewJob(data)
  if (!checked.ok) throw refuse('invalid-argument', checked.message)
  const { id, tenantId, fields } = checked.value

  const actor = actorOf(context)
  if (store.find('jobs', { filters: [{ field: 'id', op: '==', value: id }], limit: 1 }).length > 0) {
    throw refuse('already-exists', 'A job with that ID already exists.')
  }
  const linked = store.find('users', {
    filters: [{ field: 'role', op: '==', value: 'client' }, { field: 'clientJobIds', op: 'array-contains', value: id }],
  })
  const clientUids = [...new Set(linked.map((doc) => doc.id))].sort()

  const job = { ...fields, id, tenantId, clientUids, createdBy: actor.uid, createdByEmail: actor.email, createdAt: serverTimestampValue() }
  const activity = jobActivity(job, actor)
  const docId = store.add('jobs', job)
  store.add('notifications', notificationDoc({ type: activity.type, msg: activity.msg, jobId: id, scope: { tenantId, clientUids }, actor }))
  store.add('history', historyDoc({ type: 'job', action: activity.action, summary: activity.summary, jobId: id, actor }))
  return { ok: true, docId }
}

// ── Users (lib/users-validate.js and users.js) ────────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const JOB_ID_PATTERN = /^[A-Z]+-\d{3}$/

export function validateNewUser(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : ''
  if (!EMAIL_PATTERN.test(email)) return fail('Enter a valid email address.')
  const { role } = source
  if (typeof role !== 'string' || !VALID_ROLES.includes(role)) return fail('Choose a role.')
  const displayName = (typeof source.displayName === 'string' ? source.displayName.trim() : '') || email
  const tenantId = tenantForRole(role, source.tenantId)
  if (tenantId === null) return fail('Choose a builder tenant.')

  let clientJobIds = []
  if (role === 'client') {
    const entries = Array.isArray(source.clientJobIds) ? source.clientJobIds : []
    const cleaned = entries
      .map((entry) => (typeof entry === 'string' ? entry.trim().toUpperCase() : entry))
      .filter((entry) => entry !== '')
    if (cleaned.length === 0) return fail('Enter at least one job id like QBS-001.')
    if (!cleaned.every((entry) => typeof entry === 'string' && JOB_ID_PATTERN.test(entry))) return fail('Job ids must look like QBS-001.')
    clientJobIds = [...new Set(cleaned)]
  }
  return { ok: true, value: { email, displayName, role, tenantId, clientJobIds } }
}

function createUser(context) {
  const caller = requireOwner(context)
  const { data, store, user } = context
  const checked = validateNewUser(data)
  if (!checked.ok) throw refuse('invalid-argument', checked.message)
  const { email, displayName, role, tenantId, clientJobIds } = checked.value

  const taken = store.find('users').some((doc) => typeof doc.data.email === 'string' && doc.data.email.toLowerCase() === email)
  if (taken) throw refuse('already-exists', 'An account with that email already exists.')

  const uid = store.add('users', {
    email,
    displayName,
    role,
    tenantId,
    ...(role === 'client' ? { clientJobIds, clientName: displayName } : {}),
    createdBy: caller.uid,
    createdByEmail: user.email ?? null,
    createdAt: serverTimestampValue(),
  })
  return { uid }
}

// ── The calls ─────────────────────────────────────────────────────────────────

const CALLABLES = {
  sendExtraToBuilder: (context) => applyAction(context, requireStaff(context), 'send'),
  approveExtra: (context) => applyAction(context, requireAuth(context), 'approve'),
  rejectExtra: (context) => applyAction(context, requireAuth(context), 'reject'),
  passInspection: (context) => {
    requireStaff(context)
    return recordInspection(context, 'passed')
  },
  failInspection: (context) => {
    requireStaff(context)
    return recordInspection(context, 'failed')
  },
  createJob,
  createUser,
}

// Answers a call to the function called name with data, as the account user ({ uid,
// email, displayName, claims }) on store. Resolves with what the function returns.
export async function runCallable(name, data, { store, user }) {
  if (!Object.hasOwn(CALLABLES, name)) throw refuse('failed-precondition', DEMO_MESSAGE)
  return CALLABLES[name]({ data, store, user })
}
