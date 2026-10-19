import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../lib/admin.js'
import { backfillScopes, onExtraWritten, onJobWritten, onSubmitWritten } from '../scope-sync.js'
import { assertNoDashes, code } from './helpers/firestore-stub.js'
import {
  DRAFT_SCENARIO, PINNED_SCENARIO, PLANTED_SCENARIO, applied, authError, claimed, documentEvent, fetched, install,
  jobEvent, logged, resetBetweenTests, restart, revoked, stub, stubAuth, warnings,
} from './helpers/scope-sync-harness.js'

// backfillScopes: the owner's one pass over what exists. The stubs and the spies are in
// helpers/scope-sync-harness.js.

resetBetweenTests()

// A draft change order has not been sent, so only staff may see it. The backfill deletes
// the scope one carries (counted under draftsCleared) and leaves one that carries none
// (counted under drafts, as it is neither stamped nor a document with nowhere to take a
// scope from).
describe('a draft change order', () => {
  const { JOB3, draft } = DRAFT_SCENARIO
  const OWNER = { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com' } }
  const backfill = () => backfillScopes.run({ data: {}, auth: OWNER, rawRequest: {} })
  const isDelete = (value) => value?.isEqual?.(FieldValue.delete()) === true

  it('has its scope cleared by the backfill when it carries one, in one update, counted under draftsCleared', async () => {
    install({
      users: {},
      jobs: { j3: JOB3 },
      extras: { d1: draft({ tenantId: 'qbs', clientUids: ['c1'] }), d2: draft({ tenantId: 'qbs' }), d3: draft({ clientUids: [] }) },
      submits: {},
      notifications: {},
    })
    stubAuth()
    const result = await backfill()
    assert.deepEqual([result.extras, result.draftsCleared, result.drafts, result.skipped], [0, 3, 0, 0])
    const writes = stub.written('extras/')
    assert.deepEqual(writes.map((write) => [write.op, write.path]), [['update', 'extras/d1'], ['update', 'extras/d2'], ['update', 'extras/d3']])
    for (const { data } of writes) {
      assert.deepEqual(Object.keys(data).sort(), ['clientUids', 'tenantId'])
      assert.ok(isDelete(data.tenantId) && isDelete(data.clientUids), 'both fields are deleted')
    }
  })

  it('is left alone by the backfill, and counted under drafts and not as skipped, when it carries no scope', async () => {
    install({ users: {}, jobs: { j3: JOB3 }, extras: { d1: draft(), x1: { id: 'CO-001', job: 'QBS-003', status: 'Sent to Builder' } }, submits: {}, notifications: {} })
    stubAuth()
    const result = await backfill()
    assert.deepEqual([result.extras, result.draftsCleared, result.drafts, result.skipped], [1, 0, 1, 0])
    assert.deepEqual(stub.written('extras/').map((write) => write.path), ['extras/x1'])
  })

  it('counts the drafts that carry a scope and those that carry none under a count each, apart from the documents it skips', async () => {
    install({
      users: {},
      jobs: { j3: JOB3 },
      extras: {
        d1: draft({ tenantId: 'qbs', clientUids: ['c1'] }),
        d2: draft(),
        d3: draft({ id: 'CO-010' }),
        x1: { id: 'CO-001', job: 'QBS-003', status: 'Sent to Builder' },
        x2: { id: 'CO-002', job: 'QBS-404', status: 'pending' },
      },
      submits: {},
      notifications: {},
    })
    stubAuth()
    const result = await backfill()
    assert.deepEqual([result.extras, result.draftsCleared, result.drafts, result.skipped], [1, 1, 2, 1])
    assert.deepEqual(stub.written('extras/').map((write) => write.path), ['extras/d1', 'extras/x1'])
  })

  it('counts a draft that names no job, or a job that does not exist, as a draft and not as skipped', async () => {
    install({
      users: {},
      jobs: { j3: JOB3 },
      extras: {
        a: draft({ job: undefined }),
        b: draft({ job: '' }),
        c: draft({ job: 'QBS-404' }),
        d: draft({ job: 'QBS-404', tenantId: 'qbs', clientUids: ['c1'] }),
      },
      submits: {},
      notifications: {},
    })
    stubAuth()
    const result = await backfill()
    assert.deepEqual([result.extras, result.draftsCleared, result.drafts, result.skipped], [0, 1, 3, 0])
    assert.deepEqual(stub.written('extras/').map((write) => write.path), ['extras/d'], 'the scope of the one that carries it is deleted')
  })

  it('counts a draft once, as cleared when it carried a scope and as a draft when it carries none, on the run after', async () => {
    install({ users: {}, jobs: { j3: JOB3 }, extras: { d1: draft({ tenantId: 'qbs', clientUids: ['c1'] }) }, submits: {}, notifications: {} })
    stubAuth()
    const first = await backfill()
    assert.deepEqual([first.draftsCleared, first.drafts], [1, 0])

    restart({ users: {}, jobs: { j3: JOB3 }, extras: { d1: draft() }, submits: {}, notifications: {} })
    stubAuth()
    const second = await backfill()
    assert.deepEqual([second.draftsCleared, second.drafts], [0, 1])
    assert.deepEqual(stub.written('extras/'), [], 'nothing is written for a draft that carries nothing')
  })
})

// A builder in qbs names a job of vision. Their submission must stay in qbs through the
// backfill too.
describe('a submission a qbs builder planted on a vision job', () => {
  const { VISION, planted, users } = PLANTED_SCENARIO

  it('stays in qbs through the backfill, counted as skipped', async () => {
    install({ users, jobs: { j9: VISION }, extras: {}, submits: { s1: planted }, notifications: {} })
    stubAuth()
    const result = await backfillScopes.run({ data: {}, auth: { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com' } }, rawRequest: {} })
    assert.deepEqual([result.submits, result.skipped], [0, 1])
    assert.deepEqual(stub.written('submits/'), [])
  })
})

// A submission a builder created can carry clients from a time its job was in the
// builder's tenant. The backfill empties them and counts the submission with those it wrote.
describe('a builder submission left in its tenant with clients on it', () => {
  const { VISION, users, pinned, EMPTIED } = PINNED_SCENARIO

  it('has its clientUids emptied by the backfill, counted with the submissions it wrote', async () => {
    install({ users, jobs: { j9: VISION }, extras: {}, submits: { s1: pinned(), s2: pinned({ clientUids: [] }) }, notifications: {} })
    stubAuth()
    const result = await backfillScopes.run({ data: {}, auth: { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com' } }, rawRequest: {} })
    assert.deepEqual(stub.written('submits/'), [{ op: 'update', path: 'submits/s1', data: EMPTIED }])
    assert.deepEqual([result.submits, result.skipped], [1, 1])
  })
})

describe('backfillScopes', () => {
  const OWNER = { uid: 'o1', token: { role: 'owner', email: 'jesse@p2em.com' } }
  const callAs = (auth) => backfillScopes.run({ data: {}, auth, rawRequest: {} })
  const call = () => callAs(OWNER)

  // Two users, two jobs, one change order, and one submission that names no job.
  const small = () => ({
    users: {
      u1: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'], displayName: 'Dana Lee' },
      u2: { role: 'owner', tenantId: 'p2-core', displayName: 'Jesse Parker' },
    },
    jobs: {
      j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['stale'] },
      j2: { id: 'QBS-002' },
    },
    extras: { x1: { id: 'CO-001', job: 'QBS-001' } },
    submits: { s1: { subject: 'Staff note', jobId: null } },
    notifications: {},
  })
  const nothingElse = { jobs: {}, extras: {}, submits: {}, notifications: {} }

  describe('who may run it', () => {
    it('turns away a signed out caller, touching nothing', async () => {
      install(small())
      stubAuth()
      await assert.rejects(callAs(undefined), code('unauthenticated', 'You must be signed in.'))
      assert.deepEqual([stub.calls, stub.writes, fetched, claimed], [[], [], [], []])
    })

    it('turns away internal staff, a builder and a client before it reads or writes anything', async () => {
      install(small())
      stubAuth()
      for (const role of ['internal', 'builder', 'client']) {
        const caller = { uid: 'u9', token: { role, tenantId: 'qbs', email: 'x@y.co' } }
        await assert.rejects(callAs(caller), code('permission-denied', 'Owner access required.'), role)
      }
      assert.deepEqual([stub.calls, stub.writes, stub.batches, fetched, claimed, revoked], [[], [], [], [], [], []])
    })

    it('reads only the caller users document, for a token that carries no role, before it decides', async () => {
      install({ ...small(), users: { ...small().users, late: { role: 'internal' } } })
      stubAuth()
      await assert.rejects(callAs({ uid: 'late', token: { email: 'late@p2em.com' } }), code('permission-denied', 'Owner access required.'))
      assert.deepEqual(stub.calls, ['doc:users/late'])
      assert.deepEqual([stub.writes, fetched, claimed], [[], [], []])
    })

    it('lets in an owner whose role is only in the users document', async () => {
      install({ ...nothingElse, users: { late: { role: 'owner', tenantId: 'p2-core' } } })
      stubAuth()
      const result = await callAs({ uid: 'late', token: { email: 'late@p2em.com' } })
      assert.equal(result.ok, true)
    })
  })

  describe('what it returns', () => {
    it('counts the users, jobs, change orders, submissions and notifications, and what it left alone', async () => {
      install(small())
      stubAuth()
      assert.deepEqual(await call(), { ok: true, users: 2, jobs: 2, extras: 1, submits: 0, notifications: 0, skipped: 1, draftsCleared: 0, drafts: 0 })
    })

    it('counts every collection it stamped', async () => {
      install({
        ...small(),
        extras: { x1: { job: 'QBS-001' }, x2: { job: 'QBS-002' } },
        submits: { s1: { jobId: 'QBS-001' }, s2: { jobId: null } },
        notifications: { n1: { jobId: 'QBS-001' }, n2: { jobId: 'QBS-001' }, n3: { jobId: 'QBS-002' } },
      })
      stubAuth()
      assert.deepEqual(await call(), { ok: true, users: 2, jobs: 2, extras: 2, submits: 1, notifications: 3, skipped: 1, draftsCleared: 0, drafts: 0 })
    })

    it('counts every document of the three collections once, so the counts add up to the documents it read', async () => {
      const documents = {
        users: { b1: { role: 'builder', tenantId: 'qbs' } },
        jobs: { j1: { id: 'QBS-001', tenantId: 'vision' }, j2: { id: 'QBS-002', tenantId: 'qbs' } },
        extras: {
          x1: { job: 'QBS-001', status: 'Sent to Builder' }, // stamped
          x2: { job: 'QBS-404', status: 'pending' }, // no such job: skipped
          x3: { job: 'QBS-002', status: 'Draft' }, // a draft with no scope
          x4: { job: 'QBS-002', status: 'Draft', tenantId: 'qbs', clientUids: [] }, // a draft with its scope cleared
          x5: { job: '', status: 'Draft' }, // a draft that names no job
          x6: { status: 'Approved' }, // names no job: skipped
        },
        submits: {
          s1: { jobId: 'QBS-001' }, // stamped
          s2: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 'b1' }, // a builder's, left in its tenant: skipped
          s3: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], createdBy: 'b1' }, // a builder's, its clients emptied: written
          s4: { subject: 'Staff note' }, // names no job: skipped
        },
        notifications: { n1: { jobId: 'QBS-002' }, n2: { jobId: 'QBS-404' } }, // stamped, and skipped
      }
      install(documents)
      stubAuth()
      const result = await call()
      assert.deepEqual(
        { extras: result.extras, submits: result.submits, notifications: result.notifications, skipped: result.skipped, draftsCleared: result.draftsCleared, drafts: result.drafts },
        { extras: 1, submits: 2, notifications: 1, skipped: 5, draftsCleared: 1, drafts: 2 },
      )
      const read = Object.keys(documents.extras).length + Object.keys(documents.submits).length + Object.keys(documents.notifications).length
      const counted = result.extras + result.submits + result.notifications + result.skipped + result.draftsCleared + result.drafts
      assert.equal(counted, read, 'every document is in exactly one count')
    })

    it('returns zeros for an empty database', async () => {
      install({ users: {}, ...nothingElse })
      stubAuth()
      assert.deepEqual(await call(), { ok: true, users: 0, jobs: 0, extras: 0, submits: 0, notifications: 0, skipped: 0, draftsCleared: 0, drafts: 0 })
      assert.deepEqual([stub.writes, stub.batches], [[], []])
    })

    it('returns the same counts, and leaves everything as the first run did, when it is run again over what that run wrote', async () => {
      const documents = small()
      install(documents)
      stubAuth()
      const first = await call()
      const firstClaims = structuredClone(claimed)
      const next = applied(documents, stub.writes)

      restart(next)
      stubAuth()
      assert.deepEqual(await call(), first)
      assert.deepEqual(claimed, firstClaims)
      assert.deepEqual(applied(next, stub.writes), next, 'the second run changes nothing the first one had not')
    })
  })

  describe('the users', () => {
    it('sets the claims of each user from their document, the way a first assignment does, and signs nobody out', async () => {
      install(small())
      stubAuth()
      await call()
      assert.deepEqual(claimed, [
        { uid: 'u1', claims: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } },
        { uid: 'u2', claims: { role: 'owner', tenantId: 'p2-core', clientJobIds: [] } },
      ])
      assert.deepEqual(revoked, [])
    })

    it('cleans the tenant per role, as onUserWritten does', async () => {
      install({
        users: {
          b1: { role: 'builder', tenantId: 'vision' },
          b2: { role: 'builder', tenantId: 'p2-core' },
          i1: { role: 'internal', tenantId: 'qbs' },
        },
        ...nothingElse,
      })
      stubAuth()
      await call()
      assert.deepEqual(claimed.map((entry) => [entry.uid, entry.claims.tenantId]), [['b1', 'vision'], ['b2', null], ['i1', 'p2-core']])
    })

    it('leaves out a user whose document has no valid role, with a line in the log, without counting them or reading their account', async () => {
      install({ users: { a: { displayName: 'No role' }, b: { role: 'superuser' }, c: { role: null }, d: { role: 'builder', tenantId: 'qbs' } }, ...nothingElse })
      stubAuth()
      const result = await call()
      assert.equal(result.users, 1)
      assert.deepEqual(fetched, ['d'])
      assert.deepEqual(claimed.map((entry) => entry.uid), ['d'])
      assert.equal(warnings().length, 3)
      for (const uid of ['a', 'b', 'c']) assert.equal(warnings().filter((line) => line.includes(`users/${uid} `)).length, 1, uid)
    })

    it('will not lower an owner or internal account, says so, and does not count it', async () => {
      install({
        users: {
          boss: { role: 'client', clientJobIds: ['QBS-001'] },
          pat: { role: 'builder', tenantId: 'qbs' },
          kim: { role: 'internal' },
          dana: { role: 'client', clientJobIds: [] },
        },
        ...nothingElse,
      })
      stubAuth({ existing: { boss: { role: 'owner' }, pat: { role: 'internal' }, kim: { role: 'internal' } } })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['kim', 'dana'], 'kim is internal and stays internal')
      assert.equal(result.users, 2)
      const [first, second, ...more] = warnings()
      assert.equal(more.length, 0)
      assert.match(first, /boss/)
      assert.match(first, /owner/)
      assert.match(first, /client/)
      assert.match(second, /pat/)
      assert.match(second, /internal/)
      assert.match(second, /builder/)
      for (const warning of [first, second]) assertNoDashes(warning)
    })

    it('lets a role go up or stay the same, and sets the claims of an account that has none yet', async () => {
      install({
        users: { a: { role: 'owner' }, b: { role: 'internal' }, c: { role: 'client', clientJobIds: [] }, d: { role: 'internal' } },
        ...nothingElse,
      })
      stubAuth({ existing: { a: { role: 'owner' }, b: { role: 'internal' }, c: { role: 'builder' } } })
      assert.equal((await call()).users, 4)
      assert.deepEqual(warnings(), [])
    })

    it('leaves an owner alone when the document has no role: no claims are set, and the log says why', async () => {
      install({ users: { boss: { displayName: 'No role yet' } }, ...nothingElse })
      stubAuth({ existing: { boss: { role: 'owner' } } })
      const result = await call()
      assert.deepEqual([claimed, result.users, fetched], [[], 0, []], 'nothing is set, and the account is not even read')
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /users\/boss has no valid role/)
    })

    it('skips a users document with no Auth account, logs it, and carries on with the others', async () => {
      install({ users: { ghost: { role: 'builder', tenantId: 'qbs' }, real: { role: 'builder', tenantId: 'vision' } }, ...nothingElse })
      stubAuth({
        getUserError: { ghost: authError('auth/user-not-found') },
        claimsError: { ghost: authError('auth/user-not-found') },
      })
      const result = await call()
      assert.equal(result.users, 1)
      assert.deepEqual(claimed.map((entry) => entry.uid), ['ghost', 'real'])
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /ghost/)
      assert.ok(!logged.some(([level]) => level === 'error'))
    })

    it('skips an account that goes missing only when its claims are set', async () => {
      install({ users: { ghost: { role: 'builder', tenantId: 'qbs' } }, ...nothingElse })
      stubAuth({ claimsError: { ghost: authError('auth/user-not-found') } })
      assert.equal((await call()).users, 0)
    })

    it('stops with a plain message, and logs the cause, on any other Auth failure, before touching a job', async () => {
      install(small())
      stubAuth({ getUserError: { u2: authError('auth/internal-error') } })
      await assert.rejects(call(), code('internal', 'The backfill stopped before it finished. It is safe to run again.'))
      assert.ok(logged.some(([level, , cause]) => level === 'error' && cause?.code === 'auth/internal-error'))
      assert.deepEqual([stub.writes, stub.batches], [[], []])
    })
  })

  // The users are visited one at a time, each with a call to Auth, so a long run can take a while,
  // and a users document can be edited meanwhile. What it sets must follow the documents as they
  // are when each is reached, not as the first scan found them. In these, u0 is visited first, and
  // while its account is read u1 (internal) is demoted to a client of QBS-001 and u2 (a client of
  // QBS-002) is made internal.
  describe('users that change while it runs', () => {
    const documents = () => ({
      users: {
        u0: { role: 'owner', tenantId: 'p2-core' },
        u1: { role: 'internal', tenantId: 'p2-core' },
        u2: { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-002'] },
      },
      jobs: {
        j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: [] },
        j2: { id: 'QBS-002', tenantId: 'qbs', clientUids: ['u2'] },
      },
      extras: {},
      submits: {},
      notifications: {},
    })
    const afterU0 = (change) => (uid) => {
      if (uid === 'u0') change()
    }
    const demote = (users) =>
      afterU0(() => {
        users.u1 = { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] }
        users.u2 = { role: 'internal', tenantId: 'p2-core' }
      })
    const links = () => stub.written('jobs/').map((write) => [write.path, write.data.clientUids])

    it('sets the claims from each document as it is when its turn comes, and never puts back the role it had', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: demote(docs.users) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => [entry.uid, entry.claims.role]), [['u0', 'owner'], ['u1', 'client'], ['u2', 'internal']])
      assert.deepEqual(claimed[1].claims.clientJobIds, ['QBS-001'])
      assert.equal(result.users, 3)
      assert.ok(!claimed.some((entry) => entry.uid === 'u1' && entry.claims.role === 'internal'), 'internal is not set on u1 again')
    })

    it('links the jobs from the documents as they are after the claims, not as the first scan found them', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: demote(docs.users) })
      await call()
      assert.deepEqual(links(), [['jobs/j1', ['u1']], ['jobs/j2', []]])
    })

    it('does not set internal again, or lower the account, when it still has its old claims', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ existing: { u1: { role: 'internal' } }, meanwhile: demote(docs.users) })
      const result = await call()
      assert.ok(!claimed.some((entry) => entry.uid === 'u1'), 'nothing is set for u1: onUserWritten applies the demotion and signs them out')
      assert.equal(result.users, 2)
      assert.equal(warnings().filter((line) => line.includes('u1')).length, 1)
      assert.deepEqual(links(), [['jobs/j1', ['u1']], ['jobs/j2', []]], 'but the job links follow the documents')
    })

    it('skips a user whose document is gone by their turn, with one line in the log, and does not link them', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: afterU0(() => { delete docs.users.u2 }) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['u0', 'u1'])
      assert.equal(result.users, 2)
      const lines = warnings().filter((line) => line.includes('users/u2'))
      assert.equal(lines.length, 1)
      assert.match(lines[0], /users\/u2 is gone/)
      assertNoDashes(lines[0])
      assert.deepEqual(links(), [['jobs/j1', []], ['jobs/j2', []]], 'the stale link to u2 goes')
    })

    it('skips a user whose role is no longer valid by their turn, with one line in the log, and does not read their account', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: afterU0(() => { docs.users.u1 = { displayName: 'Role removed' } }) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['u0', 'u2'])
      assert.equal(result.users, 2)
      assert.ok(!fetched.includes('u1'))
      const lines = warnings().filter((line) => line.includes('users/u1'))
      assert.equal(lines.length, 1)
      assert.match(lines[0], /users\/u1 has no valid role/)
      assertNoDashes(lines[0])
    })

    it('links a client added while it ran, and leaves their claims to the trigger for their document', async () => {
      const docs = documents()
      install(docs)
      stubAuth({ meanwhile: afterU0(() => { docs.users.u3 = { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] } }) })
      const result = await call()
      assert.deepEqual(claimed.map((entry) => entry.uid), ['u0', 'u1', 'u2'])
      assert.equal(result.users, 3)
      assert.deepEqual(links(), [['jobs/j1', ['u3']], ['jobs/j2', ['u2']]])
    })

    it('reads each user document again when their turn comes, once each', async () => {
      install(documents())
      stubAuth()
      await call()
      assert.deepEqual(stub.calls.filter((entry) => entry.startsWith('doc:')), ['doc:users/u0', 'doc:users/u1', 'doc:users/u2'])
    })

    it('scans the users for the job links after it has been through them all, and just before the jobs are written', async () => {
      install(documents())
      stubAuth()
      await call()
      const scans = stub.calls.flatMap((entry, i) => (entry === 'collection:users' ? [i] : []))
      assert.equal(scans.length, 2, 'once to know whom to visit, once for the links')
      assert.ok(scans[1] > stub.calls.lastIndexOf('doc:users/u2'), 'the second scan comes after the last user was visited')
      assert.ok(scans[1] > stub.calls.indexOf('collection:jobs'), 'and after the jobs were read, so it is as fresh as it can be when they are written')
      assert.ok(stub.calls.indexOf('batch') > scans[1])
    })
  })

  describe('the jobs', () => {
    it('sets each job tenant to its own, or qbs when it has none, and writes only the two fields', async () => {
      install({
        users: {},
        jobs: { a: { id: 'QBS-001', tenantId: 'vision', address: '1 Main' }, b: { id: 'QBS-002' }, c: { id: 'QBS-003', tenantId: '' } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => [write.op, write.path, write.data]), [
        ['update', 'jobs/a', { tenantId: 'vision', clientUids: [] }],
        ['update', 'jobs/b', { tenantId: 'qbs', clientUids: [] }],
        ['update', 'jobs/c', { tenantId: 'qbs', clientUids: [] }],
      ])
    })

    it('sets clientUids to exactly the clients whose document lists the job, so a stale link goes', async () => {
      install(small())
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => [write.path, write.data]), [
        ['jobs/j1', { tenantId: 'qbs', clientUids: ['u1'] }],
        ['jobs/j2', { tenantId: 'qbs', clientUids: [] }],
      ])
    })

    it('links every client who lists a job, sorted, and one client to every job they list', async () => {
      install({
        users: {
          zed: { role: 'client', clientJobIds: ['QBS-001', 'QBS-002'] },
          amy: { role: 'client', clientJobIds: ['QBS-001'] },
        },
        jobs: { a: { id: 'QBS-001', tenantId: 'qbs' }, b: { id: 'QBS-002', tenantId: 'qbs', clientUids: ['gone'] } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => write.data.clientUids), [['amy', 'zed'], ['zed']])
    })

    it('links nobody because of what staff or a builder list', async () => {
      install({
        users: {
          o: { role: 'owner', clientJobIds: ['QBS-001'] },
          i: { role: 'internal', clientJobIds: ['QBS-001'] },
          b: { role: 'builder', tenantId: 'qbs', clientJobIds: ['QBS-001'] },
          x: { role: 'superuser', clientJobIds: ['QBS-001'] },
        },
        jobs: { a: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['o', 'i', 'b'] } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/')[0].data.clientUids, [])
    })

    it('ignores an id a client lists that no job has', async () => {
      install({ users: { c: { role: 'client', clientJobIds: ['QBS-404', 'QBS-001'] } }, jobs: { a: { id: 'QBS-001', tenantId: 'qbs' } }, extras: {}, submits: {}, notifications: {} })
      stubAuth()
      await call()
      assert.deepEqual(stub.written('jobs/').map((write) => write.data.clientUids), [['c']])
    })

    it('writes every job even when it already carries the right fields, so the count shows the run covered it', async () => {
      install({
        users: { c: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { a: { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c'] }, b: { id: 'QBS-002', tenantId: 'vision', clientUids: [] } },
        extras: {},
        submits: {},
        notifications: {},
      })
      stubAuth()
      assert.equal((await call()).jobs, 2)
      assert.equal(stub.written('jobs/').length, 2)
    })

    it('gives a job with no id a tenant and no clients, and has no document name it', async () => {
      install({
        users: { c: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { a: { address: '1 Main' } },
        extras: { x: { job: undefined } },
        submits: { s: { jobId: '' } },
        notifications: {},
      })
      stubAuth()
      const result = await call()
      assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs', clientUids: [] }])
      assert.deepEqual([result.jobs, result.extras, result.submits, result.skipped], [1, 0, 0, 2])
    })
  })

  describe('the change orders, submissions and notifications', () => {
    it('stamps each with the scope its job ended up with, the change orders by job and the others by jobId', async () => {
      install({
        users: { u1: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { j1: { id: 'QBS-001', tenantId: 'vision', clientUids: ['stale'] }, j2: { id: 'QBS-002' } },
        extras: { x1: { job: 'QBS-001' }, x2: { job: 'QBS-002', tenantId: 'vision', clientUids: ['stale'] } },
        submits: { s1: { jobId: 'QBS-001' }, s2: { jobId: 'QBS-002' } },
        notifications: { n1: { jobId: 'QBS-001' }, n2: { jobId: 'QBS-002' } },
      })
      stubAuth()
      await call()
      const stamp = (prefix) => stub.written(prefix).map((write) => [write.op, write.path, write.data])
      assert.deepEqual(stamp('extras/'), [
        ['update', 'extras/x1', { tenantId: 'vision', clientUids: ['u1'] }],
        ['update', 'extras/x2', { tenantId: 'qbs', clientUids: [] }],
      ])
      assert.deepEqual(stamp('submits/'), [
        ['update', 'submits/s1', { tenantId: 'vision', clientUids: ['u1'] }],
        ['update', 'submits/s2', { tenantId: 'qbs', clientUids: [] }],
      ])
      assert.deepEqual(stamp('notifications/'), [
        ['update', 'notifications/n1', { tenantId: 'vision', clientUids: ['u1'] }],
        ['update', 'notifications/n2', { tenantId: 'qbs', clientUids: [] }],
      ])
    })

    it('does not look at the field the other collections use: a change order names its job in job, not jobId', async () => {
      install({
        users: {},
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs' } },
        extras: { x1: { jobId: 'QBS-001' } },
        submits: { s1: { job: 'QBS-001' } },
        notifications: { n1: { job: 'QBS-001' } },
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.submits, result.notifications, result.skipped], [0, 0, 0, 3])
      assert.deepEqual(stub.written('extras/').concat(stub.written('submits/'), stub.written('notifications/')), [])
    })

    it('leaves alone, and counts as skipped, every document with no job it can take a scope from', async () => {
      install({
        users: {},
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs' } },
        extras: { a: { job: 'QBS-404' }, b: { job: '' }, c: {}, d: { job: 7 }, e: { job: 'QBS-001' } },
        submits: { f: { jobId: null }, g: { jobId: 'QBS-404' }, h: { jobId: 'QBS-001' } },
        notifications: { i: { jobId: 'QBS-404' }, j: { jobId: 'QBS-001' } },
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.submits, result.notifications, result.skipped], [1, 1, 1, 7])
      const touched = stub.writes.map((write) => write.path)
      for (const left of ['extras/a', 'extras/b', 'extras/c', 'extras/d', 'submits/f', 'submits/g', 'notifications/i']) {
        assert.ok(!touched.includes(left), `${left} is left alone`)
      }
    })

    it('leaves a submission a builder created in another tenant where it is, logs it, and counts it as skipped', async () => {
      install({
        users: {
          u1: { role: 'client', clientJobIds: ['QBS-001'] },
          b1: { role: 'builder', tenantId: 'qbs' },
          s9: { role: 'internal' },
        },
        jobs: { j1: { id: 'QBS-001', tenantId: 'vision' } },
        extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 's9' } },
        submits: {
          s1: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 'b1' },
          s2: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 'u1' },
          s3: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 's9' },
          s4: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 'ghost' },
          s5: { jobId: 'QBS-001', tenantId: 'vision', clientUids: [], createdBy: 'b1' },
          s6: { jobId: 'QBS-001' },
        },
        notifications: {},
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.submits, result.skipped], [1, 5, 1])
      const scope = { tenantId: 'vision', clientUids: ['u1'] }
      assert.deepEqual(
        stub.written('submits/').map((write) => [write.path, write.data]),
        ['s2', 's3', 's4', 's5', 's6'].map((id) => [`submits/${id}`, scope]),
      )
      assert.deepEqual(stub.written('extras/').map((write) => [write.path, write.data]), [['extras/x1', scope]])
      const kept = warnings().filter((line) => line.includes('submits/s1 '))
      assert.equal(kept.length, 1)
      assert.match(kept[0], /tenant qbs/)
      assert.match(kept[0], /tenant vision/)
      assertNoDashes(kept[0].replace('QBS-001', 'ID'))
      assert.equal(stub.calls.filter((entry) => entry.startsWith('doc:users/')).length, 3, 'the creators come from the users scan, not from reads of their own')
    })

    it('compares a builder submission with the effective tenant of a job that has none stored, which is qbs', async () => {
      install({
        users: { b1: { role: 'builder', tenantId: 'qbs' } },
        jobs: { j2: { id: 'QBS-002' } },
        extras: {},
        submits: {
          s1: { jobId: 'QBS-002', tenantId: 'qbs', clientUids: [], createdBy: 'b1' },
          s2: { jobId: 'QBS-002', tenantId: 'vision', clientUids: [], createdBy: 'b1' },
        },
        notifications: {},
      })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.submits, result.skipped], [1, 1])
      assert.deepEqual(stub.written('submits/').map((write) => write.path), ['submits/s1'])
      assert.equal(warnings().filter((line) => line.includes('submits/s2 ')).length, 1)
    })

    it('stamps a document even when it already carries the right scope, so the counts show the run covered it', async () => {
      install({
        users: {},
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
        extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
        submits: {},
        notifications: {},
      })
      stubAuth()
      assert.equal((await call()).extras, 1)
      assert.equal(stub.written('extras/').length, 1)
    })

    it('gives documents of one job their own copy of the clients', async () => {
      install({
        users: { u1: { role: 'client', clientJobIds: ['QBS-001'] } },
        jobs: { j1: { id: 'QBS-001', tenantId: 'qbs' } },
        extras: { x1: { job: 'QBS-001' } },
        submits: {},
        notifications: {},
      })
      stubAuth()
      await call()
      const [jobWrite] = stub.written('jobs/')
      const [extraWrite] = stub.written('extras/')
      assert.notEqual(jobWrite.data.clientUids, extraWrite.data.clientUids)
    })
  })

  describe('batches', () => {
    it('writes the jobs in batches of at most 400', async () => {
      const jobs = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`j${i}`, { id: `QBS-${String(i + 1).padStart(3, '0')}` }]))
      install({ users: {}, jobs, extras: {}, submits: {}, notifications: {} })
      stubAuth()
      assert.equal((await call()).jobs, 450)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 50])
    })

    it('writes the documents of each collection in batches of at most 400, none over the 500 Firestore allows', async () => {
      const notifications = Object.fromEntries(Array.from({ length: 1003 }, (_, i) => [`n${i}`, { jobId: 'QBS-001' }]))
      const extras = Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`x${i}`, { job: 'QBS-001' }]))
      install({ users: {}, jobs: { j1: { id: 'QBS-001' } }, extras, submits: {}, notifications })
      stubAuth()
      const result = await call()
      assert.deepEqual([result.extras, result.notifications], [401, 1003])
      assert.ok(stub.batches.every((group) => group.length <= 400))
      assert.deepEqual(stub.batches.map((group) => group.length), [1, 400, 1, 400, 400, 203])
    })
  })

  describe('when it fails', () => {
    it('stops with a plain message, with no dash in it, and logs the cause, when a batch cannot be committed', async () => {
      install(small())
      stubAuth()
      const cause = new Error('commit failed')
      mock.method(db, 'batch', () => ({ update: () => {}, commit: async () => { throw cause } }))
      await assert.rejects(call(), (err) => {
        code('internal', 'The backfill stopped before it finished. It is safe to run again.')(err)
        assertNoDashes(err.message)
        return true
      })
      assert.ok(logged.some(([level, , logCause]) => level === 'error' && logCause === cause))
    })

    it('stops with the same plain message when a collection cannot be read', async () => {
      install(small())
      stubAuth()
      mock.method(db, 'collection', () => ({ get: async () => { throw new Error('read failed') } }))
      await assert.rejects(call(), code('internal', 'The backfill stopped before it finished. It is safe to run again.'))
    })

    it('does not report success, or log a run, when it stopped', async () => {
      install(small())
      stubAuth({ getUserError: { u1: authError('auth/internal-error') } })
      await assert.rejects(call())
      assert.ok(!logged.some(([level]) => level === 'log'))
    })
  })

  describe('afterwards', () => {
    it('logs who ran it and what it did, once', async () => {
      install(small())
      stubAuth()
      const result = await call()
      const lines = logged.filter(([level]) => level === 'log').map(([, line]) => String(line))
      assert.equal(lines.length, 1)
      assert.match(lines[0], /o1/)
      assert.match(lines[0], new RegExp(JSON.stringify(result).replace(/[{}[\]()*+?.\\^$|]/g, '\\$&')))
    })

    it('writes only to jobs, change orders, submissions and notifications, and never creates a document', async () => {
      install({ ...small(), notifications: { n1: { jobId: 'QBS-001' } } })
      stubAuth()
      await call()
      assert.ok(stub.writes.length > 0)
      for (const write of stub.writes) {
        assert.equal(write.op, 'update')
        assert.match(write.path, /^(jobs|extras|submits|notifications)\//)
      }
    })

    it('leaves nothing for onExtraWritten and onSubmitWritten to do', async () => {
      const documents = {
        ...small(),
        extras: { x1: { job: 'QBS-001' }, x2: { job: 'QBS-002', tenantId: 'vision', clientUids: ['stale'] } },
        submits: { s1: { jobId: 'QBS-001' }, s2: { jobId: null } },
      }
      install(documents)
      stubAuth()
      await call()
      const next = applied(documents, stub.writes)
      for (const [collection, trigger] of [['extras', onExtraWritten], ['submits', onSubmitWritten]]) {
        for (const write of stub.written(`${collection}/`)) {
          restart(next)
          const id = write.path.split('/')[1]
          await trigger.run(documentEvent(collection, id, next[collection][id], documents[collection][id]))
          assert.deepEqual(stub.writes, [], `${write.path} is stamped, so its own trigger writes nothing`)
        }
      }
    })

    it('leaves nothing for onJobWritten to do for the jobs it wrote', async () => {
      const documents = small()
      install(documents)
      stubAuth()
      await call()
      const next = applied(documents, stub.writes)
      for (const id of ['j1', 'j2']) {
        restart(next)
        await onJobWritten.run(jobEvent(id, documents.jobs[id], next.jobs[id]))
        assert.deepEqual(stub.written('extras/').concat(stub.written('submits/'), stub.written('notifications/')), [], id)
      }
    })
  })
})
