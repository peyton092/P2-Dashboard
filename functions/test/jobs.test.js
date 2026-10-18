import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JOB_ID, MAX_DEPTH, TENANTS, jobActivity, validateNewJob } from '../lib/jobs.js'

const IDS = /[A-Z]+(-\d+)+/g
const assertNoDashes = (text) => {
  assert.doesNotMatch(text.replace(IDS, 'ID'), /[-‐-―−]/, `dash in: ${text}`)
}

// The payload the New Job form sends (src/App.jsx handleCreateJob).
const form = () => ({
  id: 'QBS-045',
  address: '123 Main St',
  city: 'Brentwood, TN 37027',
  client: 'Dana Lee',
  type: 'Full MEP Renovation',
  pm: 'Blake Neblett',
  status: 'active',
  progress: 0,
  extras: 0,
  tenantId: 'qbs',
  lead: '',
  start: '2026-10-18',
  target: '2027-03-01',
  county: '',
  billingStatus: 'not-invoiced',
  permitNumber: '2026012345',
  subs: { electrical: 'Volt Co', plumbing: null, hvac: null },
  permits: { electrical: 'pending', plumbing: 'pending', hvac: 'pending' },
  insp: {
    electrical: { roughIn: 'pending', trim: 'blocked', final: 'blocked' },
    plumbing: { roughIn: 'pending', final: 'blocked' },
    hvac: { roughIn: 'pending', final: 'blocked' },
  },
})

const message = (input) => {
  const checked = validateNewJob(input)
  assert.equal(checked.ok, false, 'expected the job to be refused')
  return checked.message
}

describe('constants', () => {
  it('names the three tenants and the job id shape', () => {
    assert.deepEqual([...TENANTS], ['p2-core', 'qbs', 'vision'])
    assert.ok(Object.isFrozen(TENANTS))
    assert.equal(JOB_ID.source, '^[A-Z]+-\\d{3}$')
    assert.equal(MAX_DEPTH, 3)
  })
})

describe('validateNewJob required fields', () => {
  it('accepts what the New Job form sends and returns every field of it', () => {
    const checked = validateNewJob(form())
    assert.equal(checked.ok, true)
    const { id, tenantId, fields } = checked.value
    assert.equal(id, 'QBS-045')
    assert.equal(tenantId, 'qbs')
    const expected = form()
    delete expected.id
    delete expected.tenantId
    assert.deepEqual(fields, expected)
  })

  it('needs a job id like QBS-001', () => {
    for (const id of ['qbs-045', 'QBS-45', 'QBS-0456', 'QBS045', 'QBS-04a', ' QBS-045', 'QBS-045 ', '-045', '045', '', undefined, null, 45, ['QBS-045']]) {
      assert.equal(message({ ...form(), id }), 'Job ID must look like QBS-001.', JSON.stringify(id))
    }
    for (const id of ['QBS-001', 'VIS-999', 'ABCDEF-123', 'P-100']) {
      assert.equal(validateNewJob({ ...form(), id }).ok, true, id)
    }
  })

  it('needs an address and a client, as non blank text', () => {
    for (const bad of ['', '   ', undefined, null, 5, {}, ['x']]) {
      assert.equal(message({ ...form(), address: bad }), 'Enter the street address.', JSON.stringify(bad))
      assert.equal(message({ ...form(), client: bad }), 'Enter the client name.', JSON.stringify(bad))
    }
  })

  it('stores the address and the client trimmed', () => {
    const { fields } = validateNewJob({ ...form(), address: '  123 Main St ', client: ' Dana Lee  ' }).value
    assert.equal(fields.address, '123 Main St')
    assert.equal(fields.client, 'Dana Lee')
  })

  it('needs one of the three tenants', () => {
    for (const tenantId of ['p2-core', 'qbs', 'vision']) {
      assert.equal(validateNewJob({ ...form(), tenantId }).value.tenantId, tenantId)
    }
    for (const tenantId of ['QBS', 'builder', '', undefined, null, 5, ['qbs'], 'constructor']) {
      assert.equal(message({ ...form(), tenantId }), 'Choose a tenant.', JSON.stringify(tenantId))
    }
  })

  it('checks the id, then the address, then the client, then the tenant', () => {
    const blank = { id: '', address: '', client: '', tenantId: '' }
    assert.equal(message(blank), 'Job ID must look like QBS-001.')
    assert.equal(message({ ...blank, id: 'QBS-001' }), 'Enter the street address.')
    assert.equal(message({ ...blank, id: 'QBS-001', address: 'a' }), 'Enter the client name.')
    assert.equal(message({ ...blank, id: 'QBS-001', address: 'a', client: 'c' }), 'Choose a tenant.')
  })

  it('refuses data that is not an object', () => {
    for (const bad of [undefined, null, 'QBS-001', 5, []]) {
      assert.equal(message(bad), 'Job ID must look like QBS-001.')
    }
  })

  it('does not need a name, and keeps one only when it is text', () => {
    assert.equal('name' in validateNewJob(form()).value.fields, false)
    assert.equal(validateNewJob({ ...form(), name: ' Lee Residence ' }).value.fields.name, 'Lee Residence')
    for (const bad of ['', '   ', 5, null, {}, ['x']]) {
      assert.equal('name' in validateNewJob({ ...form(), name: bad }).value.fields, false, JSON.stringify(bad))
    }
  })
})

describe('validateNewJob other fields', () => {
  const fieldsOf = (extra) => validateNewJob({ ...form(), ...extra }).value.fields

  it('copies any other field through when it is text, a number, a yes or no, or null', () => {
    const fields = fieldsOf({ qbsPM: 'Taylor Hensley', phase: 'rough-in', progress: 35.5, hold: true, note: null })
    assert.equal(fields.qbsPM, 'Taylor Hensley')
    assert.equal(fields.phase, 'rough-in')
    assert.equal(fields.progress, 35.5)
    assert.equal(fields.hold, true)
    assert.equal(fields.note, null)
  })

  it('keeps nested objects of those, up to three levels deep', () => {
    const fields = fieldsOf({ a: { b: { c: 'kept' } } })
    assert.deepEqual(fields.a, { b: { c: 'kept' } })
  })

  it('drops anything nested more than three levels deep', () => {
    const fields = fieldsOf({ a: { b: { c: { d: 'dropped' } } }, deep: { one: { two: { three: { four: 1 } } } } })
    assert.deepEqual(fields.a, { b: { c: {} } })
    assert.deepEqual(fields.deep, { one: { two: {} } })
  })

  it('drops functions, undefined, symbols, big integers and numbers that are not finite', () => {
    const fields = fieldsOf({
      fn: () => 1,
      nothing: undefined,
      sym: Symbol('x'),
      big: 10n,
      nan: Number.NaN,
      far: Number.POSITIVE_INFINITY,
      inner: { fn() {}, ok: 'yes', nan: Number.NaN },
    })
    for (const key of ['fn', 'nothing', 'sym', 'big', 'nan', 'far']) assert.equal(key in fields, false, key)
    assert.deepEqual(fields.inner, { ok: 'yes' })
  })

  it('keeps an array of text, numbers and yes or no, and drops an array holding anything else', () => {
    const fields = fieldsOf({
      tags: ['a', 'b'],
      counts: [1, 2.5],
      flags: [true, false, null],
      objects: [{ a: 1 }],
      mixed: ['a', { b: 2 }],
      nested: [['a']],
      withFn: ['a', () => 1],
      bad: [Number.NaN],
    })
    assert.deepEqual(fields.tags, ['a', 'b'])
    assert.deepEqual(fields.counts, [1, 2.5])
    assert.deepEqual(fields.flags, [true, false, null])
    for (const key of ['objects', 'mixed', 'nested', 'withFn', 'bad']) assert.equal(key in fields, false, key)
  })

  it('drops objects that are not plain ones', () => {
    class Thing { constructor() { this.x = 1 } }
    const fields = fieldsOf({ when: new Date(), map: new Map([['a', 1]]), thing: new Thing(), set: new Set(['a']) })
    for (const key of ['when', 'map', 'thing', 'set']) assert.equal(key in fields, false, key)
  })

  it('drops keys that are not plain names', () => {
    const bad = ['a.b', 'a b', '', '1st', '__name__', '_x', 'a-b', 'x'.repeat(65)]
    const fields = fieldsOf({ ...Object.fromEntries(bad.map((key) => [key, 1])), fine_1: 1, [`y${'x'.repeat(63)}`]: 2 })
    for (const key of bad) assert.equal(Object.hasOwn(fields, key), false, JSON.stringify(key))
    assert.equal(fields.fine_1, 1)
    assert.equal(fields[`y${'x'.repeat(63)}`], 2, 'a 64 character name is allowed')
    const inner = fieldsOf({ obj: Object.fromEntries([...bad.map((key) => [key, 1]), ['ok', 2]]) }).obj
    assert.deepEqual(inner, { ok: 2 })
  })

  it('cannot be used to pollute prototypes', () => {
    const payload = JSON.parse(`{"id":"QBS-045","address":"a","client":"c","tenantId":"qbs","__proto__":{"polluted":true},"constructor":{"x":1},"nest":{"__proto__":{"polluted2":true}}}`)
    const { fields } = validateNewJob(payload).value
    assert.equal({}.polluted, undefined)
    assert.equal({}.polluted2, undefined)
    assert.equal(Object.getPrototypeOf(fields), Object.prototype)
    assert.equal('polluted' in fields, false)
    assert.equal(Object.hasOwn(fields, '__proto__'), false)
    assert.equal(Object.getPrototypeOf(fields.nest), Object.prototype)
    assert.equal('polluted2' in fields.nest, false)
  })

  it('never lets the caller set the fields the server owns', () => {
    const fields = fieldsOf({
      clientUids: ['someone'],
      createdBy: 'someone',
      createdByEmail: 'someone@x.co',
      createdAt: '2020-01-01',
      id: 'QBS-999',
      tenantId: 'vision',
    })
    for (const key of ['clientUids', 'createdBy', 'createdByEmail', 'createdAt', 'id', 'tenantId']) {
      assert.equal(key in fields, false, key)
    }
  })

  it('does not change the data it was given', () => {
    const input = form()
    const copy = structuredClone(input)
    validateNewJob(input)
    assert.deepEqual(input, copy)
  })

  it('returns copies, so editing the result leaves the data it was given alone', () => {
    const input = form()
    const { fields } = validateNewJob(input).value
    fields.insp.electrical.roughIn = 'passed'
    fields.subs.electrical = 'Changed'
    assert.equal(input.insp.electrical.roughIn, 'pending')
    assert.equal(input.subs.electrical, 'Volt Co')
  })
})

describe('jobActivity', () => {
  const actor = { uid: 'u1', email: 'blake@p2.example', displayName: 'Blake Neblett' }

  it('words a new job as an info notification and a history line', () => {
    assert.deepEqual(jobActivity({ id: 'QBS-014', address: '123 Main St' }, actor), {
      type: 'info',
      action: 'created',
      msg: 'QBS-014 created by Blake Neblett',
      summary: 'QBS-014 created: 123 Main St',
    })
  })

  it('writes no dashes in the wording', () => {
    const { msg, summary } = jobActivity({ id: 'QBS-014', address: '123 Main St' }, actor)
    assertNoDashes(msg)
    assertNoDashes(summary)
  })
})
