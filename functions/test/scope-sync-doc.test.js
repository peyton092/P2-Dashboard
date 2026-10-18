import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FieldValue } from 'firebase-admin/firestore'
import { onExtraWritten, onSubmitWritten } from '../scope-sync.js'
import { assertNoDashes } from './helpers/firestore-stub.js'
import {
  DRAFT_SCENARIO, PINNED_SCENARIO, PLANTED_SCENARIO, applied, breakTransactions, documentEvent, install, noEvent,
  reset, resetBetweenTests, restart, stub, warnings,
} from './helpers/scope-sync-harness.js'

// onExtraWritten and onSubmitWritten: one document stamped from its job, in one transaction.
// The stubs and the spies are in helpers/scope-sync-harness.js.

resetBetweenTests()

// onExtraWritten and onSubmitWritten stamp one document from its job. They differ
// only in the collection and in the field the document names its job in.
for (const [name, trigger, collection, field] of [
  ['onExtraWritten', onExtraWritten, 'extras', 'job'],
  ['onSubmitWritten', onSubmitWritten, 'submits', 'jobId'],
]) {
  describe(name, () => {
    const JOB3 = { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1', 'c2'] }
    const OTHER = { id: 'QBS-004', tenantId: 'vision', clientUids: ['c9'] }
    const SCOPE = { tenantId: 'qbs', clientUids: ['c1', 'c2'] }
    const unstamped = (over = {}) => ({ subject: 'Panel', [field]: 'QBS-003', ...over })
    const stamped = (over = {}) => unstamped({ ...SCOPE, ...over })
    const run = (doc, { before = null, others = {} } = {}) => {
      install({ jobs: { j3: JOB3, j4: OTHER }, [collection]: { d1: doc, ...others } })
      return trigger.run(documentEvent(collection, 'd1', doc, before))
    }

    it('stamps the tenantId and clientUids of its job onto a document that has neither', async () => {
      await run(unstamped())
      assert.deepEqual(stub.writes, [{ op: 'update', path: `${collection}/d1`, data: SCOPE }])
    })

    it('stamps exactly those two fields and nothing else of the document', async () => {
      await run(unstamped({ status: 'Open', amount: 4100 }))
      assert.deepEqual(Object.keys(stub.writes[0].data).sort(), ['clientUids', 'tenantId'])
    })

    it('stamps the job with that id, and not another', async () => {
      await run(unstamped({ [field]: 'QBS-004' }))
      assert.deepEqual(stub.writes[0].data, { tenantId: 'vision', clientUids: ['c9'] })
    })

    it('stamps a document that has only one of the two fields', async () => {
      await run(unstamped({ tenantId: 'qbs' }))
      assert.equal(stub.writes.length, 1)
      reset()
      await run(unstamped({ clientUids: ['c1', 'c2'] }))
      assert.equal(stub.writes.length, 1)
    })

    it('stamps again a document that carries another job scope', async () => {
      await run(stamped({ tenantId: 'vision' }))
      assert.deepEqual(stub.writes[0].data, SCOPE)
      reset()
      await run(stamped({ clientUids: ['c1'] }))
      assert.deepEqual(stub.writes[0].data, SCOPE)
    })

    it('stamps a document whose tenant is empty or not text, as one with no tenant', async () => {
      for (const tenantId of ['', 7]) {
        reset()
        await run(unstamped({ tenantId }))
        assert.deepEqual(stub.writes, [{ op: 'update', path: `${collection}/d1`, data: SCOPE }], String(tenantId))
      }
    })

    it('writes nothing for a document that already carries the scope of its job', async () => {
      await run(stamped())
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`, 'query:jobs:id==QBS-003'], 'it did look, document first')
    })

    it('does not treat the same clients in another order as a difference', async () => {
      await run(stamped({ clientUids: ['c2', 'c1'] }))
      assert.deepEqual(stub.writes, [])
    })

    it('stamps the legacy default tenant when its job has none', async () => {
      install({ jobs: { j3: { id: 'QBS-003' } }, [collection]: { d1: unstamped() } })
      await trigger.run(documentEvent(collection, 'd1', unstamped()))
      assert.deepEqual(stub.writes[0].data, { tenantId: 'qbs', clientUids: [] })
    })

    it('logs, and leaves the document alone, when its job cannot be found', async () => {
      await run(unstamped({ [field]: 'QBS-404' }))
      assert.deepEqual(stub.writes, [])
      assert.equal(warnings().length, 1)
      assert.match(warnings()[0], new RegExp(`${collection}/d1`))
      assert.match(warnings()[0], /QBS-404/)
      assertNoDashes(warnings()[0].replace('QBS-404', 'ID'))
    })

    it('writes nothing for a deleted document, and does not even open a transaction', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: {} })
      await trigger.run(documentEvent(collection, 'd1', null, unstamped()))
      assert.deepEqual([stub.calls, stub.writes], [[], []])
    })

    for (const none of [undefined, null, '', 7]) {
      it(`leaves a document alone that names no job (${JSON.stringify(none)}), reading nothing`, async () => {
        const doc = { subject: 'Staff note', [field]: none }
        install({ jobs: { j3: JOB3 }, [collection]: { d1: doc } })
        await trigger.run(documentEvent(collection, 'd1', doc))
        assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []])
      })
    }

    it('writes nothing when the document is gone by the time the transaction reads it', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: {} })
      await trigger.run(documentEvent(collection, 'd1', unstamped()))
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`])
    })

    it('uses the document as it is now: one stamped since the event writes nothing', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: stamped() } })
      await trigger.run(documentEvent(collection, 'd1', unstamped()))
      assert.deepEqual(stub.writes, [])
    })

    it('does nothing, and warns, when the event carries no data', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: {} })
      await trigger.run(noEvent)
      assert.deepEqual([stub.calls, stub.writes], [[], []])
      assert.equal(warnings().length, 1)
    })

    it('reads before it writes, as Firestore requires, in one transaction', async () => {
      await run(unstamped())
      assert.deepEqual(stub.calls.filter((entry) => entry === 'runTransaction'), ['runTransaction'])
      assert.equal(stub.reads.length, 2)
    })

    it('does not fire itself: the document it stamped needs nothing more', async () => {
      const doc = unstamped()
      await run(doc)
      const next = applied({ jobs: { j3: JOB3, j4: OTHER }, [collection]: { d1: doc } }, stub.writes)
      restart(next)
      await trigger.run(documentEvent(collection, 'd1', next[collection].d1, doc))
      assert.deepEqual(stub.writes, [])
    })

    it('fails the event, and writes nothing, when the job lookup inside the transaction fails', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: unstamped() } })
      breakTransactions({ query: new Error('read failed') })
      await assert.rejects(trigger.run(documentEvent(collection, 'd1', unstamped())), /read failed/)
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`], 'the document was read first, and the lookup of its job is what failed')
    })

    it('fails the event, having read both, when the write inside the transaction fails', async () => {
      install({ jobs: { j3: JOB3 }, [collection]: { d1: unstamped() } })
      breakTransactions({ update: new Error('write failed') })
      await assert.rejects(trigger.run(documentEvent(collection, 'd1', unstamped())), /write failed/)
      assert.deepEqual(stub.writes, [])
      assert.deepEqual(stub.reads, [`${collection}/d1`, 'query:jobs:id==QBS-003'])
    })
  })
}

// A change order is written by staff, who may point it at any job, so it always takes
// its job's scope. A submission a builder created stays in the builder's tenant when it
// names a job of another one; every other submission follows its job.
describe('onExtraWritten, onSubmitWritten and a document in another tenant', () => {
  const JOB3 = { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c1', 'c2'] }
  const SCOPE = { tenantId: 'qbs', clientUids: ['c1', 'c2'] }
  const people = {
    b1: { role: 'builder', tenantId: 'vision' },
    c1: { role: 'client', clientJobIds: ['QBS-003'] },
    s9: { role: 'internal' },
    o1: { role: 'owner' },
  }
  const submitted = (over) => ({ subject: 'Panel', jobId: 'QBS-003', tenantId: 'vision', clientUids: [], ...over })
  const runSubmit = (doc, job = JOB3) => {
    install({ users: people, jobs: { j3: job }, submits: { d1: doc } })
    return onSubmitWritten.run(documentEvent('submits', 'd1', doc))
  }

  it('onExtraWritten moves a change order to the tenant of its job', async () => {
    const doc = { desc: 'Panel', job: 'QBS-003', tenantId: 'vision', clientUids: ['c9'] }
    install({ jobs: { j3: JOB3 }, extras: { d1: doc } })
    await onExtraWritten.run(documentEvent('extras', 'd1', doc))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'extras/d1', data: SCOPE }])
    assert.deepEqual(warnings(), [])
  })

  it('onSubmitWritten leaves a builder submission in its tenant, writing nothing, not even its clients', async () => {
    await runSubmit(submitted({ createdBy: 'b1' }))
    assert.deepEqual(stub.writes, [])
    assert.deepEqual(
      stub.reads,
      ['submits/d1', 'query:jobs:id==QBS-003', 'users/b1'],
      'the creator is read once, after the submission and its job, in the same transaction',
    )
  })

  it('onSubmitWritten warns once, naming the submission, the tenant it carries and its job tenant', async () => {
    await runSubmit(submitted({ createdBy: 'b1' }))
    assert.equal(warnings().length, 1)
    const [warning] = warnings()
    assert.match(warning, /submits\/d1/)
    assert.match(warning, /tenant vision/)
    assert.match(warning, /tenant qbs/)
    assertNoDashes(warning.replace('QBS-003', 'ID'))
  })

  it('onSubmitWritten restamps a submission a client or staff created in a stale tenant', async () => {
    for (const createdBy of ['c1', 's9', 'o1']) {
      reset()
      await runSubmit(submitted({ createdBy }))
      assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: SCOPE }], createdBy)
      assert.deepEqual(warnings(), [], createdBy)
    }
  })

  it('onSubmitWritten restamps a submission whose creator has no users document, or that names no creator', async () => {
    await runSubmit(submitted({ createdBy: 'ghost' }))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: SCOPE }])
    reset()
    await runSubmit(submitted())
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: SCOPE }])
    assert.deepEqual(stub.reads, ['submits/d1', 'query:jobs:id==QBS-003'], 'no creator to look up')
  })

  it('onSubmitWritten gives a builder submission of its job tenant the clients of its job, without reading the creator', async () => {
    await runSubmit(submitted({ createdBy: 'b1', tenantId: 'qbs' }))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: SCOPE }])
    assert.deepEqual(stub.reads, ['submits/d1', 'query:jobs:id==QBS-003'])
  })

  it('onSubmitWritten compares a builder submission with the legacy default for a job with no tenant', async () => {
    await runSubmit(submitted({ createdBy: 'b1' }), { id: 'QBS-003' })
    assert.deepEqual(stub.writes, [])
    assert.equal(warnings().length, 1)
    reset()
    await runSubmit(submitted({ createdBy: 'b1', tenantId: 'qbs', clientUids: ['stale'] }), { id: 'QBS-003' })
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: { tenantId: 'qbs', clientUids: [] } }])
  })
})

// A draft change order has not been sent, so only staff may see it: it carries no
// scope, and none of the three paths gives it one. A draft that does carry one (it was
// stamped before this rule, say) has both fields deleted by its own trigger, which is the
// only write it gets, so the run that write fires finds an unscoped draft and returns.
// sendExtraToBuilder stamps it from its job as it sends it (extras-handlers.test.js), and
// from then on it is stamped like any other change order.
describe('a draft change order', () => {
  const { JOB3, SCOPE, draft } = DRAFT_SCENARIO
  const isDelete = (value) => value?.isEqual?.(FieldValue.delete()) === true
  // What a draft carries when it has a scope: another job's, its own job's, or part of one.
  const CARRIED = [
    { tenantId: 'vision', clientUids: ['c9'] },
    { tenantId: 'qbs', clientUids: ['c1'] },
    { tenantId: 'qbs' },
    { clientUids: ['c1'] },
    { clientUids: [] },
    { tenantId: null, clientUids: null },
  ]

  it('gets no write from onExtraWritten when it carries no scope', async () => {
    const doc = draft()
    install({ jobs: { j3: JOB3 }, extras: { d1: doc } })
    await onExtraWritten.run(documentEvent('extras', 'd1', doc))
    assert.deepEqual(stub.writes, [])
    assert.deepEqual(warnings(), [])
  })

  it('has the scope it carries deleted by onExtraWritten, in one update that writes nothing else', async () => {
    for (const carried of CARRIED) {
      const doc = draft(carried)
      restart({ jobs: { j3: JOB3 }, extras: { d1: doc } })
      await onExtraWritten.run(documentEvent('extras', 'd1', doc))
      assert.equal(stub.writes.length, 1, JSON.stringify(carried))
      const [write] = stub.writes
      assert.deepEqual([write.op, write.path], ['update', 'extras/d1'])
      assert.deepEqual(Object.keys(write.data).sort(), ['clientUids', 'tenantId'], JSON.stringify(carried))
      assert.ok(isDelete(write.data.tenantId) && isDelete(write.data.clientUids), `both fields are deleted: ${JSON.stringify(carried)}`)
      assert.deepEqual(warnings(), [])
    }
  })

  it('deletes the scope in the transaction that reads the draft, without working one out from its job', async () => {
    const doc = draft({ tenantId: 'vision', clientUids: ['c9'] })
    install({ jobs: { j3: JOB3 }, extras: { d1: doc } })
    await onExtraWritten.run(documentEvent('extras', 'd1', doc))
    assert.deepEqual(stub.calls.filter((entry) => entry === 'runTransaction'), ['runTransaction'])
    assert.deepEqual(stub.reads, ['extras/d1'], 'only the draft is read')
  })

  it('does not fire itself: the draft left without a scope needs nothing more', async () => {
    const before = draft({ tenantId: 'vision', clientUids: ['c9'] })
    install({ jobs: { j3: JOB3 }, extras: { d1: before } })
    await onExtraWritten.run(documentEvent('extras', 'd1', before))
    assert.equal(stub.writes.length, 1)

    // The stub never changes a document, so the draft as the next run finds it is written out here.
    const after = draft()
    restart({ jobs: { j3: JOB3 }, extras: { d1: after } })
    await onExtraWritten.run(documentEvent('extras', 'd1', after, before))
    assert.deepEqual(stub.writes, [], 'the write it made fires the trigger again, and that run writes nothing')
  })

  it('has the scope deleted from a draft that names no job, or a job that does not exist, and logs nothing', async () => {
    for (const named of [{ job: undefined }, { job: '' }, { job: 'QBS-404' }]) {
      const doc = draft({ ...named, tenantId: 'qbs', clientUids: ['c1'] })
      restart({ jobs: { j3: JOB3 }, extras: { d1: doc } })
      await onExtraWritten.run(documentEvent('extras', 'd1', doc))
      assert.deepEqual(stub.writes.map((write) => [write.op, write.path]), [['update', 'extras/d1']], JSON.stringify(named))
      assert.deepEqual(warnings(), [], 'a draft is never stamped, so a missing job is not worth a line in the log')
    }
  })

  it('is left alone, and nothing is read, when it names no job and carries no scope', async () => {
    for (const named of [{ job: undefined }, { job: '' }, { job: null }]) {
      const doc = draft(named)
      restart({ jobs: { j3: JOB3 }, extras: { d1: doc } })
      await onExtraWritten.run(documentEvent('extras', 'd1', doc))
      assert.deepEqual([stub.calls, stub.reads, stub.writes], [[], [], []], JSON.stringify(named))
    }
  })

  it('gets no write from onExtraWritten when it is a draft by the time the transaction reads it', async () => {
    const sent = draft({ status: 'Sent to Builder' })
    install({ jobs: { j3: JOB3 }, extras: { d1: draft() } })
    await onExtraWritten.run(documentEvent('extras', 'd1', sent))
    assert.deepEqual(stub.writes, [])
  })

  it('gets no write when its scope is already gone by the time the transaction reads it', async () => {
    install({ jobs: { j3: JOB3 }, extras: { d1: draft() } })
    await onExtraWritten.run(documentEvent('extras', 'd1', draft({ tenantId: 'vision', clientUids: ['c9'] })))
    assert.deepEqual(stub.writes, [])
  })

  it('keeps the scope it carries when it has been sent by the time the transaction reads it', async () => {
    install({ jobs: { j3: JOB3 }, extras: { d1: draft({ status: 'Sent to Builder', ...SCOPE }) } })
    await onExtraWritten.run(documentEvent('extras', 'd1', draft(SCOPE)))
    assert.deepEqual(stub.writes, [])
  })

  it('is stamped by onExtraWritten once it has been sent, whatever its status says', async () => {
    for (const status of ['Sent to Builder', 'pending', 'Rejected', undefined]) {
      const sent = draft({ status })
      restart({ jobs: { j3: JOB3 }, extras: { d1: sent } })
      await onExtraWritten.run(documentEvent('extras', 'd1', sent))
      assert.deepEqual(stub.writes, [{ op: 'update', path: 'extras/d1', data: SCOPE }], String(status))
    }
  })

  it('has no scope deleted from a change order that is not a draft, whatever its status says', async () => {
    for (const status of ['Sent to Builder', 'pending', 'Rejected', 'rejected', 'Approved', 'approved', undefined]) {
      const sent = draft({ status, ...SCOPE })
      restart({ jobs: { j3: JOB3 }, extras: { d1: sent } })
      await onExtraWritten.run(documentEvent('extras', 'd1', sent))
      assert.deepEqual(stub.writes, [], String(status))
    }
  })

  it('is a rule for change orders only: a submission whose status says Draft is stamped like any other', async () => {
    const doc = { subject: 'Panel', jobId: 'QBS-003', status: 'Draft', tenantId: 'vision', clientUids: ['c9'] }
    install({ jobs: { j3: JOB3 }, submits: { d1: doc } })
    await onSubmitWritten.run(documentEvent('submits', 'd1', doc))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/d1', data: SCOPE }])
  })
})

// A builder in qbs names a job of vision. Their submission must stay in qbs whichever
// path looks at it: its own trigger is this one.
describe('a submission a qbs builder planted on a vision job', () => {
  const { VISION, planted, users } = PLANTED_SCENARIO

  it('stays in qbs through its own trigger', async () => {
    install({ users, jobs: { j9: VISION }, submits: { s1: planted } })
    await onSubmitWritten.run(documentEvent('submits', 's1', planted))
    assert.deepEqual(stub.writes, [])
  })
})

// A submission a builder created can carry clients from a time its job was in the
// builder's tenant: it followed the job then, and is left in its tenant once the job
// moves. A builder creates a submission with no clients, so a submission that stays in
// its tenant has its clientUids emptied, once, and that is the only write it gets.
describe('a builder submission left in its tenant with clients on it', () => {
  const { VISION, users, pinned, EMPTIED } = PINNED_SCENARIO
  const keptLines = () => warnings().filter((line) => line.includes('submits/s1 '))

  it('has its clientUids emptied by its own trigger, and nothing else written', async () => {
    const documents = { users, jobs: { j9: VISION }, submits: { s1: pinned() } }
    install(documents)
    await onSubmitWritten.run(documentEvent('submits', 's1', pinned()))
    assert.deepEqual(stub.writes, [{ op: 'update', path: 'submits/s1', data: EMPTIED }])
    assert.equal(keptLines().length, 1)
    assert.match(keptLines()[0], /its clientUids emptied/)
    assertNoDashes(keptLines()[0].replace('VIS-009', 'ID'))

    // The write fires the trigger again, and this time there is nothing to write.
    const next = applied(documents, stub.writes)
    restart(next)
    await onSubmitWritten.run(documentEvent('submits', 's1', next.submits.s1, pinned()))
    assert.deepEqual(stub.writes, [])
  })

  it('is written nothing when it carries no clients, or no clientUids at all', async () => {
    for (const doc of [pinned({ clientUids: [] }), pinned({ clientUids: undefined })]) {
      restart({ users, jobs: { j9: VISION }, submits: { s1: doc } })
      await onSubmitWritten.run(documentEvent('submits', 's1', doc))
      assert.deepEqual(stub.writes, [], JSON.stringify(doc))
      assert.match(keptLines()[0], /left as it is/)
    }
  })
})
