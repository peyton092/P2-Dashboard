import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// A deployed function that is no longer exported from index.js is deleted on
// the next deploy, so a refactor that drops or renames one would remove it from
// production. This pins every existing function by name, with the region,
// trigger kind and secret bindings it must keep. Later tasks add exports; they
// must not remove or rewire these.
const QB_SECRETS = ['QB_CLIENT_ID', 'QB_CLIENT_SECRET']
const CC_SECRETS = ['CC_CLIENT_ID', 'CC_CLIENT_SECRET']

const EXPECTED = {
  qbAuth:                { trigger: 'callableTrigger', secrets: QB_SECRETS },
  qbCallback:            { trigger: 'callableTrigger', secrets: QB_SECRETS },
  qbDisconnect:          { trigger: 'callableTrigger', secrets: QB_SECRETS },
  ccAuth:                { trigger: 'callableTrigger', secrets: CC_SECRETS },
  ccCallback:            { trigger: 'callableTrigger', secrets: CC_SECRETS },
  ccDisconnect:          { trigger: 'callableTrigger', secrets: CC_SECRETS },
  ccSyncPhotos:          { trigger: 'callableTrigger', secrets: CC_SECRETS },
  ccSyncPhotosScheduled: { trigger: 'scheduleTrigger', secrets: CC_SECRETS },
  onNotificationCreated: { trigger: 'eventTrigger',    secrets: [] },
  createUser:            { trigger: 'callableTrigger', secrets: [] },
  onUserWritten:         { trigger: 'eventTrigger',    secrets: [] },
  approveExtra:          { trigger: 'callableTrigger', secrets: [] },
  rejectExtra:           { trigger: 'callableTrigger', secrets: [] },
  sendExtraToBuilder:    { trigger: 'callableTrigger', secrets: [] },
  passInspection:        { trigger: 'callableTrigger', secrets: [] },
  failInspection:        { trigger: 'callableTrigger', secrets: [] },
  createJob:             { trigger: 'callableTrigger', secrets: [] },
}

const mod = await import('../index.js')

describe('index.js exports', () => {
  for (const [name, want] of Object.entries(EXPECTED)) {
    it(`${name} is still exported as a ${want.trigger} in us-central1`, () => {
      const fn = mod[name]
      assert.equal(typeof fn, 'function', `${name} must be exported from index.js`)
      const endpoint = fn.__endpoint
      assert.ok(endpoint, `${name} must be a Firebase function`)
      assert.deepEqual(endpoint.region, ['us-central1'])
      assert.ok(endpoint[want.trigger], `${name} must keep its ${want.trigger}`)
      const secrets = (endpoint.secretEnvironmentVariables || []).map((s) => s.key).sort()
      assert.deepEqual(secrets, want.secrets)
    })
  }

  it('keeps the schedule and the notifications trigger path', () => {
    assert.equal(mod.ccSyncPhotosScheduled.__endpoint.scheduleTrigger.schedule, 'every 6 hours')
    assert.equal(mod.onNotificationCreated.__endpoint.eventTrigger.eventFilterPathPatterns.document, 'notifications/{id}')
  })

  it('runs onUserWritten on every write to a users document', () => {
    const trigger = mod.onUserWritten.__endpoint.eventTrigger
    assert.equal(trigger.eventType, 'google.cloud.firestore.document.v1.written')
    assert.equal(trigger.eventFilterPathPatterns.document, 'users/{uid}')
  })

  // onCall does not put cors into the deploy metadata, so it is checked the way a
  // browser meets it: a preflight request must be answered for the caller's
  // origin, with POST allowed.
  async function preflight(fn) {
    const headers = {}
    const listeners = {}
    const res = {
      statusCode: 200,
      setHeader: (name, value) => { headers[name.toLowerCase()] = value },
      getHeader: (name) => headers[name.toLowerCase()],
      removeHeader: (name) => { delete headers[name.toLowerCase()] },
      on: (event, fn) => { (listeners[event] ??= []).push(fn) },
      write: () => {},
      end() { (listeners.finish ?? []).forEach((fn) => fn()) },
    }
    const origin = 'https://p2-dashboard.web.app'
    const req = {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    }
    await fn(req, res)
    return { res, headers, origin }
  }

  it('lets the hosted app call createUser across origins (cors: true)', async () => {
    const { res, headers, origin } = await preflight(mod.createUser)
    assert.equal(res.statusCode, 204)
    assert.equal(headers['access-control-allow-origin'], origin)
    assert.match(headers['access-control-allow-methods'], /POST/)
  })

  for (const name of ['approveExtra', 'rejectExtra', 'sendExtraToBuilder', 'passInspection', 'failInspection', 'createJob']) {
    it(`lets the hosted app call ${name} across origins (cors: true)`, async () => {
      const { res, headers, origin } = await preflight(mod[name])
      assert.equal(res.statusCode, 204)
      assert.equal(headers['access-control-allow-origin'], origin)
      assert.match(headers['access-control-allow-methods'], /POST/)
    })
  }
})

// The hosted app can only call a callable once allUsers has the Cloud Run invoker
// role on it, which functions/scripts/grant-public-invoker.js grants one service
// at a time (the service is the function name in lower case). A callable missing
// from its list deploys fine and then answers 403 to the browser, so the list is
// held to exactly the callables index.js exports.
describe('grant-public-invoker.js', () => {
  it('lists every callable index.js exports, and nothing else', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../scripts/grant-public-invoker.js', import.meta.url), 'utf8')
    const list = source.match(/const SERVICES = \[([^\]]*)\]/)?.[1]
    assert.ok(list, 'SERVICES must be an array literal')
    const listed = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    const callables = Object.entries(mod)
      .filter(([, fn]) => Boolean(fn?.__endpoint?.callableTrigger))
      .map(([name]) => name.toLowerCase())
      .sort()
    assert.deepEqual(listed, callables)
  })
})
