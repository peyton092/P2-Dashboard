// Pure rules for stamping a job's scope onto the documents that belong to it.
// Nothing here imports Firebase, so it can be unit tested without initializing
// the Admin SDK. The triggers and the backfill in scope-sync.js read the
// documents and apply what these decide.
//
// A job's scope is { tenantId, clientUids } (see scope.js). A change order, a
// submission and a notification carry a copy of it, which is what the Firestore
// rules read to decide who may see them.

import { nonEmptyString, scopeForJob } from './scope.js'
import { claimsPatchFor } from './users-sync.js'

const isDocument = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const uidsOf = (list) => (Array.isArray(list) ? list.filter((uid) => typeof uid === 'string') : [])

// Whether two lists hold the same items, whatever their order or repeats.
function sameItems(a, b) {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((item) => right.has(item))
}

// The fields to write onto a document so that it carries this job's scope:
// exactly { tenantId, clientUids }. It is scopeForJob's answer (the qbs default
// for a job with no tenant, only strings in clientUids), so what gets stamped and
// what the access checks assume cannot disagree. The job is not changed, and the
// result shares nothing with it.
export function scopePatchFor(job) {
  const { tenantId, clientUids } = scopeForJob(job)
  return { tenantId, clientUids }
}

// Whether a scoped document (a change order, a submission, a notification) has to
// be written again to carry the scope of its job. That is so when it has no
// tenantId, or no clientUids list, or either differs from what the job says. The
// uids are compared as sets, so the same uids in another order are not a
// difference.
//
// doc is the document's data and job the job's data. When either is missing
// (null, or not a plain object) there is nothing to do, so the answer is false.
// A document that has been stamped from its job is therefore never asked to be
// stamped again, which is what keeps a trigger from firing on its own write.
export function needsRestamp(doc, job) {
  if (!isDocument(doc) || !isDocument(job)) return false
  if (!nonEmptyString(doc.tenantId) || !Array.isArray(doc.clientUids)) return true
  const want = scopePatchFor(job)
  return doc.tenantId !== want.tenantId || !sameItems(doc.clientUids, want.clientUids)
}

// Whether stamping this job's scope onto a submission would move it to another
// tenant: the submission carries a tenant of its own (a builder stamps theirs on
// the submissions they create) and the job is in a different one, the legacy
// default counted for a job with no tenant. Such a submission is left where it
// is, so a builder cannot put one in another tenant's portals by naming a job of
// that tenant. A document with no tenant, or an empty one, moves nowhere: it
// simply takes its job's. When either side is missing the answer is false.
export function movesTenant(doc, job) {
  if (!isDocument(doc) || !isDocument(job)) return false
  return nonEmptyString(doc.tenantId) && doc.tenantId !== scopePatchFor(job).tenantId
}

// Whether a job's fan out may restamp this submission: it carries no tenant (or an
// empty one), and so takes its job's, or it carries one of the tenants the job was
// in before (previous, a list; empty for a new job, which was in none). A submission
// that carries any other tenant is left where it is, as onSubmitWritten leaves it,
// or a builder could name a job of another tenant and wait for that job's clients
// to change. False for a missing document.
export function followsJob(doc, previous) {
  if (!isDocument(doc)) return false
  return !nonEmptyString(doc.tenantId) || previous.includes(doc.tenantId)
}

// The tenant a job is stored with, or null when it has none. Unlike scopeForJob
// this does not fill in the qbs default: here the question is whether the stored
// value changed, and a job that gets its tenantId written down has changed.
const storedTenant = (job) => (nonEmptyString(job.tenantId) ? job.tenantId : null)

// Whether a write to a job changed what its documents carry: the tenantId it is
// stored with, or the set of uids in clientUids (a reorder is not a change, and
// neither is an entry that is not a uid).
//   before  the job before the write, or null when the write created it
//   after   the job after the write, or null when the write deleted it
// A deleted job changes nothing, because its documents keep the scope they were
// last given. A new job counts as a change, so that anything already pointing at
// it is stamped.
export function scopeChanged(before, after) {
  if (!isDocument(after)) return false
  if (!isDocument(before)) return true
  return storedTenant(before) !== storedTenant(after) || !sameItems(uidsOf(before.clientUids), uidsOf(after.clientUids))
}

// The id of the job a document names in `field` (like QBS-001), or null when it names none:
// the field is missing, empty or not a string, or there is no document. A change order names
// its job in `job`, and a submission or a notification in `jobId`.
export const jobIdOf = (doc, field) => (nonEmptyString(doc?.[field]) ? doc[field] : null)

// Which clients may see which jobs, read from the users documents: a Map from a
// job's id (like QBS-001) to the uids of the client accounts that list it, sorted
// so the same users always give the same answer. Only a client's clientJobIds
// count, the same rule onUserWritten applies through claimsPatchFor, so staff and
// builders never appear however many ids their document lists.
//   users  [{ uid, data }], the users documents by uid
export function clientLinks(users) {
  const links = new Map()
  for (const { uid, data } of users) {
    for (const jobId of claimsPatchFor(null, data).jobIds) {
      if (!links.has(jobId)) links.set(jobId, new Set())
      links.get(jobId).add(uid)
    }
  }
  return new Map([...links].map(([jobId, uids]) => [jobId, [...uids].sort()]))
}
