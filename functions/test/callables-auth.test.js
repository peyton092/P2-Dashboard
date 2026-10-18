import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'

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
