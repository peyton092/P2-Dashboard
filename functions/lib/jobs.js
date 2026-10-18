// Pure rules for creating a job: what the request has to say, which of the other
// fields it sent are kept, and the words written about it. Nothing here imports
// Firebase, so it is unit tested directly. The callable that applies these rules
// lives in ../jobs.js.
//
// The messages are shown to the person who pressed Create job exactly as
// written (the callable passes them through as HttpsError messages), so they are
// plain and carry no dashes. Job ids (QBS-003) are data and keep theirs.

// The tenants a job can belong to, and the shape of its id.
export const TENANTS = Object.freeze(['p2-core', 'qbs', 'vision'])
export const JOB_ID = /^[A-Z]+-\d{3}$/

// Objects nested deeper than this, counting the field's own value as level one,
// are dropped.
export const MAX_DEPTH = 3

// The server sets these itself, whatever the caller sent.
const SERVER_FIELDS = ['id', 'tenantId', 'clientUids', 'createdBy', 'createdByEmail', 'createdAt']
// These are checked on their own below, so they are not copied through as they are.
const CHECKED_FIELDS = ['address', 'client', 'name']

// A field name is a letter followed by letters, digits and underscores. That
// leaves out dots (which mean a path in an update), reserved names such as
// __proto__ and __name__, and anything odd.
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

// A copy of the value if it is something a job can hold, else DROP: text, a
// finite number, yes or no, null, a plain object of those, or an array of the
// simple ones. Functions, arrays holding objects (or anything else) and objects
// nested too deep are dropped. depth is 1 for a field's own value.
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

const textOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

const fail = (message) => ({ ok: false, message })

// input: whatever the caller sent as the callable's data. The New Job form sends
//   { id, address, city, client, type, pm, status, progress, extras, tenantId,
//     lead, start, target, county, billingStatus, permitNumber, subs, permits, insp }
//
// Needs an id like QBS-001, a street address, a client and one of the three
// tenants, checked in that order. The name is optional (the app shows the client
// when there is none). Every other field is copied through when its value is
// simple enough (see cleanValue). The fields the server owns are never copied.
//
// Returns { ok: true, value: { id, tenantId, fields } } or { ok: false, message }.
// fields is the job document without the id, the tenant and what the server
// stamps (clientUids, createdBy, createdByEmail, createdAt).
export function validateNewJob(input) {
  const source = isPlainObject(input) ? input : {}

  const { id, tenantId } = source
  if (typeof id !== 'string' || !JOB_ID.test(id)) return fail('Job ID must look like QBS-001.')

  const address = textOf(source.address)
  if (address === null) return fail('Enter the street address.')

  const client = textOf(source.client)
  if (client === null) return fail('Enter the client name.')

  if (typeof tenantId !== 'string' || !TENANTS.includes(tenantId)) return fail('Choose a tenant.')

  const fields = {}
  for (const [key, inner] of Object.entries(source)) {
    if (!FIELD_NAME.test(key) || SERVER_FIELDS.includes(key) || CHECKED_FIELDS.includes(key)) continue
    const cleaned = cleanValue(inner, 1)
    if (cleaned !== DROP) fields[key] = cleaned
  }

  const name = textOf(source.name)
  return { ok: true, value: { id, tenantId, fields: { ...fields, ...(name ? { name } : {}), address, client } } }
}

// How a new job reads in the Activity feed, and the kind of alert it raises:
//   { type, action, msg, summary }
export function jobActivity(job, actor) {
  return {
    type: 'info',
    action: 'created',
    msg: `${job.id} created by ${actor.displayName}`,
    summary: `${job.id} created: ${job.address}`,
  }
}
