// Runs the Firestore/Storage rules tests inside the Firebase emulators.
// Requires Java 17+ for the emulators (CI installs Java 21).
//
// The test files share one emulator, and each clears its data between tests, so
// they run one file at a time (--test-concurrency=1). Run in parallel, one
// file's clearFirestore() wipes the fixtures another file has just seeded.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const firebaseBin = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase')

const result = spawnSync(
  firebaseBin,
  [
    'emulators:exec',
    '--only', 'firestore,storage',
    '--project', 'p2-dashboard',
    'node --test --test-concurrency=1 tests/rules/*.test.mjs',
  ],
  { cwd: root, stdio: 'inherit', shell: false },
)

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
