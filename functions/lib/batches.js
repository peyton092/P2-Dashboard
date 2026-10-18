// How the functions split work that Firestore takes a limited amount of at a
// time. Nothing here imports Firebase.

// Job ids are looked up ten at a time with an `in` filter, and written in
// batches kept well under the 500 writes Firestore allows in one.
export const JOB_ID_CHUNK = 10
export const BATCH_SIZE = 400

// The list cut into parts of at most `size`, in order. The last part holds what
// is left, and an empty list gives no parts.
export const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))
