// Pure session resolution: turns ID token claims plus the optional users
// document into the identity the app renders from. No Firebase imports.

export const VALID_ROLES = ['owner', 'internal', 'builder', 'client']

const validRole = (r) => (VALID_ROLES.includes(r) ? r : null)

// The tenants a builder can belong to. p2-core is P2's own and never a builder's.
const BUILDER_TENANTS = ['qbs', 'vision']

export function resolveSession(claims, userDoc, firebaseUser) {
  const c = claims || {}
  const u = userDoc || {}
  const fu = firebaseUser || {}

  const namedRole = validRole(c.role) || validRole(u.role)
  const namedTenant = c.tenantId || u.tenantId || null
  // A builder reads only the documents of their own tenant, qbs or vision, so a
  // builder with no tenant, or any other, has nothing to read: the same as no
  // role, and the app says so.
  const noTenant = namedRole === 'builder' && !BUILDER_TENANTS.includes(namedTenant)
  const role = noTenant ? null : namedRole
  const tenantId = noTenant ? null : (namedTenant || 'p2-core')
  const displayName = c.displayName || u.displayName || fu.displayName || ''
  // fu.displayName covers a client whose claims are complete, since the app then
  // skips the users document: createUser gives the Auth account the same name.
  const clientName = c.clientName || u.clientName || u.displayName || fu.displayName || ''
  const clientJobIds = Array.isArray(c.clientJobIds)
    ? c.clientJobIds
    : Array.isArray(u.clientJobIds)
      ? u.clientJobIds
      : []

  return { role, tenantId, displayName, clientName, clientJobIds }
}
