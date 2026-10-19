import { serverTimestampValue } from '../timestamp'

// What the demo's copies of the Cloud Functions share, as the functions share
// functions/lib/doc-id.js, roles.js, authz.js, scope.js, actor.js and activity.js: the
// error they refuse with, who is calling and what they may do, and the notification
// and history documents written beside a change. ../callables.js answers the calls.

// The error the Functions SDK rejects with: code is functions/ and the status.
export class DemoFunctionsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FirebaseError'
    this.code = `functions/${code}`
  }
}

export const refuse = (code, message) => new DemoFunctionsError(code, message)

// A check that did not pass, with the sentence a screen shows.
export const fail = (message) => ({ ok: false, message })

// ── Shared pieces (lib/doc-id.js, lib/roles.js, lib/scope.js, lib/actor.js, lib/activity.js) ──

const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/

export const cleanDocId = (value) => (typeof value === 'string' && DOC_ID.test(value) ? value : null)

export const VALID_ROLES = Object.freeze(['owner', 'internal', 'builder', 'client'])
const BUILDER_TENANTS = Object.freeze(['qbs', 'vision'])
const CORE_TENANT = 'p2-core'

const isStaff = (claims) => claims?.role === 'owner' || claims?.role === 'internal'
const isOwner = (claims) => claims?.role === 'owner'
export const nonEmptyString = (value) => typeof value === 'string' && value !== ''

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

export function requireAuth({ user, store }) {
  if (!user) throw refuse('unauthenticated', 'You must be signed in.')
  return claimsOf(user, store)
}

export function requireStaff(context) {
  const claims = requireAuth(context)
  if (!isStaff(claims)) throw refuse('permission-denied', 'Staff access required.')
  return claims
}

export function requireOwner(context) {
  const claims = requireAuth(context)
  if (!isOwner(claims)) throw refuse('permission-denied', 'Owner access required.')
  return claims
}

export const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

// Who is acting, from the caller and their users document, never from the request.
export function actorOf({ user, store }) {
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

export function notificationDoc({ type, msg, jobId, scope, actor }) {
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

export function historyDoc({ type, action, summary, jobId, extraId, actor }) {
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
