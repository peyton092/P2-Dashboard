// Document ids that arrive in a callable's data. They are put into a path, so
// anything that could name a different document (a slash that reaches into a
// subcollection, a reserved name) is refused. Nothing here imports Firebase.

// Firestore generates 20 letters and digits. The app's own ids (QBS-001, carlos)
// also start with one and use only letters, digits, dots, hyphens and underscores.
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/

// The id as given, or null when it is not a string or not a plain id.
export function cleanDocId(value) {
  return typeof value === 'string' && DOC_ID.test(value) ? value : null
}
