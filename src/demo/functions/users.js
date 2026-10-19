import { serverTimestampValue } from '../timestamp'
import { VALID_ROLES, fail, refuse, requireOwner, tenantForRole } from './shared'

// createUser: functions/users.js and functions/lib/users-validate.js, on the demo store.

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

export const userCallables = { createUser }
