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
})
