// Pure rules for turning the current users/{uid} document into custom claims and
// client job links. Nothing here imports Firebase, so it can be unit tested
// without initializing the Admin SDK. The onUserWritten trigger in users.js
// reads the documents and applies the result.

import { VALID_ROLES } from './roles.js'
import { tenantForRole } from './users-validate.js'

const isDocument = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Only the four known roles count; anything else is "no role".
const roleOf = (doc) => (VALID_ROLES.includes(doc.role) ? doc.role : null)

// The job ids a document grants. Only a client has any: the same ids on a
// builder or staff document grant nothing. Non empty strings only, once each,
// in the order the document lists them.
function jobIdsOf(doc, role) {
  if (role !== 'client' || !Array.isArray(doc.clientJobIds)) return []
  const ids = doc.clientJobIds.filter((id) => typeof id === 'string' && id !== '')
  return [...new Set(ids)]
}

// before: the document data before the write that fired the trigger, or null.
// after: the document as it is now, or null when it no longer exists. Anything
// that is not a plain object counts as a missing document; an empty object {}
// is a document with no fields.
//
// Returns
//   claims   the custom claims to set: { role, tenantId, clientJobIds }, or null
//            when the document is gone (clear all claims).
//              role          one of the four valid roles, else null
//              tenantId      cleaned per role exactly as createUser does it
//                            (tenantForRole): qbs or vision for a builder, and
//                            null for a builder with anything else; p2-core for
//                            every other role
//              clientJobIds  a client's ids, else []
//   jobIds   the job ids this user must be linked to: a client's clientJobIds,
//            otherwise []. This is the whole current list, not a change to it
//            (see jobLinkChanges).
//   revoke   whether to revoke the user's refresh tokens: the old document had a
//            valid role and the document is now gone or the role differs. First
//            assignment never revokes, so provisioning users (or a backfill)
//            does not sign anyone out. A tenant change alone does not revoke.
//
// Only `revoke` looks at `before`. Claims and jobs come from `after` alone, so
// however late or out of order the event that led here was, they describe the
// document as it is.
export function claimsPatchFor(before, after) {
  const prev = isDocument(before) ? before : null
  const next = isDocument(after) ? after : null

  const prevRole = prev ? roleOf(prev) : null
  const nextRole = next ? roleOf(next) : null
  const jobIds = next ? jobIdsOf(next, nextRole) : []

  return {
    claims: next
      ? { role: nextRole, tenantId: tenantForRole(nextRole, next.tenantId), clientJobIds: [...jobIds] }
      : null,
    jobIds,
    revoke: prevRole !== null && (next === null || nextRole !== prevRole),
  }
}

const listsUser = (job, uid) => Array.isArray(job?.clientUids) && job.clientUids.includes(uid)

// Each job once, by document path, keeping the first.
function oncePerJob(jobs) {
  const seen = new Set()
  return jobs.filter((job) => !seen.has(job.path) && seen.add(job.path))
}

// Which jobs to link the user to and which to unlink them from, worked out from
// the jobs as they are now rather than from what the document used to say:
//   jobIds  the ids the user must be linked to (claimsPatchFor's jobIds)
//   wanted  the job documents whose `id` field is one of jobIds
//   linked  the job documents whose clientUids already list the user
// A job is { path, id, clientUids }; extra fields (a document reference, say) are
// kept, and the jobs returned are the ones passed in.
//
// Returns { add, remove }: every wanted job that does not list the user, and
// every linked job whose id is not wanted. Because it compares with the jobs
// themselves, every id in the list ends up linked (a job created after its
// client, or a link an earlier run missed, is put right the next time the user
// document is written), and a stale link is dropped whatever the old document
// said.
export function jobLinkChanges(uid, jobIds, wanted, linked) {
  const ids = new Set(jobIds)
  return {
    add: oncePerJob(wanted.filter((job) => ids.has(job.id) && !listsUser(job, uid))),
    remove: oncePerJob(linked.filter((job) => listsUser(job, uid) && !ids.has(job.id))),
  }
}
