import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDemoSession } from '../demoSession'
import { DEMO_USERS } from '../users'
import { initializeApp } from '../shims/app'
import { getFunctions, httpsCallable } from '../shims/functions'
import { DEMO_MESSAGE, validateNewJob, jobActivity, validateInspection, inspectionActivity, validateNewUser } from '../callables'
import { Timestamp } from '../timestamp'
import { callableMessage } from '../../lib/callableError'
import { toLocalDateStr } from '../../lib/dates'
import * as serverJobs from '../../../functions/lib/jobs.js'
import * as serverInspections from '../../../functions/lib/inspections.js'
import * as serverUsers from '../../../functions/lib/users-validate.js'

// The Cloud Functions the screens call, as the demo answers them. Each one applies
// the transition the real function applies, writes the same notification and history
// line, and refuses what the real one refuses with the same code and the same words,
// because a screen shows those words (callableMessage). Every other function, the
// QuickBooks and CompanyCam ones included, says that this is a demo.
//
// The rules that the server keeps in modules with no Firebase imports are compared
// with those modules directly, so the demo cannot drift from them unnoticed.

const { owner: OWNER, internal: OFFICE, builder: BUILDER, client: CLIENT } = DEMO_USERS

const lines = (amount) => [{ desc: 'Added circuit', qty: 1, unit: 'EA', unitPrice: amount, extPrice: amount }]

const fixture = () => ({
  users: Object.fromEntries(Object.values(DEMO_USERS).map((u) => [u.uid, {
    email: u.email, displayName: u.displayName, role: u.claims.role, tenantId: u.claims.tenantId,
    ...(u.claims.role === 'client' ? { clientJobIds: u.claims.clientJobIds, clientName: u.displayName } : {}),
  }])),
  jobs: {
    jq: {
      id: 'QBS-101', address: '12 Alder Way', client: 'Larkspur Homes', tenantId: 'qbs', clientUids: [CLIENT.uid],
      insp: { electrical: { roughIn: 'pending-verification', trim: 'not-started' }, hvac: { final: 'scheduled' } },
    },
    jv: { id: 'VIS-201', address: '40 Birch Row', client: 'Ostrander Family', tenantId: 'vision', clientUids: [] },
  },
  extras: {
    draft: { coNumber: 'CO-2026-001', job: 'QBS-101', status: 'Draft', total: 1250, amount: 1250, lineItems: lines(1250) },
    sent: { coNumber: 'CO-2026-002', job: 'QBS-101', status: 'Sent to Builder', total: 4100, amount: 4100, qbs: true, tenantId: 'qbs', clientUids: [CLIENT.uid] },
    legacy: { id: 'CO-004', job: 'QBS-101', status: 'pending', amount: 2900, qbs: false },
    vision: { coNumber: 'CO-2026-003', job: 'VIS-201', status: 'Sent to Builder', total: 800, tenantId: 'vision', clientUids: [] },
    approved: { coNumber: 'CO-2026-004', job: 'QBS-101', status: 'Approved', total: 3500, tenantId: 'qbs', clientUids: [CLIENT.uid] },
    rejected: { coNumber: 'CO-2026-005', job: 'QBS-101', status: 'Rejected', total: 600, tenantId: 'qbs', clientUids: [CLIENT.uid] },
    orphan: { coNumber: 'CO-2026-006', job: 'QBS-999', status: 'Draft', total: 100 },
  },
})

let app
let session
let store
let functions

const call = (name, data) => httpsCallable(functions, name)(data)
const as = (role) => session.switchRole(role)

// What a refused call rejects with: the code the Functions SDK gives and the sentence.
const refused = (code, message) => expect.objectContaining({ code: `functions/${code}`, message })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 19, 9, 30, 0))
  session = createDemoSession({ storage: null })
  app = initializeApp({ demo: { session, store: { seed: fixture, version: 'test' } } })
  store = app.demoStore()
  functions = getFunctions(app)
})

afterEach(() => {
  vi.useRealTimers()
})

const notifications = () => store.find('notifications')
const history = () => store.find('history')

describe('sendExtraToBuilder', () => {
  it('sends a draft, stamps it with its job scope, and writes the notification and the history line', async () => {
    as('owner')
    await expect(call('sendExtraToBuilder', { extraId: 'draft' })).resolves.toEqual({ data: { ok: true } })

    const sent = store.get('extras', 'draft')
    expect(sent).toMatchObject({ status: 'Sent to Builder', qbs: true, tenantId: 'qbs', clientUids: [CLIENT.uid] })
    expect(sent.sentAt).toBeInstanceOf(Timestamp)
    expect(sent.qbsSentAt).toBeInstanceOf(Timestamp)
    expect(sent.sentAt.toDate()).toEqual(new Date(2026, 9, 19, 9, 30, 0))

    expect(notifications().map((n) => n.data)).toEqual([expect.objectContaining({
      type: 'info',
      msg: 'CO-2026-001 sent to the builder: $1,250 (QBS-101)',
      jobId: 'QBS-101',
      tenantId: 'qbs',
      clientUids: [CLIENT.uid],
      createdBy: OWNER.uid,
      createdByEmail: OWNER.email,
      read: false,
    })])
    expect(history().map((h) => h.data)).toEqual([expect.objectContaining({
      type: 'change-order',
      action: 'sent',
      summary: 'CO-2026-001 sent to the builder: $1,250',
      actor: OWNER.displayName,
      actorUid: OWNER.uid,
      jobId: 'QBS-101',
      extraId: 'draft',
    })])
  })

  it('is for staff only, and refuses what cannot be sent', async () => {
    as('builder')
    await expect(call('sendExtraToBuilder', { extraId: 'draft' })).rejects.toEqual(refused('permission-denied', 'Staff access required.'))
    as('internal')
    await expect(call('sendExtraToBuilder', { extraId: 'approved' })).rejects.toEqual(refused('failed-precondition', 'This change order is already approved.'))
    await expect(call('sendExtraToBuilder', { extraId: 'nope' })).rejects.toEqual(refused('not-found', 'That change order no longer exists.'))
    await expect(call('sendExtraToBuilder', { extraId: 'a/b' })).rejects.toEqual(refused('invalid-argument', 'Choose a change order.'))
    await expect(call('sendExtraToBuilder', { extraId: 'orphan' })).rejects.toEqual(refused('not-found', 'That job no longer exists.'))
    expect(store.get('extras', 'draft').status).toBe('Draft')
    expect(notifications()).toEqual([])
    expect(history()).toEqual([])
  })

  it('sends a change order again after a revision was asked for', async () => {
    as('owner')
    await call('sendExtraToBuilder', { extraId: 'rejected' })
    expect(store.get('extras', 'rejected').status).toBe('Sent to Builder')
  })
})

describe('approveExtra', () => {
  it('approves for the builder of the tenant, with who and when, at the total they were shown', async () => {
    as('builder')
    await expect(call('approveExtra', { extraId: 'sent', expectedTotal: 4100 })).resolves.toEqual({ data: { ok: true } })
    const approved = store.get('extras', 'sent')
    expect(approved.status).toBe('Approved')
    expect(approved.approvedBy).toEqual({ uid: BUILDER.uid, email: BUILDER.email, displayName: BUILDER.displayName })
    expect(approved.approvedAt).toBeInstanceOf(Timestamp)
    expect(notifications()[0].data).toMatchObject({
      type: 'success', msg: `CO-2026-002 approved by ${BUILDER.displayName}: $4,100 (QBS-101)`, tenantId: 'qbs', clientUids: [CLIENT.uid],
    })
    expect(history()[0].data).toMatchObject({ type: 'change-order', action: 'approved', summary: 'CO-2026-002 approved: $4,100', actor: BUILDER.displayName })
  })

  it('approves for a client of the job, and for staff', async () => {
    as('client')
    await call('approveExtra', { extraId: 'sent', expectedTotal: 4100 })
    expect(store.get('extras', 'sent').approvedBy.uid).toBe(CLIENT.uid)
    as('owner')
    await call('approveExtra', { extraId: 'vision' })
    expect(store.get('extras', 'vision').status).toBe('Approved')
  })

  it('stamps an unstamped change order with its job scope as it decides it', async () => {
    as('builder')
    await call('approveExtra', { extraId: 'legacy', expectedTotal: 2900 })
    expect(store.get('extras', 'legacy')).toMatchObject({ status: 'Approved', tenantId: 'qbs', clientUids: [CLIENT.uid] })
  })

  it('refuses a total that is not the stored one, out of scope callers, drafts and decided ones, and writes nothing', async () => {
    as('builder')
    await expect(call('approveExtra', { extraId: 'sent', expectedTotal: 4000 }))
      .rejects.toEqual(refused('failed-precondition', 'This change order changed since you opened it. Review it again.'))
    await expect(call('approveExtra', { extraId: 'vision', expectedTotal: 800 }))
      .rejects.toEqual(refused('permission-denied', 'You can only act on change orders for your own projects.'))
    as('owner')
    await expect(call('approveExtra', { extraId: 'draft' }))
      .rejects.toEqual(refused('failed-precondition', 'This change order has not been sent for approval.'))
    await expect(call('approveExtra', { extraId: 'approved' }))
      .rejects.toEqual(refused('failed-precondition', 'This change order has already been decided.'))
    as('client')
    await expect(call('approveExtra', { extraId: 'vision' }))
      .rejects.toEqual(refused('permission-denied', 'You can only act on change orders for your own projects.'))
    expect(store.get('extras', 'sent').status).toBe('Sent to Builder')
    expect(store.get('extras', 'legacy').tenantId).toBeUndefined()
    expect(notifications()).toEqual([])
    expect(history()).toEqual([])
  })

  it('checks in the order the server does: who may act, then the state, then the total', async () => {
    as('builder')
    await expect(call('approveExtra', { extraId: 'vision', expectedTotal: 1 }))
      .rejects.toEqual(refused('permission-denied', 'You can only act on change orders for your own projects.'))
    as('owner')
    await expect(call('approveExtra', { extraId: 'approved', expectedTotal: 1 }))
      .rejects.toEqual(refused('failed-precondition', 'This change order has already been decided.'))
    await expect(call('approveExtra', { extraId: 'draft', expectedTotal: 1 }))
      .rejects.toEqual(refused('failed-precondition', 'This change order has not been sent for approval.'))
    await expect(call('approveExtra', { extraId: 'nope', expectedTotal: 1 }))
      .rejects.toEqual(refused('not-found', 'That change order no longer exists.'))
  })

  it('tells a person the function sentence, which callableMessage shows as it is', async () => {
    as('builder')
    const error = await call('approveExtra', { extraId: 'sent', expectedTotal: 1 }).catch((e) => e)
    expect(callableMessage(error, 'Could not save approval.')).toBe('This change order changed since you opened it. Review it again.')
  })
})

describe('rejectExtra', () => {
  it('asks for a revision with the note, and says so in the notification and the history', async () => {
    as('client')
    await call('rejectExtra', { extraId: 'sent', note: '  Use the   existing panel\nplease  ', expectedTotal: 4100 })
    const rejected = store.get('extras', 'sent')
    expect(rejected).toMatchObject({
      status: 'Rejected',
      rejectNotes: 'Use the   existing panel\nplease',
      rejectedBy: { uid: CLIENT.uid, email: CLIENT.email, displayName: CLIENT.displayName },
    })
    expect(rejected.rejectedAt).toBeInstanceOf(Timestamp)
    expect(notifications()[0].data).toMatchObject({
      type: 'warn', msg: `CO-2026-002 revision requested by ${CLIENT.displayName} (QBS-101): Use the existing panel please`,
    })
    expect(history()[0].data).toMatchObject({ action: 'rejected', summary: 'CO-2026-002 revision requested: Use the existing panel please' })
  })

  it('needs a note, asked for before anything is read', async () => {
    as('builder')
    await expect(call('rejectExtra', { extraId: 'nope', note: '   ' })).rejects.toEqual(refused('invalid-argument', 'Say what should be revised.'))
    await expect(call('rejectExtra', { extraId: 'sent', note: 'x'.repeat(1001) })).rejects.toEqual(refused('invalid-argument', 'Say what should be revised.'))
  })

  it('refuses a stale total and a change order that is not the caller\'s', async () => {
    as('builder')
    await expect(call('rejectExtra', { extraId: 'sent', note: 'Too high', expectedTotal: 10 }))
      .rejects.toEqual(refused('failed-precondition', 'This change order changed since you opened it. Review it again.'))
    await expect(call('rejectExtra', { extraId: 'vision', note: 'Too high' }))
      .rejects.toEqual(refused('permission-denied', 'You can only act on change orders for your own projects.'))
  })
})

describe('passInspection and failInspection', () => {
  it('records a pass dated today where the person is, with the notification and the history line', async () => {
    as('owner')
    await expect(call('passInspection', { jobDocId: 'jq', trade: 'electrical', phase: 'roughIn' })).resolves.toEqual({ data: { ok: true } })
    const job = store.get('jobs', 'jq')
    expect(job.insp.electrical).toEqual({ roughIn: 'passed', roughInDate: toLocalDateStr(new Date(2026, 9, 19)), trim: 'not-started' })
    expect(job.insp.hvac).toEqual({ final: 'scheduled' })
    expect(notifications()[0].data).toMatchObject({ type: 'success', msg: 'QBS-101 electrical rough in passed', jobId: 'QBS-101', tenantId: 'qbs', clientUids: [CLIENT.uid] })
    expect(history()[0].data).toMatchObject({ type: 'inspection', action: 'passed', summary: 'QBS-101 electrical rough in passed', actor: OWNER.displayName })
  })

  it('records a fail as an error alert', async () => {
    as('internal')
    await call('failInspection', { jobDocId: 'jq', trade: 'hvac', phase: 'final' })
    expect(store.get('jobs', 'jq').insp.hvac).toEqual({ final: 'failed', finalDate: '2026-10-19' })
    expect(notifications()[0].data).toMatchObject({ type: 'error', msg: 'QBS-101 HVAC final failed', createdBy: OFFICE.uid })
  })

  it('is for staff only, and refuses a job, trade or phase that does not exist', async () => {
    as('builder')
    await expect(call('passInspection', { jobDocId: 'jq', trade: 'electrical', phase: 'roughIn' })).rejects.toEqual(refused('permission-denied', 'Staff access required.'))
    as('client')
    await expect(call('failInspection', { jobDocId: 'jq', trade: 'electrical', phase: 'roughIn' })).rejects.toEqual(refused('permission-denied', 'Staff access required.'))
    as('owner')
    await expect(call('passInspection', { jobDocId: '', trade: 'electrical', phase: 'roughIn' })).rejects.toEqual(refused('invalid-argument', 'Choose a job.'))
    await expect(call('passInspection', { jobDocId: 'jq', trade: 'gas', phase: 'roughIn' })).rejects.toEqual(refused('invalid-argument', 'Choose electrical, plumbing or HVAC.'))
    await expect(call('passInspection', { jobDocId: 'jq', trade: 'plumbing', phase: 'trim' })).rejects.toEqual(refused('invalid-argument', 'That inspection phase does not exist for this trade.'))
    await expect(call('passInspection', { jobDocId: 'gone', trade: 'electrical', phase: 'roughIn' })).rejects.toEqual(refused('not-found', 'That job no longer exists.'))
    expect(store.get('jobs', 'jq').insp.electrical.roughIn).toBe('pending-verification')
    expect(notifications()).toEqual([])
  })
})

describe('createJob', () => {
  const NEW_JOB = {
    id: 'QBS-102', address: ' 7 Cedar Bend ', city: 'Franklin, TN', client: 'Larkspur Homes', type: 'Full MEP Renovation',
    pm: 'Taylor Hensley', status: 'pending', progress: 0, tenantId: 'qbs', clientUids: ['someone-else'], createdBy: 'someone-else',
    subs: { electrical: null }, permits: { electrical: 'applied' }, insp: { electrical: { roughIn: 'not-started' } },
  }

  it('creates the job with the server fields, links the clients who list it, and writes the notification and the history', async () => {
    store.update('users', CLIENT.uid, { clientJobIds: [...CLIENT.claims.clientJobIds, 'QBS-102'] })
    as('owner')
    const { data } = await call('createJob', NEW_JOB)
    expect(data).toEqual({ ok: true, docId: expect.stringMatching(/^[A-Za-z0-9]{20}$/) })
    const job = store.get('jobs', data.docId)
    expect(job).toMatchObject({
      id: 'QBS-102', address: '7 Cedar Bend', client: 'Larkspur Homes', tenantId: 'qbs', clientUids: [CLIENT.uid],
      createdBy: OWNER.uid, createdByEmail: OWNER.email, permits: { electrical: 'applied' },
    })
    expect(job.createdAt).toBeInstanceOf(Timestamp)
    expect(notifications()[0].data).toMatchObject({ type: 'info', msg: `QBS-102 created by ${OWNER.displayName}`, jobId: 'QBS-102', clientUids: [CLIENT.uid] })
    expect(history()[0].data).toMatchObject({ type: 'job', action: 'created', summary: 'QBS-102 created: 7 Cedar Bend' })
  })

  it('refuses a caller who is not staff, a form the server refuses, and an id that is taken', async () => {
    as('builder')
    await expect(call('createJob', NEW_JOB)).rejects.toEqual(refused('permission-denied', 'Staff access required.'))
    as('owner')
    await expect(call('createJob', { ...NEW_JOB, id: 'qbs-102' })).rejects.toEqual(refused('invalid-argument', 'Job ID must look like QBS-001.'))
    await expect(call('createJob', { ...NEW_JOB, address: ' ' })).rejects.toEqual(refused('invalid-argument', 'Enter the street address.'))
    await expect(call('createJob', { ...NEW_JOB, client: '' })).rejects.toEqual(refused('invalid-argument', 'Enter the client name.'))
    await expect(call('createJob', { ...NEW_JOB, tenantId: 'elsewhere' })).rejects.toEqual(refused('invalid-argument', 'Choose a tenant.'))
    await expect(call('createJob', { ...NEW_JOB, id: 'QBS-101' })).rejects.toEqual(refused('already-exists', 'A job with that ID already exists.'))
    expect(store.find('jobs')).toHaveLength(2)
  })
})

describe('createUser', () => {
  it('creates the users document for the owner, with the cleaned values', async () => {
    as('owner')
    const { data } = await call('createUser', { email: ' New.Person@Example.com ', displayName: ' Avery Lane ', role: 'client', clientJobIds: ['qbs-101', 'QBS-101'] })
    expect(data.uid).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(store.get('users', data.uid)).toMatchObject({
      email: 'new.person@example.com', displayName: 'Avery Lane', role: 'client', tenantId: 'p2-core',
      clientJobIds: ['QBS-101'], clientName: 'Avery Lane', createdBy: OWNER.uid,
    })
  })

  it('is for the owner only, and refuses what the server refuses', async () => {
    as('internal')
    await expect(call('createUser', { email: 'a@example.com', role: 'internal' })).rejects.toEqual(refused('permission-denied', 'Owner access required.'))
    as('owner')
    await expect(call('createUser', { email: 'not an email', role: 'internal' })).rejects.toEqual(refused('invalid-argument', 'Enter a valid email address.'))
    await expect(call('createUser', { email: 'a@example.com', role: 'admin' })).rejects.toEqual(refused('invalid-argument', 'Choose a role.'))
    await expect(call('createUser', { email: 'a@example.com', role: 'builder', tenantId: 'p2-core' })).rejects.toEqual(refused('invalid-argument', 'Choose a builder tenant.'))
    await expect(call('createUser', { email: 'a@example.com', role: 'client', clientJobIds: [] })).rejects.toEqual(refused('invalid-argument', 'Enter at least one job id like QBS-001.'))
    await expect(call('createUser', { email: 'a@example.com', role: 'client', clientJobIds: ['House 9'] })).rejects.toEqual(refused('invalid-argument', 'Job ids must look like QBS-001.'))
    await expect(call('createUser', { email: CLIENT.email.toUpperCase(), role: 'internal' })).rejects.toEqual(refused('already-exists', 'An account with that email already exists.'))
  })
})

describe('every other function', () => {
  it.each(['qbAuth', 'qbDisconnect', 'qbCallback', 'ccAuth', 'ccDisconnect', 'ccCallback', 'ccSyncPhotos', 'backfillScopes', 'somethingNew'])(
    '%s says this is a demo, in the words a screen shows',
    async (name) => {
      as('owner')
      const error = await call(name, {}).catch((e) => e)
      expect(error).toEqual(refused('failed-precondition', 'This is a demo. Connections to other systems are turned off.'))
      expect(error.message).toBe(DEMO_MESSAGE)
      expect(callableMessage(error, 'Could not do it.')).toBe(DEMO_MESSAGE)
    },
  )

  it('takes the options the app passes, such as a timeout', async () => {
    as('owner')
    await expect(httpsCallable(functions, 'backfillScopes', { timeout: 540000 })()).rejects.toEqual(refused('failed-precondition', DEMO_MESSAGE))
  })
})

describe('the rules the demo shares with the server', () => {
  const JOB_INPUTS = [
    undefined, null, 'QBS-001', {},
    { id: 'QBS-001' },
    { id: 'QBS-001', address: '1 Main St' },
    { id: 'QBS-001', address: '1 Main St', client: 'Dana' },
    { id: 'QBS-001', address: '1 Main St', client: 'Dana', tenantId: 'vision' },
    { id: 'QBS-001', address: ' 1 Main St ', client: ' Dana ', tenantId: 'qbs', name: ' North ', progress: 4, extras: 0,
      subs: { electrical: 'Theo', plumbing: null }, tags: ['a', 1, true], bad: [{ x: 1 }], fn: () => 1,
      'a.b': 1, __proto__x: 2, deep: { one: { two: { three: { four: 1 } } } }, createdBy: 'x', clientUids: ['y'] },
  ]

  it.each(JOB_INPUTS.map((input) => [input]))('validateNewJob(%j) answers as the server does', (input) => {
    expect(validateNewJob(input)).toEqual(serverJobs.validateNewJob(input))
  })

  it('words a new job as the server does', () => {
    const job = { id: 'QBS-001', address: '1 Main St' }
    expect(jobActivity(job, { displayName: 'Dana' })).toEqual(serverJobs.jobActivity(job, { displayName: 'Dana' }))
  })

  const INSPECTION_INPUTS = [
    undefined, {}, { jobDocId: 'a/b' }, { jobDocId: 'job1' }, { jobDocId: 'job1', trade: 'gas' },
    { jobDocId: 'job1', trade: 'plumbing', phase: 'trim' }, { jobDocId: 'job1', trade: 'hvac', phase: 'roughIn' },
    { jobDocId: 'job1', trade: 'electrical', phase: 'trim' },
  ]

  it.each(INSPECTION_INPUTS.map((input) => [input]))('validateInspection(%j) answers as the server does', (input) => {
    expect(validateInspection(input)).toEqual(serverInspections.validateInspection(input))
  })

  it.each([
    ['electrical', 'roughIn', 'passed'], ['plumbing', 'final', 'failed'], ['hvac', 'final', 'passed'], ['electrical', 'trim', 'failed'],
  ])('words %s %s %s as the server does', (trade, phase, result) => {
    for (const job of [{ id: 'QBS-001' }, {}, { id: '' }]) {
      expect(inspectionActivity(job, trade, phase, result)).toEqual(serverInspections.inspectionActivity(job, trade, phase, result))
    }
  })

  const USER_INPUTS = [
    undefined, {}, { email: 'x' }, { email: 'a@b.co' }, { email: ' A@B.co ', role: 'owner' },
    { email: 'a@b.co', role: 'builder' }, { email: 'a@b.co', role: 'builder', tenantId: 'vision', displayName: ' Sam ' },
    { email: 'a@b.co', role: 'client' }, { email: 'a@b.co', role: 'client', clientJobIds: [' qbs-001 ', 'QBS-001', ''] },
    { email: 'a@b.co', role: 'client', clientJobIds: ['QBS-1'] }, { email: 'a@b.co', role: 'internal', tenantId: 'qbs', clientJobIds: ['QBS-001'] },
  ]

  it.each(USER_INPUTS.map((input) => [input]))('validateNewUser(%j) answers as the server does', (input) => {
    expect(validateNewUser(input)).toEqual(serverUsers.validateNewUser(input))
  })
})
