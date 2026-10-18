// What the trigger and backfill tests of scope-sync.js share: the stubs, the spies, the
// event builders, and the few scenarios that more than one trigger plays. The tests are split
// by trigger (scope-sync-job, scope-sync-doc and scope-sync-backfill; the pure rules in
// scope-sync-pure need none of this). This is not a test: node's runner loads every file under
// test/, and loading this one only defines the exports below.
//
// Nothing here reaches a network. Firestore is the shared stub (helpers/firestore-stub.js,
// with outsideTransactions on, as these read collections and write in batches), and
// the Auth instance is the real singleton with the methods the handlers call replaced,
// so a call that is not stubbed fails loudly instead of quietly succeeding.
//
// stub, claimed, fetched, revoked and logged are live bindings: resetBetweenTests() gives them new
// values before every test, so a test file reads them through its import and never copies
// them at the top of the file.

import { beforeEach, afterEach, mock } from 'node:test'
import { getAuth } from 'firebase-admin/auth'
import { db } from '../../lib/admin.js'
import { stubFirestore } from './firestore-stub.js'

export let stub // what the Firestore stub recorded: calls, reads, writes, batches
export let claimed, fetched, revoked // Auth calls, in order
export let logged // console output: ['warn' | 'error' | 'log', ...arguments]

export const authError = (errorCode) => Object.assign(new Error(`Firebase auth error: ${errorCode}`), { code: errorCode })

// existing: { uid: { role } }, the custom claims each account has now.
// getUserError, claimsError: { uid: error }, what reading or setting one account fails with.
// meanwhile: called with the uid whenever an account is read, for a test that has something
// else change while the handler works through its users (a users document edited, say).
export function stubAuth({ existing = {}, getUserError = {}, claimsError = {}, meanwhile } = {}) {
  const auth = getAuth()
  mock.method(auth, 'getUser', async (uid) => {
    fetched.push(uid)
    meanwhile?.(uid)
    if (getUserError[uid]) throw getUserError[uid]
    return { uid, customClaims: existing[uid] }
  })
  mock.method(auth, 'setCustomUserClaims', async (uid, claims) => {
    claimed.push({ uid, claims })
    if (claimsError[uid]) throw claimsError[uid]
  })
  mock.method(auth, 'revokeRefreshTokens', async (uid) => {
    revoked.push(uid)
  })
}

function captureConsole() {
  logged = []
  mock.method(console, 'warn', (...args) => logged.push(['warn', ...args]))
  mock.method(console, 'error', (...args) => logged.push(['error', ...args]))
  mock.method(console, 'log', (...args) => logged.push(['log', ...args]))
}

// Called once at the top of a test file: every test in it starts with nothing stubbed, nothing
// recorded and the console spies in place, and the stubs come off again afterwards.
export function resetBetweenTests() {
  beforeEach(() => {
    stub = undefined
    claimed = []
    fetched = []
    revoked = []
    captureConsole()
  })

  afterEach(() => {
    mock.restoreAll()
  })
}

export const install = (documents) => {
  stub = stubFirestore(documents, { outsideTransactions: true })
}

// For a test that has to start over part way: takes every stub and spy off and puts the
// console spies back, with nothing logged or called yet. restart also installs the
// documents again, which is what a second handler run after the first one's writes needs.
export function reset() {
  mock.restoreAll()
  claimed = []
  fetched = []
  revoked = []
  captureConsole()
}
export function restart(documents) {
  reset()
  install(documents)
}

// Makes the commits with these numbers fail (1 is the first batch committed, 2 the second),
// and lets the others through to the stub, so a test can lose one batch and see the rest go on.
export function failCommits(...numbers) {
  const real = db.batch
  let commits = 0
  mock.method(db, 'batch', () => {
    const batch = real()
    const commit = batch.commit
    batch.commit = async () => {
      commits += 1
      if (numbers.includes(commits)) throw new Error(`commit ${commits} failed`)
      return commit()
    }
    return batch
  })
}

// Wraps the transactions the stub runs so that one call inside them fails while the rest runs
// as the stub does it: `query` is what the read of a query (the job lookup) fails with, `update`
// what the write fails with.
export function breakTransactions({ query, update }) {
  const real = db.runTransaction
  mock.method(db, 'runTransaction', (work) =>
    real((tx) =>
      work({
        ...tx,
        get: (target) => (query && target.query ? Promise.reject(query) : tx.get(target)),
        update: (...args) => {
          if (update) throw update
          return tx.update(...args)
        },
      }),
    ),
  )
}

export const warnings = () => logged.filter(([level]) => level === 'warn').map(([, message]) => String(message))

export const snap = (data, ref) => ({ exists: data != null, data: () => data, ref })

// A write to jobs/{docId}. before and after are the job as the event reports it (null for
// none). The handler reads the job again, and `now` is what it finds then: the same as
// after unless a test says otherwise. It can also be a function of how many times the job
// has been read so far (1 the first time), for a test where the job moves while the handler
// works. ref.rereads counts the reads. The job is only ever written inside a transaction, so
// a plain ref.update fails the test.
export function jobEvent(docId, before, after, { now = after } = {}) {
  const path = `jobs/${docId}`
  const ref = {
    id: docId,
    path,
    rereads: 0,
    get: async () => {
      ref.rereads += 1
      return snap(typeof now === 'function' ? now(ref.rereads) : now, ref)
    },
    update: () => {
      throw new Error('the job must be written inside a transaction')
    },
  }
  return { params: { id: docId }, data: { before: snap(before, ref), after: snap(after, ref) } }
}

// A write to extras/{docId} or submits/{docId}. Their handlers read the document through
// a transaction, so the stub has to hold it too.
export function documentEvent(collection, docId, after, before = null) {
  const ref = { id: docId, path: `${collection}/${docId}` }
  return { params: { id: docId }, data: { before: snap(before, ref), after: snap(after, ref) } }
}

// The documents as they are once a list of writes has been applied to them.
export function applied(documents, writes) {
  const next = structuredClone(documents)
  for (const { path, data } of writes) {
    const [name, id] = path.split('/')
    next[name][id] = { ...next[name][id], ...data }
  }
  return next
}

export const noEvent = { params: { id: 'x' }, data: undefined }


// ── Scenarios more than one trigger plays ─────────────────────────────────────
// Each is read by a describe of the same name in the files of the triggers that meet it, so
// the tests of one scenario sit with the trigger they exercise.

// A draft change order has not been sent, so only staff may see it: it carries no scope.
// JOB3 is the job it names, and SCOPE the scope that job would give a document.
export const DRAFT_SCENARIO = {
  JOB3: { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1'] },
  SCOPE: { tenantId: 'qbs', clientUids: ['c1'] },
  draft: (over = {}) => ({ id: 'CO-009', job: 'QBS-003', status: 'Draft', ...over }),
}

// A job in vision, one client on it, and the people around it: a builder in qbs and that client.
const VISION = { id: 'VIS-009', tenantId: 'vision', clientUids: ['c9'] }
const VISION_PEOPLE = { b1: { role: 'builder', tenantId: 'qbs' }, c9: { role: 'client', clientJobIds: ['VIS-009'] } }

// A builder in qbs names that job. Their submission must stay in qbs whichever path looks at it.
export const PLANTED_SCENARIO = {
  VISION,
  planted: { subject: 'Free upgrade', jobId: 'VIS-009', tenantId: 'qbs', clientUids: [], createdBy: 'b1', status: 'Open' },
  users: VISION_PEOPLE,
}

// A submission a builder created can carry clients from a time its job was in the builder's
// tenant. Once the job moves it stays in its tenant, with its clientUids emptied (EMPTIED).
export const PINNED_SCENARIO = {
  VISION,
  users: VISION_PEOPLE,
  pinned: (over = {}) => ({ subject: 'Panel', jobId: 'VIS-009', tenantId: 'qbs', clientUids: ['c9'], createdBy: 'b1', ...over }),
  EMPTIED: { clientUids: [] },
}
