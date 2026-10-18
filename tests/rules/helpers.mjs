// Shared setup for Firestore rules tests (node:test, run in the emulator).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function setupEnv() {
  const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
  const env = await initializeTestEnvironment({
    projectId: 'p2-dashboard',
    firestore: {
      rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'),
      host: firestoreHost,
      port: Number(firestorePort),
    },
  })

  // Each helper returns a Firestore instance acting as that kind of user.
  const ctx = (uid, claims) => env.authenticatedContext(uid, claims).firestore()

  return {
    env,
    asStaff: (uid) => ctx(uid, { role: 'internal' }),
    asOwner: (uid) => ctx(uid, { role: 'owner' }),
    asBuilder: (uid, tenantId) => ctx(uid, { role: 'builder', tenantId }),
    asClient: (uid, clientJobIds) => ctx(uid, { role: 'client', clientJobIds }),
    // Signed in with NO custom claims: role must come from users/{uid}.
    asUserWithDoc: (uid) => ctx(uid),
    asAnon: () => env.unauthenticatedContext().firestore(),
    // Runs fn(db) with security rules disabled, for seeding fixtures.
    seed: (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore())),
  }
}
