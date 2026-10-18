import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scopeForJob, canReadJob, canActOnExtra } from '../lib/scope.js'

const owner = { uid: 'o1', role: 'owner', tenantId: null, clientJobIds: [] }
const internal = { uid: 'i1', role: 'internal', tenantId: null, clientJobIds: [] }
const qbsBuilder = { uid: 'b1', role: 'builder', tenantId: 'qbs', clientJobIds: [] }
const visionBuilder = { uid: 'b2', role: 'builder', tenantId: 'vision', clientJobIds: [] }
const client = { uid: 'c1', role: 'client', tenantId: null, clientJobIds: ['QBS-001'] }
const otherClient = { uid: 'c2', role: 'client', tenantId: null, clientJobIds: ['QBS-002'] }

describe('scopeForJob', () => {
  it('keeps a tenantId and clientUids that are present', () => {
    assert.deepEqual(scopeForJob({ tenantId: 'vision', clientUids: ['c1', 'c2'] }), {
      tenantId: 'vision',
      clientUids: ['c1', 'c2'],
    })
  })

  it('defaults tenantId to qbs when it is missing, empty or not a string', () => {
    for (const bad of [undefined, null, '', 0, 5, ['vision'], {}]) {
      assert.equal(scopeForJob({ tenantId: bad }).tenantId, 'qbs', `tenantId ${JSON.stringify(bad)}`)
    }
    assert.equal(scopeForJob({}).tenantId, 'qbs')
  })

  it('defaults clientUids to an empty array when missing or not an array', () => {
    for (const bad of [undefined, null, 'c1', 7, { 0: 'c1' }]) {
      assert.deepEqual(scopeForJob({ clientUids: bad }).clientUids, [], `clientUids ${JSON.stringify(bad)}`)
    }
  })

  it('filters non string entries out of clientUids', () => {
    assert.deepEqual(scopeForJob({ clientUids: ['c1', 2, null, undefined, 'c2', {}] }).clientUids, ['c1', 'c2'])
  })

  it('returns a copy, so editing the result cannot change the job', () => {
    const job = { clientUids: ['c1'] }
    scopeForJob(job).clientUids.push('c2')
    assert.deepEqual(job.clientUids, ['c1'])
  })

  it('treats a missing job as a legacy job', () => {
    assert.deepEqual(scopeForJob(null), { tenantId: 'qbs', clientUids: [] })
    assert.deepEqual(scopeForJob(undefined), { tenantId: 'qbs', clientUids: [] })
  })
})

// canReadJob and canActOnExtra apply the same three rules, one to a job and one
// to an extra, each using that document's own tenantId and clientUids fields.
const SUITES = [
  ['canReadJob', canReadJob, (scope) => ({ id: 'QBS-001', name: 'Test job', ...scope })],
  ['canActOnExtra', canActOnExtra, (scope) => ({ id: 'x1', job: 'QBS-001', ...scope })],
]

for (const [name, can, doc] of SUITES) {
  describe(name, () => {
    it('allows staff regardless of the scope fields', () => {
      assert.equal(can(owner, doc({ tenantId: 'vision', clientUids: [] })), true)
      assert.equal(can(internal, doc({ tenantId: 'qbs', clientUids: ['c1'] })), true)
      assert.equal(can(owner, doc({})), true)
      assert.equal(can(internal, doc({})), true)
    })

    it('allows a builder whose tenantId matches', () => {
      assert.equal(can(qbsBuilder, doc({ tenantId: 'qbs' })), true)
      assert.equal(can(visionBuilder, doc({ tenantId: 'vision' })), true)
    })

    it('denies a builder whose tenantId does not match', () => {
      assert.equal(can(qbsBuilder, doc({ tenantId: 'vision' })), false)
      assert.equal(can(visionBuilder, doc({ tenantId: 'qbs' })), false)
    })

    it('denies a builder when the document has no tenantId, even though scopeForJob would default it', () => {
      assert.equal(can(qbsBuilder, doc({})), false)
      assert.equal(can(qbsBuilder, doc({ tenantId: '' })), false)
      assert.equal(can(qbsBuilder, doc({ tenantId: null })), false)
    })

    it('never matches missing against missing for a builder', () => {
      const noTenant = { uid: 'b3', role: 'builder', tenantId: null, clientJobIds: [] }
      assert.equal(can(noTenant, doc({})), false)
      assert.equal(can(noTenant, doc({ tenantId: null })), false)
      assert.equal(can({ ...noTenant, tenantId: '' }, doc({ tenantId: '' })), false)
      assert.equal(can({ ...noTenant, tenantId: undefined }, doc({})), false)
    })

    it('allows a client whose uid is in clientUids', () => {
      assert.equal(can(client, doc({ clientUids: ['c1'] })), true)
      assert.equal(can(client, doc({ clientUids: ['c0', 'c1', 'c9'] })), true)
    })

    it('denies a client whose uid is not in clientUids', () => {
      assert.equal(can(client, doc({ clientUids: ['c2'] })), false)
      assert.equal(can(otherClient, doc({ clientUids: ['c1'] })), false)
      assert.equal(can(client, doc({ clientUids: [] })), false)
    })

    it('denies a client when the document has no usable clientUids', () => {
      assert.equal(can(client, doc({})), false)
      assert.equal(can(client, doc({ clientUids: null })), false)
      assert.equal(can(client, doc({ clientUids: 'c1' })), false)
    })

    it('does not let a client in through tenantId, or a builder in through clientUids', () => {
      const tenantClient = { uid: 'c3', role: 'client', tenantId: 'qbs', clientJobIds: [] }
      assert.equal(can(tenantClient, doc({ tenantId: 'qbs', clientUids: [] })), false)
      const listedBuilder = { uid: 'b1', role: 'builder', tenantId: 'qbs', clientJobIds: [] }
      assert.equal(can(listedBuilder, doc({ tenantId: 'vision', clientUids: ['b1'] })), false)
    })

    it('does not use a clients clientJobIds claim to grant access', () => {
      // clientJobIds names jobs, not documents: only the stamped clientUids count.
      assert.equal(can(client, doc({ tenantId: 'qbs', clientUids: [] })), false)
    })

    it('denies null claims, a null role and unknown roles', () => {
      const scope = { tenantId: 'qbs', clientUids: ['c1'] }
      assert.equal(can(null, doc(scope)), false)
      assert.equal(can(undefined, doc(scope)), false)
      assert.equal(can({ uid: 'c1', role: null, tenantId: 'qbs', clientJobIds: [] }, doc(scope)), false)
      assert.equal(can({ uid: 'c1', role: 'admin', tenantId: 'qbs', clientJobIds: [] }, doc(scope)), false)
    })

    it('denies a client with no uid', () => {
      assert.equal(can({ role: 'client', clientJobIds: [] }, doc({ clientUids: ['c1'] })), false)
      assert.equal(can({ uid: '', role: 'client', clientJobIds: [] }, doc({ clientUids: [''] })), false)
    })

    it('denies non staff when the document itself is missing', () => {
      assert.equal(can(qbsBuilder, null), false)
      assert.equal(can(client, undefined), false)
    })
  })
}

describe('canReadJob and canActOnExtra read the documents own fields', () => {
  it('canActOnExtra ignores which job the extra belongs to', () => {
    const extra = { id: 'x1', job: 'QBS-001', tenantId: 'vision', clientUids: ['c2'] }
    assert.equal(canActOnExtra(qbsBuilder, extra), false)
    assert.equal(canActOnExtra(client, extra), false)
    assert.equal(canActOnExtra(visionBuilder, extra), true)
    assert.equal(canActOnExtra(otherClient, extra), true)
  })
})
