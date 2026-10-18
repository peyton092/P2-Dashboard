// Pure validation for the createUser callable. Nothing here imports Firebase,
// so it can be unit tested without initializing the Admin SDK.
//
// The messages are shown to the owner exactly as written (the callable passes
// them through as HttpsError messages), so keep them plain and free of dashes.

import { VALID_ROLES } from './roles.js'

// The tenants a builder account can belong to. Everyone who is not a builder
// (owner, internal, client) is recorded under the p2-core tenant.
const BUILDER_TENANTS = Object.freeze(['qbs', 'vision'])
const CORE_TENANT = 'p2-core'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const JOB_ID_PATTERN = /^[A-Z]+-\d{3}$/

const fail = (message) => ({ ok: false, message })

// input: whatever the caller sent as the callable's data.
//   { email, displayName?, role, tenantId?, clientJobIds? }
//
// Returns { ok: true, value } or { ok: false, message }. The first problem found
// wins, checked in this order: email, role, builder tenant, client job ids.
//
// value is always
//   { email, displayName, role, tenantId, clientJobIds }
// where
//   email         trimmed and lower cased (Firebase Auth stores it that way)
//   displayName   trimmed; the email when the name is blank or missing
//   tenantId      the chosen tenant for a builder, CORE_TENANT for every
//                 other role (a tenant sent with another role is ignored)
//   clientJobIds  trimmed, upper cased, de-duplicated ids for a client, and
//                 [] for every other role
export function validateNewUser(input) {
  const source = input !== null && typeof input === 'object' ? input : {}

  const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : ''
  if (!EMAIL_PATTERN.test(email)) return fail('Enter a valid email address.')

  const { role } = source
  if (typeof role !== 'string' || !VALID_ROLES.includes(role)) return fail('Choose a role.')

  const displayName = (typeof source.displayName === 'string' ? source.displayName.trim() : '') || email

  let tenantId = CORE_TENANT
  if (role === 'builder') {
    if (typeof source.tenantId !== 'string' || !BUILDER_TENANTS.includes(source.tenantId)) {
      return fail('Choose a builder tenant.')
    }
    tenantId = source.tenantId
  }

  let clientJobIds = []
  if (role === 'client') {
    const entries = Array.isArray(source.clientJobIds) ? source.clientJobIds : []
    const cleaned = entries
      .map((entry) => (typeof entry === 'string' ? entry.trim().toUpperCase() : entry))
      .filter((entry) => entry !== '')
    if (cleaned.length === 0) return fail('Enter at least one job id like QBS-001.')
    if (!cleaned.every((entry) => typeof entry === 'string' && JOB_ID_PATTERN.test(entry))) {
      return fail('Job ids must look like QBS-001.')
    }
    clientJobIds = [...new Set(cleaned)]
  }

  return { ok: true, value: { email, displayName, role, tenantId, clientJobIds } }
}
