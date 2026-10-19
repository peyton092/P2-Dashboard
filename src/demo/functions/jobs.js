import { serverTimestampValue } from '../timestamp'
import { actorOf, fail, historyDoc, notificationDoc, refuse, requireStaff, text } from './shared'

// createJob: functions/jobs.js and functions/lib/jobs.js, on the demo store.

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

export const jobCallables = { createJob }
