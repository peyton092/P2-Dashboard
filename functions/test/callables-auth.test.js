import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from '../lib/admin.js'

// Every callable must turn away a signed out caller before it reads or writes
// anything. A dropped `await requireAuth(req)` (or a guard that is never
// called) would let anyone reach the handler, and nothing else in the suite
// would notice: the other tests all call the handlers with a signed in user.
//
// `fn.run(request)` runs the handler without the HTTP and CORS layer, so
// `{ data: {}, auth: undefined, rawRequest: {} }` is a signed out call. The
// guards throw before any Firestore, Auth or network access, so nothing here
// touches a network (a handler that got past its guard would try, and fail).
const mod = await import('../index.js')

// The callables that exist today. They are named here so that turning one into
// a different kind of function, or dropping it, fails this test instead of
// silently shrinking the list below.
const REQUIRED = [
  'qbAuth',
  'qbCallback',
  'qbDisconnect',
  'ccAuth',
  'ccCallback',
  'ccDisconnect',
  'ccSyncPhotos',
  'createUser',
  'approveExtra',
  'rejectExtra',
  'sendExtraToBuilder',
  'passInspection',
  'failInspection',
  'createJob',
  'backfillScopes',
]

// Everything index.js exports that is a callable, found by its deploy metadata,
// so a callable added later is covered without editing this file.
const callables = Object.entries(mod).filter(([, fn]) => Boolean(fn?.__endpoint?.callableTrigger))

const signedOut = () => ({ data: {}, auth: undefined, rawRequest: {} })

describe('callables reject a signed out caller', () => {
  it('covers every callable the project relies on', () => {
    const found = callables.map(([name]) => name)
    for (const name of REQUIRED) {
      assert.ok(found.includes(name), `${name} must be exported from index.js as a callable`)
    }
  })

  for (const [name, fn] of callables) {
    it(`${name} rejects with unauthenticated before doing anything else`, async () => {
      assert.equal(typeof fn.run, 'function', `${name} must expose .run for this test`)
      await assert.rejects(fn.run(signedOut()), (err) => {
        assert.ok(err instanceof HttpsError, `expected an HttpsError from ${name}, got ${err}`)
        assert.equal(err.code, 'unauthenticated')
        return true
      })
    })

    it(`${name} also rejects a request whose auth is null`, async () => {
      await assert.rejects(fn.run({ data: {}, auth: null, rawRequest: {} }), (err) => {
        assert.ok(err instanceof HttpsError)
        assert.equal(err.code, 'unauthenticated')
        return true
      })
    })
  }
})

// The QuickBooks, CompanyCam and photo sync callables connect, disconnect and sync
// the whole company's integrations, so they are for staff. A builder, a client and a
// signed in account with no role are turned away by the guard, before the handler
// reads anything of its own or reaches a network. Firestore and fetch are replaced so
// that anything past the guard fails loudly: the only Firestore read answered is the
// users/{uid} document the guard reads for a token with no role claim.
describe('the integration callables are staff only', () => {
  const INTEGRATIONS = ['qbAuth', 'qbCallback', 'qbDisconnect', 'ccAuth', 'ccCallback', 'ccDisconnect', 'ccSyncPhotos']

  // What each callable needs to get going, so that only its guard can stop it.
  const DATA = {
    qbCallback: { code: 'code1', state: 'state1', realmId: 'realm1' },
    ccCallback: { code: 'code1', state: 'state1' },
  }

  // users/{uid} as the guard finds it: n2 has a document with no role, the others none.
  const USERS = { n2: { displayName: 'No role yet', email: 'n2@example.com' } }

  const CALLERS = [
    ['a builder', { uid: 'b1', token: { role: 'builder', tenantId: 'qbs', email: 'dana@qbs.example' } }],
    ['a client', { uid: 'c1', token: { role: 'client', clientJobIds: ['QBS-001'], email: 'casey@client.example' } }],
    ['a signed in account with no role and no users document', { uid: 'n1', token: { email: 'n1@example.com' } }],
    ['a signed in account whose users document names no role', { uid: 'n2', token: { email: 'n2@example.com' } }],
  ]

  const STAFF = [
    ['an owner', { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com' } }],
    ['internal staff', { uid: 'i1', token: { role: 'internal', email: 'pat@p2em.com' } }],
  ]

  let touched // every Firestore entry point and network call reached, in order

  beforeEach(() => {
    touched = []
    mock.method(db, 'doc', (path) => {
      touched.push(`doc:${path}`)
      return {
        get: async () => {
          const data = USERS[path.replace(/^users\//, '')]
          return { exists: data !== undefined, data: () => data }
        },
      }
    })
    for (const name of ['collection', 'batch', 'runTransaction', 'getAll']) {
      mock.method(db, name, () => {
        touched.push(name)
        throw new Error(`Firestore ${name} was reached`)
      })
    }
    mock.method(globalThis, 'fetch', async () => {
      touched.push('fetch')
      throw new Error('the network was reached')
    })
    // ccSyncPhotos logs what stopped it before it answers.
    mock.method(console, 'error', () => {})
  })

  afterEach(() => {
    mock.restoreAll()
  })

  const call = (name, auth) => mod[name].run({ data: DATA[name] ?? {}, auth, rawRequest: {} })

  it('covers seven callables that index.js exports', () => {
    assert.equal(INTEGRATIONS.length, 7)
    for (const name of INTEGRATIONS) {
      assert.ok(mod[name]?.__endpoint?.callableTrigger, `${name} must be exported from index.js as a callable`)
    }
  })

  for (const name of INTEGRATIONS) {
    for (const [who, auth] of CALLERS) {
      it(`${name} turns away ${who} with permission-denied, before anything else is read or fetched`, async () => {
        await assert.rejects(call(name, auth), (err) => {
          assert.ok(err instanceof HttpsError, `expected an HttpsError from ${name}, got ${err}`)
          assert.equal(err.code, 'permission-denied')
          assert.equal(err.message, 'Staff access required.')
          return true
        })
        const guardRead = auth.token.role ? [] : [`doc:users/${auth.uid}`]
        assert.deepEqual(touched, guardRead)
      })
    }

    // The control: staff get past the guard, and then meet the stubs, so a handler that
    // let anyone past its guard would have been caught by them above.
    it(`${name} lets an owner and internal staff past the guard`, async () => {
      for (const [who, auth] of STAFF) {
        touched = []
        await assert.rejects(call(name, auth), (err) => {
          assert.ok(!(err instanceof HttpsError && err.code === 'permission-denied'), `${who} was refused by ${name}`)
          return true
        })
        assert.ok(touched.length > 0, `${name} went on to Firestore or the network for ${who}`)
      }
    })
  }
})
