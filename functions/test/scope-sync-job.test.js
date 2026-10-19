import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../lib/admin.js'
import { scopePatchFor } from '../lib/scope-sync.js'
import { onExtraWritten, onJobWritten, onSubmitWritten } from '../scope-sync.js'
import { assertNoDashes } from './helpers/firestore-stub.js'
import {
  DRAFT_SCENARIO, PINNED_SCENARIO, PLANTED_SCENARIO, applied, breakTransactions, documentEvent, failCommits, install,
  jobEvent, logged, noEvent, resetBetweenTests, restart, snap, stub, warnings,
} from './helpers/scope-sync-harness.js'

// onJobWritten: the fan out from a job to the change orders, submissions and notifications
// that name it. The stubs and the spies are in helpers/scope-sync-harness.js.

resetBetweenTests()

describe('onJobWritten', () => {
  const run = (event) => onJobWritten.run(event)

  const JOB = { id: 'QBS-001', address: '1 Main St', tenantId: 'qbs', clientUids: ['c1'] }
  const dependents = (over = {}) => ({
    extras: {
      x1: { id: 'CO-001', job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], status: 'pending' },
      x2: { id: 'CO-002', job: 'QBS-002', tenantId: 'qbs', clientUids: [] },
      x3: { id: 'CO-003', job: 'QBS-001', status: 'Draft' },
      x4: { id: 'CO-004', jobId: 'QBS-001' },
    },
    submits: {
      s1: { subject: 'RFI', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] },
      s2: { subject: 'Staff note', jobId: null },
      s3: { subject: 'Other', jobId: 'QBS-002', tenantId: 'qbs', clientUids: [] },
      s4: { subject: 'No job at all' },
      s5: { subject: 'Wrong field', job: 'QBS-001' },
    },
    notifications: {
      n1: { msg: 'a', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] },
      n2: { msg: 'b', jobId: 'QBS-002', tenantId: 'qbs', clientUids: [] },
      n3: { msg: 'c', jobId: 'QBS-001', tenantId: 'vision', clientUids: ['c1'] },
      n4: { msg: 'wrong field', job: 'QBS-001' },
    },
    ...over,
  })
  // n notifications that name QBS-001 and carry a scope that is not the job's, as {n0: ..., n1: ...}.
  const many = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, { msg: `m${i}`, jobId: 'QBS-001', tenantId: 'qbs', clientUids: [] }]))

  describe('when nothing about the scope changed', () => {
    it('writes nothing and reads nothing when only something else about the job changed', async () => {
      const after = { ...JOB, address: '2 Main St', status: 'complete' }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', JOB, after)
      await run(event)
      assert.deepEqual([stub.calls, stub.writes, stub.batches], [[], [], []])
      assert.equal(event.data.after.ref.rereads, 0, 'the job is not even read again')
    })

    it('does not treat the same clients in another order as a change', async () => {
      const before = { ...JOB, clientUids: ['c1', 'c2'] }
      const after = { ...JOB, clientUids: ['c2', 'c1'] }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', before, after)
      await run(event)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(event.data.after.ref.rereads, 0)
    })

    it('does not write to the tenantId of a job that already existed without one', async () => {
      const legacy = { id: 'QBS-001', address: '1 Main St' }
      install({ jobs: { j1: legacy }, ...dependents() })
      await run(jobEvent('j1', legacy, { ...legacy, address: '2 Main St' }))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })

    it('writes nothing for a deleted job, and does not read it again', async () => {
      install({ jobs: {}, ...dependents() })
      let reads = 0
      const event = jobEvent('j1', JOB, null)
      event.data.before.ref.get = async () => {
        reads += 1
        return snap(null)
      }
      await run(event)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(reads, 0)
    })

    it('does nothing, and warns, when the event carries no data', async () => {
      install({ jobs: {}, ...dependents() })
      await run(noEvent)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(warnings().length, 1)
    })
  })

  describe('when the tenant or the clients changed', () => {
    it('reads the job again, and stamps the change orders by job, and the submissions and notifications by jobId', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      const event = jobEvent('j1', JOB, after)
      await run(event)
      assert.equal(event.data.after.ref.rereads, 2, 'once to stamp from, and once more afterwards to see whether it moved')
      const scope = { tenantId: 'vision', clientUids: ['c1'] }
      const written = stub.writes.map((write) => [write.op, write.path, write.data]).sort((a, b) => a[1].localeCompare(b[1]))
      assert.deepEqual(written, [
        ['update', 'extras/x1', scope],
        ['update', 'notifications/n1', scope],
        ['update', 'submits/s1', scope],
      ])
    })

    it('leaves alone the other jobs, the drafts, the staff submissions, the documents that name the job in the wrong field, and the ones already right', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', JOB, after))
      const touched = stub.writes.map((write) => write.path)
      for (const untouched of ['extras/x2', 'extras/x3', 'extras/x4', 'submits/s2', 'submits/s3', 'submits/s4', 'submits/s5', 'notifications/n2', 'notifications/n3', 'notifications/n4']) {
        assert.ok(!touched.includes(untouched), `${untouched} must not be written`)
      }
    })

    it('writes exactly tenantId and clientUids to each, and nothing else of the document', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', JOB, after))
      for (const write of stub.writes) {
        assert.equal(write.op, 'update')
        assert.deepEqual(Object.keys(write.data).sort(), ['clientUids', 'tenantId'])
      }
    })

    it('stamps the new clients when one is linked or unlinked', async () => {
      const after = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(stub.writes.map((write) => write.path).sort(), ['extras/x1', 'notifications/n1', 'notifications/n3', 'submits/s1'])
      assert.ok(stub.writes.every((write) => write.data.clientUids.join() === 'c1,c2'))

      const gone = { ...JOB, clientUids: [] }
      restart({ jobs: { j1: gone }, ...dependents() })
      await run(jobEvent('j1', JOB, gone))
      assert.ok(stub.writes.length > 0)
      assert.ok(stub.writes.every((write) => write.data.clientUids.length === 0))
    })

    it('writes nothing when every document that names the job already carries the new scope', async () => {
      const after = { ...JOB, tenantId: 'vision', clientUids: ['c1', 'c2'] }
      const stamped = { tenantId: 'vision', clientUids: ['c2', 'c1'] }
      install({
        jobs: { j1: after },
        extras: { x1: { job: 'QBS-001', ...stamped } },
        submits: { s1: { jobId: 'QBS-001', ...stamped } },
        notifications: { n1: { jobId: 'QBS-001', ...stamped } },
      })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual([stub.writes, stub.batches], [[], []])
      assert.equal(stub.calls.filter((entry) => entry.startsWith('collection:')).length, 3, 'it did look')
    })

    it('gives the documents the legacy default tenant when the job has none', async () => {
      const before = { id: 'QBS-001', clientUids: [] }
      const after = { id: 'QBS-001', clientUids: ['c1'] }
      install({
        jobs: { j1: after },
        extras: { x1: { job: 'QBS-001', tenantId: 'vision', clientUids: [] }, x3: { job: 'QBS-001' } },
        submits: {},
        notifications: {},
      })
      await run(jobEvent('j1', before, after))
      assert.deepEqual(stub.writes.map((write) => [write.path, write.data]), [
        ['extras/x1', { tenantId: 'qbs', clientUids: ['c1'] }],
        ['extras/x3', { tenantId: 'qbs', clientUids: ['c1'] }],
      ])
    })

    it('stamps a job that names nothing yet without error, when no document names it', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({ jobs: { j1: after }, extras: {}, submits: {}, notifications: {} })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual([stub.writes, stub.batches], [[], []])
    })

    it('works from the job as it is now, not as the event says', async () => {
      // The event is for the write that linked c1. A later write has linked c2 as well.
      const eventAfter = { ...JOB, clientUids: ['c1'] }
      const now = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: now }, ...dependents() })
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, eventAfter, { now }))
      assert.ok(stub.writes.length > 0)
      assert.ok(stub.writes.every((write) => write.data.clientUids.join() === 'c1,c2'))
    })

    it('lets a late event for an older write leave the latest scope in place', async () => {
      // Writes: [] to [c1] (event 1), then [c1] to [c1, c2] (event 2). Event 2 is handled
      // first, and event 1 arrives after it, finding the documents already right.
      const latest = { ...JOB, clientUids: ['c1', 'c2'] }
      install({ jobs: { j1: latest }, ...dependents() })
      await run(jobEvent('j1', JOB, latest))
      const documents = applied({ jobs: { j1: latest }, ...dependents() }, stub.writes)
      stub.clear()
      restart(documents)
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, { ...JOB, clientUids: ['c1'] }, { now: latest }))
      assert.deepEqual(stub.writes, [], 'the older event does not put the older scope back')
    })

    it('writes nothing when the job is gone by the time it is read again', async () => {
      install({ jobs: {}, ...dependents() })
      await run(jobEvent('j1', JOB, { ...JOB, tenantId: 'vision' }, { now: null }))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })

    it('warns, and stamps nothing, for a job that has no id to find its documents by', async () => {
      const after = { tenantId: 'vision', clientUids: [] }
      install({ jobs: { j1: after }, ...dependents() })
      await run(jobEvent('j1', { tenantId: 'qbs', clientUids: [] }, after))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], /jobs\/j1/)
    })
  })

  // A submission a builder created stays in the builder's tenant when it names a job of
  // another one, or a builder could put a submission in another tenant's portals by
  // naming one of its jobs and waiting for that job's clients to change. Every other
  // submission, and every change order and notification, follows its job.
  describe('a submission a builder created in another tenant', () => {
    const people = {
      b1: { role: 'builder', tenantId: 'vision' },
      b2: { role: 'builder', tenantId: 'vision' },
      b3: { role: 'builder', tenantId: 'qbs' },
      c1: { role: 'client', clientJobIds: ['QBS-001'] },
      s9: { role: 'internal' },
    }
    const odd = (over) => ({ jobId: 'QBS-001', tenantId: 'vision', clientUids: [], ...over })
    const creatorReads = () => stub.calls.filter((entry) => entry.startsWith('doc:users/'))
    const keptLines = (id) => warnings().filter((line) => line.includes(`submits/${id} `))
    const withSubmits = (submits, job) => ({ users: people, jobs: { j1: job }, ...dependents({ submits: { ...dependents().submits, ...submits } }) })

    it('is left alone, and logged once, when the clients of its job change', async () => {
      const after = { ...JOB, clientUids: ['c1', 'c2'] }
      install(withSubmits({ s6: odd({ createdBy: 'b1' }) }, after))
      await run(jobEvent('j1', JOB, after))
      const touched = stub.writes.map((write) => write.path)
      assert.ok(!touched.includes('submits/s6'), 'submits/s6 is not written')
      assert.ok(touched.includes('submits/s1'), 'a submission of the job tenant still gets the new clients')
      assert.equal(keptLines('s6').length, 1)
      assert.match(keptLines('s6')[0], /tenant vision/)
      assert.match(keptLines('s6')[0], /tenant qbs/)
      assertNoDashes(keptLines('s6')[0].replace('QBS-001', 'ID'))
    })

    it('is restamped when a client or staff created it in a stale tenant', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      const stale = { s7: odd({ tenantId: 'qbs', createdBy: 'c1' }), s8: odd({ tenantId: 'p2-core', createdBy: 's9' }) }
      install(withSubmits(stale, after))
      await run(jobEvent('j1', JOB, after))
      const scope = scopePatchFor(after)
      const written = Object.fromEntries(stub.written('submits/').map((write) => [write.path, write.data]))
      assert.deepEqual([written['submits/s7'], written['submits/s8']], [scope, scope])
      assert.deepEqual(keptLines('s7').concat(keptLines('s8')), [])
    })

    it('follows its job when its creator has no users document, or it names no creator', async () => {
      const after = { ...JOB, clientUids: ['c1', 'c2'] }
      install(withSubmits({ s7: odd({ createdBy: 'ghost' }), s8: odd() }, after))
      await run(jobEvent('j1', JOB, after))
      const written = stub.written('submits/').map((write) => write.path)
      assert.ok(written.includes('submits/s7') && written.includes('submits/s8'))
      assert.deepEqual(creatorReads(), ['doc:users/ghost'], 'only the submission that names a creator has one looked up')
    })

    it('reads each creator once in a pass, and only for a submission in another tenant', async () => {
      const after = { ...JOB, clientUids: ['c1', 'c2'] }
      const submits = {
        s6: odd({ createdBy: 'b1' }),
        s7: odd({ createdBy: 'b1', subject: 'Second' }),
        s8: odd({ createdBy: 'b2' }),
        s9: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 'b3' },
        s10: { jobId: 'QBS-001', createdBy: 'b3' },
      }
      install(withSubmits(submits, after))
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(creatorReads().sort(), ['doc:users/b1', 'doc:users/b2'])
      const written = stub.written('submits/').map((write) => write.path)
      for (const id of ['s9', 's10']) assert.ok(written.includes(`submits/${id}`), `${id} follows its job`)
    })

    it('is logged once, though each pass reads its creator, when the job moves while its documents are stamped', async () => {
      const first = { ...JOB, clientUids: ['c1', 'c2'] }
      const newer = { ...JOB, clientUids: ['c1', 'c2', 'c3'] }
      install({ users: people, jobs: { j1: newer }, extras: {}, submits: { s6: odd({ createdBy: 'b1' }) }, notifications: {} })
      await run(jobEvent('j1', JOB, first, { now: (n) => (n === 1 ? first : newer) }))
      assert.deepEqual(stub.writes, [])
      assert.equal(keptLines('s6').length, 1)
      assert.deepEqual(creatorReads(), ['doc:users/b1', 'doc:users/b1'])
    })

    it('moves the client and staff submissions of a job deleted and created again in another tenant, and not the builder ones', async () => {
      const created = { id: 'QBS-001', tenantId: 'vision', clientUids: ['c1'] }
      install({
        users: people,
        jobs: { j5: created },
        extras: {},
        submits: {
          s1: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], createdBy: 'c1' },
          s2: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 's9' },
          s3: { jobId: 'QBS-001', tenantId: 'qbs', clientUids: [], createdBy: 'b3' },
        },
        notifications: {},
      })
      await run(jobEvent('j5', null, created))
      const scope = { tenantId: 'vision', clientUids: ['c1'] }
      assert.deepEqual(stub.written('submits/').map((write) => [write.path, write.data]), [
        ['submits/s1', scope],
        ['submits/s2', scope],
      ])
      assert.equal(keptLines('s3').length, 1)
    })

    it('leaves the change orders and notifications to follow their job, whatever tenant they carry and whoever made them', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      install({
        users: people,
        jobs: { j1: after },
        extras: { x9: { job: 'QBS-001', tenantId: 'p2-core', clientUids: [], createdBy: 'b1' } },
        submits: {},
        notifications: { n9: { jobId: 'QBS-001', tenantId: 'p2-core', clientUids: [], createdBy: 'b1' } },
      })
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(stub.writes.map((write) => write.path).sort(), ['extras/x9', 'notifications/n9'])
      assert.deepEqual([warnings(), creatorReads()], [[], []])
    })
  })

  describe('a new job', () => {
    it('is stamped qbs on itself when it was written without a tenant, and so are the documents that name it', async () => {
      const after = { id: 'QBS-007', address: '7 Main St', clientUids: [] }
      install({ jobs: { j7: after }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, after))
      assert.deepEqual(stub.written('jobs/'), [{ op: 'update', path: 'jobs/j7', data: { tenantId: 'qbs' } }])
      assert.deepEqual(stub.written('extras/'), [{ op: 'update', path: 'extras/x7', data: { tenantId: 'qbs', clientUids: [] } }])
    })

    it('treats an empty or non string tenant as no tenant', async () => {
      for (const tenantId of ['', null, 5]) {
        const after = { id: 'QBS-007', tenantId, clientUids: [] }
        restart({ jobs: { j7: after }, extras: {}, submits: {}, notifications: {} })
        await run(jobEvent('j7', null, after))
        assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs' }], JSON.stringify(tenantId))
      }
    })

    it('does not write to itself when it already has a tenant', async () => {
      const after = { id: 'QBS-008', tenantId: 'vision', clientUids: [] }
      install({ jobs: { j8: after }, extras: { x8: { job: 'QBS-008' } }, submits: {}, notifications: {} })
      await run(jobEvent('j8', null, after))
      assert.deepEqual(stub.written('jobs/'), [])
      assert.deepEqual(stub.written('extras/').map((write) => write.data), [{ tenantId: 'vision', clientUids: [] }])
    })

    it('gives itself the tenant inside a transaction, which reads the job first', async () => {
      const after = { id: 'QBS-007', clientUids: [] }
      install({ jobs: { j7: after }, extras: {}, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, after))
      assert.ok(stub.calls.includes('runTransaction'))
      assert.deepEqual(stub.reads, ['jobs/j7'])
      assert.deepEqual(stub.written('jobs/'), [{ op: 'update', path: 'jobs/j7', data: { tenantId: 'qbs' } }])
    })

    it('writes nothing to itself when the job is gone by the time the transaction reads it', async () => {
      const after = { id: 'QBS-007', clientUids: [] }
      install({ jobs: {}, extras: {}, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, after))
      assert.deepEqual(stub.reads, ['jobs/j7'])
      assert.deepEqual(stub.written('jobs/'), [])
    })

    it('does not overwrite a tenant that was set after the job was read, and the documents get that tenant', async () => {
      const read = { id: 'QBS-007', clientUids: [] } // as the event and the first read saw it
      const set = { ...read, tenantId: 'vision' } // as it is by the time the transaction looks
      install({ jobs: { j7: set }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, read, { now: (n) => (n === 1 ? read : set) }))
      assert.deepEqual(stub.written('jobs/'), [], 'the tenant that was set is not overwritten')
      assert.deepEqual(
        stub.written('extras/').map((write) => write.data.tenantId),
        ['qbs', 'vision'],
        'the second pass puts the tenant that was set on the documents',
      )
    })

    it('finds nothing to write when it runs again for its own write', async () => {
      const created = { id: 'QBS-007', clientUids: [] }
      const documents = { jobs: { j7: created }, extras: { x7: { job: 'QBS-007' } }, submits: { s7: { jobId: 'QBS-007' } }, notifications: {} }
      install(documents)
      await run(jobEvent('j7', null, created))
      const next = applied(documents, stub.writes)
      assert.equal(next.jobs.j7.tenantId, 'qbs')

      restart(next)
      await run(jobEvent('j7', created, next.jobs.j7))
      assert.deepEqual(stub.writes, [], 'the second run, for the write the first one made, writes nothing')
    })
  })

  describe('failures', () => {
    const created = { id: 'QBS-007', clientUids: [] }
    const installCreated = () => install({ jobs: { j7: created }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
    const errorLines = () => logged.filter(([level]) => level === 'error')

    it('still stamps the documents when the job cannot be given its tenant, and then fails the event', async () => {
      installCreated()
      breakTransactions({ update: new Error('update failed') })
      await assert.rejects(run(jobEvent('j7', null, created)), /update failed/)
      assert.equal(stub.written('extras/').length, 1)
      assert.deepEqual(stub.written('jobs/'), [])
    })

    it('still gives the job its tenant when the documents cannot be written, and then fails the event', async () => {
      installCreated()
      failCommits(1)
      await assert.rejects(run(jobEvent('j7', null, created)), /commit 1 failed/)
      assert.deepEqual(stub.written('jobs/').map((write) => write.data), [{ tenantId: 'qbs' }])
    })

    it('logs both halves when both fail, each with the job it was for, and fails the event with the first', async () => {
      installCreated()
      breakTransactions({ update: new Error('tenant write failed') })
      failCommits(1)
      await assert.rejects(run(jobEvent('j7', null, created)), /tenant write failed/)
      const tenant = errorLines().find(([, message, cause]) => /its tenant/.test(message) && cause?.message === 'tenant write failed')
      const documents = errorLines().find(([, message, cause]) => /its documents/.test(message) && cause?.message === 'commit 1 failed')
      assert.ok(tenant, 'the failed tenant write is logged')
      assert.ok(documents, 'the failed stamping of the documents is logged')
      for (const [, message] of [tenant, documents]) {
        assert.match(String(message), /jobs\/j7/)
        assertNoDashes(String(message))
      }
    })

    it('fails the event when a collection cannot be read, and writes nothing', async () => {
      install({ jobs: {}, ...dependents() })
      mock.method(db, 'collection', () => ({ where: () => ({ get: async () => { throw new Error('read failed') } }) }))
      await assert.rejects(run(jobEvent('j1', JOB, { ...JOB, tenantId: 'vision' })), /read failed/)
      assert.deepEqual(stub.writes, [])
    })

    it('fails the event when the job cannot be read again, and changes nothing', async () => {
      install({ jobs: {}, ...dependents() })
      const event = jobEvent('j1', JOB, { ...JOB, tenantId: 'vision' })
      event.data.after.ref.get = async () => { throw new Error('read failed') }
      await assert.rejects(run(event), /read failed/)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })
  })

  // A batch that fails (a document deleted between the read and the commit makes Firestore
  // refuse the whole batch) is lost, and the ones after it still go.
  describe('a batch that fails', () => {
    const before = { ...JOB, clientUids: [] }
    const after = { ...JOB, clientUids: ['c1'] }
    const installMany = (count) => install({ jobs: { j1: after }, extras: {}, submits: {}, notifications: many(count) })
    const batchLines = () => logged.filter(([level, message]) => level === 'error' && /could not be stamped/.test(message))

    it('does not stop the batches after it, and the event fails with its error once they are done', async () => {
      installMany(1003)
      failCommits(1)
      await assert.rejects(run(jobEvent('j1', before, after)), /commit 1 failed/)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 203], 'the second and third batches were committed')
      assert.equal(stub.writes.length, 603)
    })

    it('does not stop the batches before it either', async () => {
      installMany(1003)
      failCommits(3)
      await assert.rejects(run(jobEvent('j1', before, after)), /commit 3 failed/)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 400])
    })

    it('logs the job and the error of every batch that fails, and how many documents it held', async () => {
      installMany(1003)
      failCommits(1, 3)
      await assert.rejects(run(jobEvent('j1', before, after)), /commit 1 failed/)
      assert.equal(batchLines().length, 2)
      const [first, second] = batchLines()
      assert.match(first[1], /jobs\/j1/)
      assert.match(first[1], /400/)
      assert.equal(first[2].message, 'commit 1 failed')
      assert.match(second[1], /203/)
      assert.equal(second[2].message, 'commit 3 failed')
      for (const [, message] of batchLines()) assertNoDashes(String(message))
    })

    it('logs nothing about batches when they all commit', async () => {
      installMany(450)
      await run(jobEvent('j1', before, after))
      assert.equal(batchLines().length, 0)
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 50])
    })

    it('still does the second look at the job, so a newer scope is stamped even after a batch was lost', async () => {
      installMany(5)
      const newer = { ...JOB, clientUids: ['c1', 'c2'] }
      failCommits(1)
      const event = jobEvent('j1', before, after, { now: (n) => (n === 1 ? after : newer) })
      await assert.rejects(run(event), /commit 1 failed/)
      assert.equal(event.data.after.ref.rereads, 2)
      assert.ok(stub.writes.length > 0, 'the second pass went ahead')
      assert.ok(stub.writes.every((write) => write.data.clientUids.join() === 'c1,c2'))
    })
  })

  // The job can move again (a client linked, say) while its documents are being stamped,
  // and the event for that move may already have run and found them half done.
  describe('when the job moves while its documents are stamped', () => {
    const before = { ...JOB, clientUids: [] }
    const first = { ...JOB, clientUids: ['c1'] } // the scope the event is about
    const newer = { ...JOB, clientUids: ['c1', 'c2'] } // the scope it has moved to meanwhile
    const documents = () => ({
      jobs: { j1: newer },
      extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: [] } },
      submits: {},
      notifications: {},
    })
    const passes = () => stub.calls.filter((entry) => entry === 'collection:extras').length

    it('stamps the newer scope in a second pass', async () => {
      install(documents())
      const event = jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : newer) })
      await run(event)
      assert.deepEqual(stub.writes.map((write) => write.data.clientUids), [['c1'], ['c1', 'c2']], 'c1 first, then c1 and c2')
      assert.equal(passes(), 2)
      assert.equal(event.data.after.ref.rereads, 2)
    })

    it('stamps the second pass onto every document the newer scope does not match, one the first pass left alone included', async () => {
      install({
        jobs: { j1: newer },
        extras: { x1: { job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] }, x2: { job: 'QBS-001' } },
        submits: {},
        notifications: {},
      })
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : newer) }))
      assert.deepEqual(stub.writes.map((write) => [write.path, write.data.clientUids]), [
        ['extras/x2', ['c1']], // the first pass: x1 already carries c1, x2 carries nothing
        ['extras/x1', ['c1', 'c2']], // the second pass: neither carries c2
        ['extras/x2', ['c1', 'c2']],
      ])
    })

    it('does not stamp a second time when the job did not move', async () => {
      install(documents())
      const event = jobEvent('j1', before, first, { now: first })
      await run(event)
      assert.equal(passes(), 1)
      assert.equal(stub.writes.length, 1)
      assert.equal(event.data.after.ref.rereads, 2, 'it did look again')
    })

    it('does not count something else about the job changing as moving', async () => {
      install(documents())
      const edited = { ...first, address: '2 Main St', status: 'complete' }
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : edited) }))
      assert.equal(passes(), 1)
    })

    it('does not count the same clients in another order as moving', async () => {
      install(documents())
      const wide = { ...JOB, clientUids: ['c1', 'c2'] }
      await run(jobEvent('j1', before, wide, { now: (n) => (n === 1 ? wide : { ...JOB, clientUids: ['c2', 'c1'] }) }))
      assert.equal(passes(), 1)
    })

    it('does not count its own tenant being written as moving', async () => {
      const created = { id: 'QBS-007', clientUids: [] }
      install({ jobs: { j7: created }, extras: { x7: { job: 'QBS-007' } }, submits: {}, notifications: {} })
      await run(jobEvent('j7', null, created, { now: (n) => (n === 1 ? created : { ...created, tenantId: 'qbs' }) }))
      assert.equal(passes(), 1)
      assert.equal(stub.written('extras/').length, 1)
    })

    it('stamps once more at most, however often the job moves', async () => {
      install(documents())
      const moving = (n) => ({ ...JOB, clientUids: Array.from({ length: n }, (_, i) => `c${i}`) })
      const event = jobEvent('j1', before, first, { now: moving })
      await run(event)
      assert.equal(passes(), 2)
      assert.equal(event.data.after.ref.rereads, 2, 'it does not look a third time')
      assert.deepEqual(stub.writes.at(-1).data.clientUids, ['c0', 'c1'])
    })

    it('does not stamp again when the job is gone by then', async () => {
      install(documents())
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : null) }))
      assert.equal(passes(), 1)
    })

    it('does not stamp again when the job has lost its id, which would leave nothing to find its documents by', async () => {
      install(documents())
      await run(jobEvent('j1', before, first, { now: (n) => (n === 1 ? first : { tenantId: 'vision', clientUids: [] }) }))
      assert.equal(passes(), 1)
      assert.deepEqual(warnings(), [])
    })

    it('fails the event, after the first pass, when the job cannot be read the second time', async () => {
      install(documents())
      const event = jobEvent('j1', before, first)
      const read = event.data.after.ref.get
      let reads = 0
      event.data.after.ref.get = async () => {
        reads += 1
        if (reads === 2) throw new Error('second read failed')
        return read()
      }
      await assert.rejects(run(event), /second read failed/)
      assert.equal(stub.writes.length, 1, 'the first pass was done')
    })
  })

  describe('many documents', () => {
    it('splits them into batches of at most 400, so none gets near the 500 writes Firestore allows', async () => {
      const after = { ...JOB, clientUids: ['c1'] }
      install({ jobs: { j1: after }, extras: {}, submits: {}, notifications: many(1003) })
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, after))
      assert.deepEqual(stub.batches.map((group) => group.length), [400, 400, 203])
      assert.equal(stub.writes.length, 1003)
    })

    it('stamps the documents of all three collections together in the same batches', async () => {
      const after = { ...JOB, clientUids: ['c1'] }
      install({ jobs: { j1: after }, extras: { x1: { job: 'QBS-001' } }, submits: { s1: { jobId: 'QBS-001' } }, notifications: many(5) })
      await run(jobEvent('j1', { ...JOB, clientUids: [] }, after))
      assert.deepEqual(stub.batches.map((group) => group.length), [7])
    })
  })

  describe('no trigger fires itself', () => {
    it('leaves every document it stamped with nothing for onExtraWritten and onSubmitWritten to do', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      const documents = { jobs: { j1: after }, ...dependents() }
      install(documents)
      await run(jobEvent('j1', JOB, after))
      assert.ok(stub.writes.length > 0)
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

    it('runs to the end when it runs again after its own writes', async () => {
      const after = { ...JOB, tenantId: 'vision' }
      const documents = { jobs: { j1: after }, ...dependents() }
      install(documents)
      await run(jobEvent('j1', JOB, after))
      const next = applied(documents, stub.writes)
      restart(next)
      await run(jobEvent('j1', JOB, after))
      assert.deepEqual(stub.writes, [], 'a second pass over documents that were just stamped writes nothing')
    })
  })
})

// A draft change order has not been sent, so only staff may see it. The job fan out leaves
// it as it is (its own trigger and the backfill deal with a scope it carries).
describe('a draft change order', () => {
  const { JOB3, draft } = DRAFT_SCENARIO

  it('is left out of the job fan out, while the change orders that were sent get the new scope', async () => {
    const after = { ...JOB3, tenantId: 'vision' }
    install({
      jobs: { j3: after },
      extras: { d1: draft(), d2: draft({ tenantId: 'qbs', clientUids: ['c1'] }), s1: draft({ status: 'Sent to Builder' }) },
      submits: {},
      notifications: {},
    })
    await onJobWritten.run(jobEvent('j3', JOB3, after))
    assert.deepEqual(stub.written('extras/').map((write) => [write.path, write.data]), [['extras/s1', { tenantId: 'vision', clientUids: ['c1'] }]])
  })
})

// A builder in qbs names a job of vision. Their submission must stay in qbs when the
// vision job gains a client.
describe('a submission a qbs builder planted on a vision job', () => {
  const { VISION, planted, users } = PLANTED_SCENARIO

  it('stays in qbs when the vision job gains a client', async () => {
    const after = { ...VISION, clientUids: ['c9', 'c10'] }
    install({ users, jobs: { j9: after }, extras: {}, submits: { s1: planted }, notifications: {} })
    await onJobWritten.run(jobEvent('j9', VISION, after))
    assert.ok(!stub.writes.some((write) => write.path === 'submits/s1'))
  })
})

// A submission a builder created can carry clients from a time its job was in the
// builder's tenant. Once the job moves it is left in its tenant and its clientUids are
// emptied, once, even when a second pass runs.
describe('a builder submission left in its tenant with clients on it', () => {
  const { VISION, users, pinned, EMPTIED } = PINNED_SCENARIO
  const keptLines = () => warnings().filter((line) => line.includes('submits/s1 '))

  it('has its clientUids emptied once by the job fan out, even when the job moves and a second pass runs', async () => {
    const before = { ...VISION, clientUids: [] }
    const newer = { ...VISION, clientUids: ['c9', 'c10'] }
    const documents = { users, jobs: { j9: newer }, extras: {}, submits: { s1: pinned() }, notifications: {} }
    install(documents)
    await onJobWritten.run(jobEvent('j9', before, VISION, { now: (n) => (n === 1 ? VISION : newer) }))
    assert.deepEqual(stub.written('submits/'), [{ op: 'update', path: 'submits/s1', data: EMPTIED }])
    assert.equal(keptLines().length, 1)

    const next = applied(documents, stub.writes)
    restart(next)
    await onJobWritten.run(jobEvent('j9', VISION, newer))
    assert.deepEqual(stub.written('submits/'), [], 'a later change to the job finds nothing to write')
  })
})
