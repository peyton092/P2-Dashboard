// Pure rules for turning a change to a users/{uid} document into custom claims
// and client job membership. Nothing here imports Firebase, so it can be unit
// tested without initializing the Admin SDK. The onUserWritten trigger in
// users.js applies the result.

import { VALID_ROLES } from './roles.js'

const isDocument = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Only the four known roles count; anything else is "no role".
const roleOf = (doc) => (VALID_ROLES.includes(doc.role) ? doc.role : null)

const tenantOf = (doc) => (typeof doc.tenantId === 'string' && doc.tenantId !== '' ? doc.tenantId : null)

// The job ids a document grants. Only a client has any: the same ids on a
// builder or staff document grant nothing. Non empty strings only, once each,
// in the order the document lists them.
function jobIdsOf(doc, role) {
  if (role !== 'client' || !Array.isArray(doc.clientJobIds)) return []
  const ids = doc.clientJobIds.filter((id) => typeof id === 'string' && id !== '')
  return [...new Set(ids)]
}

// before, after: the document data before and after one write, or null when the
// document did not exist (before a create, after a delete). Anything that is
// not a plain object counts as a missing document; an empty object {} is a
// document with no fields.
//
// Returns
//   claims        the custom claims to set: { role, tenantId, clientJobIds }, or
//                 null when the document was deleted (clear all claims). role
//                 is null unless it is one of the four valid roles.
//   addJobIds     job ids whose clientUids must gain this user: the ids the new
//                 document lists that the old one did not
//   removeJobIds  job ids whose clientUids must lose this user: the ids the old
//                 document listed that the new one does not. A user whose role
//                 stops being client, or whose document is deleted, loses all.
//   revoke        whether to revoke the user's refresh tokens: the old document
//                 had a valid role and the new role differs or the document was
//                 deleted. First assignment never revokes, so provisioning
//                 users (or a backfill) does not sign anyone out.
//
// A tenant change on its own updates the claims but does not revoke.
export function claimsPatchFor(before, after) {
  const prev = isDocument(before) ? before : null
  const next = isDocument(after) ? after : null

  const prevRole = prev ? roleOf(prev) : null
  const nextRole = next ? roleOf(next) : null
  const prevJobs = prev ? jobIdsOf(prev, prevRole) : []
  const nextJobs = next ? jobIdsOf(next, nextRole) : []

  return {
    claims: next ? { role: nextRole, tenantId: tenantOf(next), clientJobIds: nextJobs } : null,
    addJobIds: nextJobs.filter((id) => !prevJobs.includes(id)),
    removeJobIds: prevJobs.filter((id) => !nextJobs.includes(id)),
    revoke: prevRole !== null && (next === null || nextRole !== prevRole),
  }
}
