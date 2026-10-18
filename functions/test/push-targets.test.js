import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { targetTokens, groupTokens } from '../lib/push-targets.js'

// users/{uid} fields the fan out reads: { role, tenantId, clientJobIds }.
const usersById = {
  owner1:    { role: 'owner' },
  staff1:    { role: 'internal' },
  qbsB:      { role: 'builder', tenantId: 'qbs' },
  visionB:   { role: 'builder', tenantId: 'vision' },
  noTenantB: { role: 'builder' },
  clientA:   { role: 'client', clientJobIds: ['QBS-001'] },
  clientB:   { role: 'client', clientJobIds: ['QBS-002'] },
  clientTen: { role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-005'] },
  jobBuilder: { role: 'builder', tenantId: 'vision', clientJobIds: ['QBS-001'] },
  blankJobs: { role: 'client', clientJobIds: ['', null] },
  noJobsC:   { role: 'client' },
  roleless:  { tenantId: 'qbs', clientJobIds: ['QBS-001'] },
  weird:     { role: 'admin', tenantId: 'qbs', clientJobIds: ['QBS-001'] },
}

// One device per user, token named after the uid for readable assertions.
const tokenDocs = Object.keys(usersById).map((uid) => ({ token: `tok-${uid}`, uid }))

const run = (notif, docs = tokenDocs, users = usersById) => targetTokens(notif, docs, users)

describe('targetTokens: staff', () => {
  it('always reaches owners and internal staff', () => {
    const out = run({ tenantId: 'vision', clientUids: ['clientB'], jobId: 'QBS-002' })
    assert.ok(out.includes('tok-owner1'))
    assert.ok(out.includes('tok-staff1'))
  })

  it('reaches only staff for a notification that carries no scope fields (Review Focus 4)', () => {
    assert.deepEqual(run({ type: 'info', msg: 'Plain notification' }), ['tok-owner1', 'tok-staff1'])
  })

  it('treats empty and null scope fields as no scope', () => {
    const empties = [
      { tenantId: '', clientUids: [], jobId: '' },
      { tenantId: null, clientUids: null, jobId: null },
      { tenantId: undefined },
      { clientUids: 'not-an-array' },
      {},
    ]
    for (const notif of empties) {
      assert.deepEqual(run(notif), ['tok-owner1', 'tok-staff1'], JSON.stringify(notif))
    }
  })

  it('treats a missing notification as having no scope', () => {
    assert.deepEqual(run(undefined), ['tok-owner1', 'tok-staff1'])
    assert.deepEqual(run(null), ['tok-owner1', 'tok-staff1'])
  })
})

describe('targetTokens: builders', () => {
  it('includes a builder whose tenantId matches the notification', () => {
    const out = run({ tenantId: 'qbs' })
    assert.ok(out.includes('tok-qbsB'))
    assert.ok(!out.includes('tok-visionB'))
  })

  it('excludes a builder whose tenantId does not match', () => {
    assert.deepEqual(run({ tenantId: 'vision' }), ['tok-owner1', 'tok-staff1', 'tok-visionB', 'tok-jobBuilder'])
    assert.ok(!run({ tenantId: 'other' }).includes('tok-qbsB'))
  })

  it('never matches a builder with no tenantId against a notification with no tenantId', () => {
    const out = run({ jobId: 'QBS-001' })
    assert.ok(!out.includes('tok-noTenantB'))
    assert.ok(!out.includes('tok-qbsB'))
  })

  it('does not reach builders through clientUids or jobId', () => {
    const out = run({ clientUids: ['qbsB', 'visionB', 'jobBuilder'], jobId: 'QBS-001' })
    assert.ok(!out.includes('tok-qbsB'))
    assert.ok(!out.includes('tok-visionB'))
    // even a builder whose own clientJobIds lists the job
    assert.ok(!out.includes('tok-jobBuilder'))
  })
})

describe('targetTokens: clients', () => {
  it('includes a client listed in the notification clientUids', () => {
    const out = run({ clientUids: ['clientA'] })
    assert.ok(out.includes('tok-clientA'))
    assert.ok(!out.includes('tok-clientB'))
  })

  it('includes a client whose clientJobIds contains the notification jobId', () => {
    const out = run({ jobId: 'QBS-002' })
    assert.ok(out.includes('tok-clientB'))
    assert.ok(!out.includes('tok-clientA'))
  })

  it('excludes a client who is in neither list', () => {
    const out = run({ clientUids: ['someone-else'], jobId: 'QBS-099' })
    assert.ok(!out.includes('tok-clientA'))
    assert.ok(!out.includes('tok-clientB'))
    assert.ok(!out.includes('tok-noJobsC'))
  })

  it('does not reach clients through tenantId alone, even when the client has that tenantId', () => {
    const out = run({ tenantId: 'qbs' })
    assert.ok(!out.includes('tok-clientA'))
    assert.ok(!out.includes('tok-clientB'))
    assert.ok(!out.includes('tok-clientTen'))
  })

  it('does not match a missing jobId against a client with no clientJobIds', () => {
    const out = run({ tenantId: 'qbs', clientUids: [] })
    assert.ok(!out.includes('tok-noJobsC'))
  })

  it('never matches an empty or null jobId against empty placeholders in clientJobIds', () => {
    for (const jobId of ['', null, undefined]) {
      assert.ok(!run({ jobId }).includes('tok-blankJobs'), `jobId ${JSON.stringify(jobId)}`)
    }
  })

  it('combines clientUids and jobId (either one is enough)', () => {
    const out = run({ clientUids: ['clientA'], jobId: 'QBS-002' })
    assert.ok(out.includes('tok-clientA'))
    assert.ok(out.includes('tok-clientB'))
  })

  it('combines tenant and client scope on one notification', () => {
    const out = run({ tenantId: 'qbs', clientUids: ['clientA'] })
    assert.deepEqual(out, ['tok-owner1', 'tok-staff1', 'tok-qbsB', 'tok-clientA'])
  })
})

describe('targetTokens: who is skipped', () => {
  it('skips a token whose uid has no entry in usersById', () => {
    const docs = [{ token: 'known', uid: 'owner1' }, { token: 'ghost', uid: 'deleted-user' }]
    assert.deepEqual(run({}, docs), ['known'])
  })

  it('skips a token with no uid', () => {
    const docs = [
      { token: 'a', uid: null },
      { token: 'b', uid: undefined },
      { token: 'c', uid: '' },
      { token: 'd' },
      { token: 'e', uid: 'owner1' },
    ]
    assert.deepEqual(run({}, docs), ['e'])
  })

  it('ignores users that are only inherited through the prototype chain', () => {
    const polluted = Object.create({ ghost: { role: 'owner' } })
    assert.deepEqual(targetTokens({}, [{ token: 'a', uid: 'ghost' }], polluted), [])
    assert.deepEqual(targetTokens({}, [{ token: 'b', uid: 'constructor' }], {}), [])
    assert.deepEqual(targetTokens({}, [{ token: 'c', uid: '__proto__' }], {}), [])
  })

  it('skips users with no role or an unknown role even when scope fields match', () => {
    const out = run({ tenantId: 'qbs', clientUids: ['roleless', 'weird'], jobId: 'QBS-001' })
    assert.ok(!out.includes('tok-roleless'))
    assert.ok(!out.includes('tok-weird'))
  })

  it('skips entries that have no usable token string', () => {
    const docs = [{ token: '', uid: 'owner1' }, { token: null, uid: 'owner1' }, { uid: 'owner1' }, { token: 'ok', uid: 'owner1' }]
    assert.deepEqual(run({}, docs), ['ok'])
  })
})

describe('targetTokens: result shape', () => {
  it('removes duplicate tokens and keeps input order', () => {
    const docs = [
      { token: 't2', uid: 'staff1' },
      { token: 't1', uid: 'owner1' },
      { token: 't2', uid: 'staff1' },
      { token: 't3', uid: 'owner1' },
      { token: 't1', uid: 'owner1' },
    ]
    assert.deepEqual(run({}, docs), ['t2', 't1', 't3'])
  })

  it('keeps a token once when it appears under an ineligible and an eligible user', () => {
    const docs = [{ token: 'shared', uid: 'visionB' }, { token: 'shared', uid: 'owner1' }]
    assert.deepEqual(run({ tenantId: 'qbs' }, docs), ['shared'])
  })

  it('returns an empty array for empty or missing inputs', () => {
    assert.deepEqual(targetTokens({}, [], usersById), [])
    assert.deepEqual(targetTokens({}, undefined, usersById), [])
    assert.deepEqual(targetTokens({}, null, usersById), [])
    assert.deepEqual(targetTokens({}, tokenDocs, undefined), [])
    assert.deepEqual(targetTokens({}, tokenDocs, {}), [])
  })

  it('does not mutate its inputs', () => {
    const notif = { tenantId: 'qbs', clientUids: ['clientA'] }
    const docs = tokenDocs.map((d) => ({ ...d }))
    const before = JSON.stringify({ notif, docs, usersById })
    run(notif, docs)
    assert.equal(JSON.stringify({ notif, docs, usersById }), before)
  })
})

// A QuerySnapshot like object: docs with an id and data().
const snapOf = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) })

describe('groupTokens', () => {
  it('maps each document to { token: doc.id, uid }', () => {
    const snap = snapOf([
      ['tok-1', { uid: 'u1', platform: 'web' }],
      ['tok-2', { uid: 'u2', platform: 'ios', email: 'x@y.co' }],
    ])
    assert.deepEqual(groupTokens(snap), [
      { token: 'tok-1', uid: 'u1' },
      { token: 'tok-2', uid: 'u2' },
    ])
  })

  it('uses null for a missing or null uid (devices registered before sign in)', () => {
    const snap = snapOf([
      ['tok-1', { platform: 'web' }],
      ['tok-2', { uid: null }],
      ['tok-3', undefined],
    ])
    assert.deepEqual(groupTokens(snap), [
      { token: 'tok-1', uid: null },
      { token: 'tok-2', uid: null },
      { token: 'tok-3', uid: null },
    ])
  })

  it('returns an empty array for an empty snapshot', () => {
    assert.deepEqual(groupTokens({ docs: [] }), [])
    assert.deepEqual(groupTokens({}), [])
    assert.deepEqual(groupTokens(null), [])
  })

  it('feeds targetTokens, which skips devices that never recorded a uid', () => {
    const snap = snapOf([
      ['tok-owner', { uid: 'owner1' }],
      ['tok-legacy', { platform: 'web' }],
      ['tok-qbs', { uid: 'qbsB' }],
      ['tok-vision', { uid: 'visionB' }],
      ['tok-client', { uid: 'clientA' }],
    ])
    const out = targetTokens({ tenantId: 'qbs', clientUids: ['clientA'] }, groupTokens(snap), usersById)
    assert.deepEqual(out, ['tok-owner', 'tok-qbs', 'tok-client'])
  })
})
