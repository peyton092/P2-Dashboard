// Shared setup for the Firestore and Storage rules tests (node:test, run in the emulators).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const hostAndPort = (value) => {
  const [host, port] = value.split(':')
  return { host, port: Number(port) }
}

export async function setupEnv() {
  const env = await initializeTestEnvironment({
    projectId: 'p2-dashboard',
    firestore: {
      rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'),
      ...hostAndPort(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'),
    },
    storage: {
      rules: readFileSync(resolve(root, 'storage.rules'), 'utf8'),
      ...hostAndPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199'),
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
    // A Storage instance acting as uid with these claims (none: role from users/{uid}).
    storageAs: (uid, claims) => env.authenticatedContext(uid, claims).storage(),
    storageAnon: () => env.unauthenticatedContext().storage(),
    // Deletes every object in the bucket. env.clearStorage() lists only the top of
    // the bucket, so an object in a folder (every upload path the app uses) would
    // survive it; this walks each folder too.
    clearStorage: () => env.withSecurityRulesDisabled(async (c) => {
      const walk = async (folder) => {
        const { items, prefixes } = await folder.listAll()
        await Promise.all(items.map((item) => item.delete()))
        await Promise.all(prefixes.map(walk))
      }
      await walk(c.storage().ref())
    }),
  }
}
