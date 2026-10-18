// Pure tenant and client scope rules. A scoped document (a job, or an extra
// stamped from its job) carries:
//   tenantId   - the builder tenant that may see and act on it
//   clientUids - the client accounts that may see and act on it
// Nothing here imports Firebase.

import { isStaff } from './roles.js'

// A string with something in it. Shared with the stamping rules in scope-sync.js and the
// functions that stamp, so that "this field holds an id" is decided in one place.
export const nonEmptyString = (value) => typeof value === 'string' && value !== ''

// The scope a job should carry, with the legacy defaults applied.
//
// 'qbs' is the backfill default for legacy jobs only: the jobs that existed
// before tenantId was recorded all belong to the QBS tenant. It exists so the
// owner backfill (and the stamping triggers) can fill in the missing field. It
// must never be used to make an access decision; canReadJob and canActOnExtra
// below compare the stored tenantId, so an unstamped document is denied to
// builders and clients until it has been stamped.
export function scopeForJob(job) {
  const source = job ?? {}
  return {
    tenantId: nonEmptyString(source.tenantId) ? source.tenantId : 'qbs',
    clientUids: Array.isArray(source.clientUids)
      ? source.clientUids.filter((uid) => typeof uid === 'string')
      : [],
  }
}

// Staff always. A builder when the document's tenantId equals theirs (both
// non empty, so missing never matches missing). A client when their uid is in
// the document's clientUids. Anyone else, including null claims, is denied.
function inScope(claims, doc) {
  if (!claims) return false
  if (isStaff(claims)) return true
  if (claims.role === 'builder') {
    return nonEmptyString(claims.tenantId) && claims.tenantId === doc?.tenantId
  }
  if (claims.role === 'client') {
    return nonEmptyString(claims.uid) && scopeForJob(doc).clientUids.includes(claims.uid)
  }
  return false
}

// Whether the caller may read this job.
export const canReadJob = (claims, job) => inScope(claims, job)

// Whether the caller may approve, reject or otherwise act on this extra, using
// the extra's own stamped tenantId and clientUids.
export const canActOnExtra = (claims, extra) => inScope(claims, extra)
