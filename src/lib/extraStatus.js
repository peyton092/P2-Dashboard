// Where a change order stands, read from the status stored on it.
//
// The stored statuses are mixed. The Change Orders screen and the Cloud
// Functions write Title Case (Draft, Sent to Builder, Approved, Rejected); older
// browser writes and the demo data use lower case (pending, approved, rejected).
// Screens ask this instead of comparing the raw text, so both read the same.
//
//   draft     'Draft'. Not sent to the builder yet, so a portal never shows it.
//   pending   waiting for a decision: 'Sent to Builder', 'pending', no status at
//             all, or anything not recognized
//   approved  'Approved' or 'approved'
//   rejected  'Rejected' or 'rejected'
//
// The Cloud Functions keep a copy (functions/lib/extras.js) with the same cases.
export function extraState(extra) {
  const status = typeof extra?.status === 'string' ? extra.status : ''
  if (status === 'Draft') return 'draft'
  if (status === 'Approved' || status === 'approved') return 'approved'
  if (status === 'Rejected' || status === 'rejected') return 'rejected'
  return 'pending'
}

// The status a save from the Change Orders screen may write, as a fragment to
// spread into the saved fields. saved is the change order being edited (it has a
// _docId), or nothing for a new one.
//
// A new change order starts as a draft. After that sending, approving and
// rejecting belong to the Cloud Functions, so a save leaves the status as it is:
// it must not undo a decision made while the form was open. Only one that has no
// status at all becomes a draft.
export function statusOnSave(saved) {
  if (!saved?._docId) return { status: 'Draft' }
  return saved.status ? {} : { status: 'Draft' }
}
