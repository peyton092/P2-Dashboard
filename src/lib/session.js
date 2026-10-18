// Pure session resolution: turns ID token claims plus the optional users
// document into the identity the app renders from. No Firebase imports.

export const VALID_ROLES = ['owner', 'internal', 'builder', 'client']

const validRole = (r) => (VALID_ROLES.includes(r) ? r : null)

export function resolveSession(claims, userDoc, firebaseUser) {
  const c = claims || {}
  const u = userDoc || {}
  const fu = firebaseUser || {}

  const role = validRole(c.role) || validRole(u.role)
  const tenantId = c.tenantId || u.tenantId || (role === 'builder' ? 'qbs' : 'p2-core')
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
