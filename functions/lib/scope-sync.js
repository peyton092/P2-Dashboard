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

// The uid a document names in createdBy (the rules make it the signed in author), or
// null when it names none.
export const creatorOf = (doc) => (nonEmptyString(doc?.createdBy) ? doc.createdBy : null)

// Whether the creator of a submission decides if it follows its job: it names who
// created it, and it carries a tenant other than its job's (the legacy default counted
// for a job with no tenant). Only then is the creator's role looked up; every other
// submission follows its job without one. False when either side is missing.
export function creatorDecides(doc, job) {
  if (!isDocument(doc) || !isDocument(job)) return false
  return creatorOf(doc) !== null && nonEmptyString(doc.tenantId) && doc.tenantId !== scopePatchFor(job).tenantId
}

// Whether a submission stays in the tenant it carries instead of taking its job's scope:
// a builder created it (creatorRole is the role in users/{createdBy}) and it carries a
// tenant other than its job's. A builder stamps their own tenant on the submissions they
// create and may name any job, so following the job from there would put their
// submission in another tenant's portals. Every other submission, a client's or staff's,
// or one whose creator is unknown or has no users document, follows its job.
export function staysInTenant(doc, job, creatorRole) {
  return creatorRole === 'builder' && creatorDecides(doc, job)
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
