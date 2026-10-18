// Seeds invented demo data into the Firestore EMULATOR only.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed:demo
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  STATIC_JOBS,
  STATIC_EXTRAS,
  STATIC_NOTIFS,
  STATIC_SUBS,
  STATIC_MATERIALS,
  agentFields,
} from './demo-data.mjs'

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST is not set. This script only runs against the emulator.')
  process.exit(1)
}

initializeApp({ projectId: 'p2-dashboard' })
const db = getFirestore()

const MAX_BATCH = 400

// Each entry is { ref, data }; committed in batches of at most MAX_BATCH writes.
const writes = []

for (const job of STATIC_JOBS) {
  writes.push({
    ref: db.collection('jobs').doc(),
    data: {
      ...job,
      ...agentFields(job),
      tenantId: 'qbs',
      clientUids: [],
      _seeded: true,
      createdAt: FieldValue.serverTimestamp(),
    },
  })
}
for (const extra of STATIC_EXTRAS) {
  writes.push({
    ref: db.collection('extras').doc(),
    data: { ...extra, createdAt: FieldValue.serverTimestamp() },
  })
}
for (const n of STATIC_NOTIFS) {
  writes.push({
    ref: db.collection('notifications').doc(),
    data: { type: n.type, msg: n.msg, read: n.read, createdAt: FieldValue.serverTimestamp() },
  })
}
for (const sub of STATIC_SUBS) {
  writes.push({ ref: db.collection('subs').doc(sub.id), data: sub })
}
for (const m of STATIC_MATERIALS) {
  writes.push({
    ref: db.collection('materials').doc(m.id),
    data: { ...m, createdAt: FieldValue.serverTimestamp() },
  })
}

for (let i = 0; i < writes.length; i += MAX_BATCH) {
  const batch = db.batch()
  for (const { ref, data } of writes.slice(i, i + MAX_BATCH)) batch.set(ref, data)
  await batch.commit()
}

console.log(
  `Seeded emulator: ${STATIC_JOBS.length} jobs, ${STATIC_EXTRAS.length} extras, ` +
  `${STATIC_NOTIFS.length} notifications, ${STATIC_SUBS.length} subs, ${STATIC_MATERIALS.length} materials.`,
)
