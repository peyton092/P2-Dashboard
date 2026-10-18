import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { getMessaging } from 'firebase-admin/messaging'
import { db } from '../lib/admin.js'
import { onNotificationCreated } from '../push.js'
import { assertNoDashes } from './helpers/firestore-stub.js'

// The fan out of onNotificationCreated: which devices a notification is sent to, in
// what groups, and which tokens are deleted afterwards. The rules of who is in scope
// are tested on their own in push-targets.test.js (targetTokens and groupTokens);
// these tests run the handler, so they also pin how it reads the tokens and the users
// and what it hands to FCM.
//
// Nothing here reaches a network. The Firestore instance and the Admin Messaging
// instance are the real singletons with the methods the handler calls replaced, so a
// call the handler makes that is not stubbed fails loudly (no credentials, no
// emulator) instead of quietly succeeding. The Messaging stub refuses what FCM
// refuses: a multicast of no tokens, and one of more than 500.

let multicasts // every message handed to sendEachForMulticast, in order
let reads // the paths of each getAll call, in order
let deleted // the fcm_tokens documents deleted, in order
let logged // console.log output

const fcmError = (code) => Object.assign(new Error(`Firebase messaging error: ${code}`), { code })

// tokens: the fcm_tokens documents that exist, { token: { uid } }, listed in this order
// users: the users documents that exist, { uid: { role, tenantId, clientJobIds } }
// readError: what reading the users fails with
function stubFirestore({ tokens = {}, users = {}, readError } = {}) {
  mock.method(db, 'collection', (name) => {
    if (name === 'fcm_tokens') {
      return {
        get: async () => ({ docs: Object.entries(tokens).map(([id, data]) => ({ id, data: () => data })) }),
        doc: (id) => ({
          id,
          path: `fcm_tokens/${id}`,
          delete: async () => {
            deleted.push(id)
          },
        }),
      }
    }
    assert.equal(name, 'users', `unexpected collection ${name}`)
    return { doc: (id) => ({ id, path: `users/${id}` }) }
  })
  mock.method(db, 'getAll', async (...refs) => {
    reads.push(refs.map((ref) => ref.path))
    if (readError) throw readError
    return refs.map((ref) => {
      assert.match(ref.path, /^users\//, 'only users documents are read')
      const data = users[ref.id]
      return { id: ref.id, exists: data !== undefined, data: () => data }
    })
  })
}

// failures: { token: error code }  the tokens FCM rejects; every other token is sent.
function stubMessaging({ failures = {} } = {}) {
  mock.method(getMessaging(), 'sendEachForMulticast', async (message) => {
    multicasts.push(structuredClone(message))
    if (!Array.isArray(message.tokens) || message.tokens.length === 0) throw fcmError('messaging/invalid-argument')
    if (message.tokens.length > 500) throw fcmError('messaging/invalid-argument')
    const responses = message.tokens.map((token) =>
      failures[token] ? { success: false, error: fcmError(failures[token]) } : { success: true, messageId: `id-${token}` },
    )
    const failureCount = responses.filter((r) => !r.success).length
    return { responses, successCount: responses.length - failureCount, failureCount }
  })
}

beforeEach(() => {
  multicasts = []
  reads = []
  deleted = []
  logged = []
  mock.method(console, 'log', (...args) => logged.push(args.join(' ')))
})

afterEach(() => {
  mock.restoreAll()
})

// Installs both stubs for one test: the documents that exist, and how FCM answers.
function given({ tokens, users, failures, readError } = {}) {
  stubFirestore({ tokens, users, readError })
  stubMessaging({ failures })
}

// The event a created notification delivers: its fields, and the id from the path.
const created = (notif) => ({ params: { id: 'n1' }, data: { data: () => notif } })
const notify = (notif) => onNotificationCreated.run(created(notif))

const sentTokens = () => multicasts.flatMap((message) => message.tokens)

// Hyphen, the Unicode dashes (en and em among them) and the minus sign.
const DASH = new RegExp('[-\\u2010-\\u2015\\u2212]')

// One person for each way a notification can reach them, and one device each.
const USERS = {
  owner1: { role: 'owner' },
  staff1: { role: 'internal' },
  qbsB: { role: 'builder', tenantId: 'qbs' },
  visionB: { role: 'builder', tenantId: 'vision' },
  c1: { role: 'client', clientJobIds: ['QBS-001'] },
  c2: { role: 'client', clientJobIds: ['QBS-002'] },
}

const TOKENS = {
  'tok-owner': { uid: 'owner1' },
  'tok-staff': { uid: 'staff1' },
  'tok-qbs': { uid: 'qbsB' },
  'tok-vision': { uid: 'visionB' },
  'tok-c1': { uid: 'c1' },
  'tok-c2': { uid: 'c2' },
}

const STAFF = ['tok-owner', 'tok-staff']

// n devices of one staff user (tok0000 up to tok{n-1}), and that user's document.
const devices = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`tok${String(i).padStart(4, '0')}`, { uid: 'staff1' }]))
const STAFF_ONLY = { staff1: { role: 'internal' } }

describe('onNotificationCreated: who is sent to', () => {
  it('reaches staff and the builders of the notification tenant, not another tenant or an unrelated client', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'info', msg: 'Tenant news', tenantId: 'qbs' })
    assert.equal(multicasts.length, 1)
    assert.deepEqual(multicasts[0].tokens, [...STAFF, 'tok-qbs'])
  })

  it('reaches staff and a client the notification lists, and no other client', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'info', msg: 'For one client', clientUids: ['c1'] })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-c1'])
  })

  it('reaches staff and the clients of the job the notification names', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'info', msg: 'About a job', jobId: 'QBS-001' })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-c1'])
    multicasts = []
    await notify({ type: 'info', msg: 'About another job', jobId: 'QBS-002' })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-c2'])
  })

  it('adds up the tenant and the client scopes of one notification, as the callables write them', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'success', msg: 'Approved', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-qbs', 'tok-c1'])
  })

  it('reaches staff only when the notification carries no scope fields', async () => {
    given({ tokens: TOKENS, users: USERS })
    const unscoped = [
      { type: 'warn', msg: 'Staff note' },
      { type: 'warn', msg: 'Staff note', tenantId: null, clientUids: [], jobId: null },
      { type: 'warn', msg: 'Staff note', tenantId: '', clientUids: 'c1', jobId: '' },
    ]
    for (const notif of unscoped) {
      multicasts = []
      await notify(notif)
      assert.deepEqual(sentTokens(), STAFF, JSON.stringify(notif))
    }
  })

  it('treats a notification with no data as having no scope', async () => {
    given({ tokens: TOKENS, users: USERS })
    await onNotificationCreated.run({ params: { id: 'n1' }, data: undefined })
    assert.deepEqual(sentTokens(), STAFF)
    assert.equal(multicasts[0].notification.body, 'New activity on your projects.')
  })

  it('sends to every device a person has, once each', async () => {
    const tokens = { ...TOKENS, 'tok-owner-2': { uid: 'owner1' }, 'tok-qbs-2': { uid: 'qbsB' } }
    given({ tokens, users: USERS })
    await notify({ type: 'info', msg: 'Tenant news', tenantId: 'qbs' })
    assert.deepEqual(sentTokens(), ['tok-owner', 'tok-staff', 'tok-qbs', 'tok-owner-2', 'tok-qbs-2'])
  })

  it('sends nothing to a device whose user has no users document, or that recorded no user', async () => {
    const tokens = {
      ...TOKENS,
      'tok-gone': { uid: 'deleted-user' },
      'tok-null': { uid: null },
      'tok-legacy': { platform: 'web' },
    }
    given({ tokens, users: USERS })
    await notify({ type: 'info', msg: 'Tenant news', tenantId: 'qbs' })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-qbs'])
    // The missing document is asked for and found missing; the others recorded no one to ask for.
    assert.ok(reads.flat().includes('users/deleted-user'))
    assert.ok(!reads.flat().some((path) => path === 'users/null' || path === 'users/undefined'))
  })

  it('sends nothing to a user with no role or a role this app does not have, whatever the notification says', async () => {
    const users = {
      ...USERS,
      roleless: { tenantId: 'qbs', clientJobIds: ['QBS-001'] },
      admin: { role: 'admin', tenantId: 'qbs', clientJobIds: ['QBS-001'] },
    }
    const tokens = { ...TOKENS, 'tok-roleless': { uid: 'roleless' }, 'tok-admin': { uid: 'admin' } }
    given({ tokens, users })
    await notify({ type: 'info', msg: 'Everything', tenantId: 'qbs', clientUids: ['roleless', 'admin'], jobId: 'QBS-001' })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-qbs', 'tok-c1'])
  })

  // The claims sync and the rules give a builder a tenant only when it is qbs or vision, so a
  // builder whose document names anything else has none and is shown nothing scoped. A push
  // must not tell that builder what the app would not show them.
  it('sends nothing to a builder whose document names a tenant other than qbs or vision, while staff still get the push', async () => {
    const users = {
      ...USERS,
      coreB: { role: 'builder', tenantId: 'p2-core' },
      acmeB: { role: 'builder', tenantId: 'acme' },
      upperB: { role: 'builder', tenantId: 'QBS' },
    }
    const tokens = { ...TOKENS, 'tok-core': { uid: 'coreB' }, 'tok-acme': { uid: 'acmeB' }, 'tok-upper': { uid: 'upperB' } }
    given({ tokens, users })
    // A notification stamped with the very tenant the document names reaches staff and nobody else.
    for (const tenantId of ['p2-core', 'acme', 'QBS']) {
      multicasts = []
      await notify({ type: 'info', msg: 'Tenant news', tenantId })
      assert.deepEqual(sentTokens(), STAFF, `a notification stamped ${tenantId}`)
    }
  })

  it('sends a notification stamped vision to the builders whose document names vision, and to no builder of qbs', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'info', msg: 'Vision news', tenantId: 'vision' })
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-vision'])
  })

  it('skips a uid that cannot name a document without stopping the others', async () => {
    const tokens = {
      'tok-empty': { uid: '' },
      'tok-slash': { uid: 'a/b' },
      'tok-number': { uid: 42 },
      'tok-owner': { uid: 'owner1' },
    }
    given({ tokens, users: USERS })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(sentTokens(), ['tok-owner'])
    assert.deepEqual(reads, [['users/owner1']])
  })

  it('reads users documents only, never the whole users collection', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(reads, [['users/owner1', 'users/staff1', 'users/qbsB', 'users/visionB', 'users/c1', 'users/c2']])
  })

  it('sends nothing at all when the users cannot be read, rather than sending to everyone', async () => {
    given({ tokens: TOKENS, users: USERS, readError: new Error('read failed') })
    await assert.rejects(notify({ type: 'info', msg: 'Staff note' }), /read failed/)
    assert.deepEqual(multicasts, [])
    assert.deepEqual(deleted, [])
  })
})

describe('onNotificationCreated: when nothing is sent', () => {
  it('does not call FCM when no device is registered, and reads no users', async () => {
    given({ tokens: {}, users: USERS })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(multicasts, [])
    assert.deepEqual(reads, [])
    assert.deepEqual(deleted, [])
  })

  it('does not call FCM when devices are registered but none is in scope, and logs one line saying so', async () => {
    const tokens = { 'tok-qbs': { uid: 'qbsB' }, 'tok-vision': { uid: 'visionB' }, 'tok-c1': { uid: 'c1' } }
    given({ tokens, users: USERS })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(multicasts, [])
    assert.deepEqual(deleted, [])
    assert.equal(logged.length, 1)
    assert.match(logged[0], /^\[onNotificationCreated\] /)
    assert.match(logged[0], /notifications\/n1/)
    assertNoDashes(logged[0])
  })

  it('does not call FCM, or read any user, when no registered device recorded a user', async () => {
    const tokens = { 'tok-a': { uid: null }, 'tok-b': { platform: 'ios' }, 'tok-c': {} }
    given({ tokens, users: USERS })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(multicasts, [])
    assert.deepEqual(reads, [])
    assert.equal(logged.length, 1)
  })

  it('does not call FCM when every user of the registered devices is gone', async () => {
    const tokens = { 'tok-a': { uid: 'gone-1' }, 'tok-b': { uid: 'gone-2' } }
    given({ tokens, users: {} })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(multicasts, [])
    assert.deepEqual(reads, [['users/gone-1', 'users/gone-2']])
    assert.equal(logged.length, 1)
  })

  it('logs nothing when a push goes out', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(logged, [])
  })
})

describe('onNotificationCreated: the push itself', () => {
  const TITLES = [
    ['error', 'P2 Field Control: action needed'],
    ['warn', 'P2 Field Control: heads up'],
    ['success', 'P2 Field Control: update'],
    ['info', 'P2 Field Control'],
    [undefined, 'P2 Field Control'],
    ['mystery', 'P2 Field Control'],
    // Names every object has must not be read as a title.
    ['constructor', 'P2 Field Control'],
    ['toString', 'P2 Field Control'],
    ['__proto__', 'P2 Field Control'],
  ]

  it('titles each type of notification, and the plain title for any other', async () => {
    given({ tokens: TOKENS, users: USERS })
    for (const [type, title] of TITLES) {
      multicasts = []
      await notify({ type, msg: 'Body' })
      assert.equal(multicasts.length, 1, `type ${String(type)}`)
      assert.equal(multicasts[0].notification.title, title, `type ${String(type)}`)
    }
  })

  it('carries no dash of any kind in a title or in the default body', async () => {
    given({ tokens: TOKENS, users: USERS })
    for (const [type] of TITLES) {
      multicasts = []
      await notify({ type })
      const { title, body } = multicasts[0].notification
      assert.equal(typeof title, 'string')
      assert.doesNotMatch(title, DASH, `title for type ${String(type)}`)
      assert.doesNotMatch(body, DASH, `default body for type ${String(type)}`)
      assertNoDashes(title)
      assertNoDashes(body)
    }
  })

  it('sends the message of the notification as the body, as written', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'success', msg: 'Change order CO-2026-001 approved for QBS-045' })
    assert.equal(multicasts[0].notification.body, 'Change order CO-2026-001 approved for QBS-045')
  })

  it('falls back to the default body when the notification has no message', async () => {
    given({ tokens: TOKENS, users: USERS })
    for (const notif of [{ type: 'info' }, { type: 'info', msg: '' }, { type: 'info', msg: null }]) {
      multicasts = []
      await notify(notif)
      assert.equal(multicasts[0].notification.body, 'New activity on your projects.', JSON.stringify(notif))
    }
  })

  it('hands FCM the notification and the tokens and nothing else, so no scope reaches a device', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify({ type: 'warn', msg: 'Heads up', tenantId: 'qbs', clientUids: ['c1'], jobId: 'QBS-001', createdByEmail: 'x@y.co' })
    assert.deepEqual(multicasts, [
      {
        notification: { title: 'P2 Field Control: heads up', body: 'Heads up' },
        tokens: [...STAFF, 'tok-qbs', 'tok-c1'],
      },
    ])
  })
})

describe('onNotificationCreated: large fan outs', () => {
  it('reads the users ten at a time, each person once however many devices they have', async () => {
    const people = Array.from({ length: 25 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`)
    const users = Object.fromEntries(people.map((uid) => [uid, { role: 'internal' }]))
    const tokens = Object.fromEntries(people.map((uid) => [`tok-${uid}`, { uid }]))
    tokens['tok-s01-tablet'] = { uid: 's01' }
    given({ tokens, users })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(reads.map((paths) => paths.length), [10, 10, 5])
    assert.deepEqual(reads.flat(), people.map((uid) => `users/${uid}`))
    assert.equal(sentTokens().length, 26)
  })

  // FCM takes 500 tokens in a multicast: the 501st starts another.
  for (const [count, sizes] of [[1, [1]], [499, [499]], [500, [500]], [501, [500, 1]]]) {
    it(`sends ${count} ${count === 1 ? 'device' : 'devices'} as ${sizes.length === 1 ? 'one multicast' : 'multicasts'} of ${sizes.join(' and ')}`, async () => {
      given({ tokens: devices(count), users: STAFF_ONLY })
      await notify({ type: 'info', msg: 'Staff note' })
      assert.deepEqual(multicasts.map((message) => message.tokens.length), sizes)
    })
  }

  it('splits a large fan out into multicasts of 500, in order, losing and repeating no token', async () => {
    const tokens = devices(1200)
    given({ tokens, users: STAFF_ONLY })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(multicasts.map((message) => message.tokens.length), [500, 500, 200])
    assert.deepEqual(sentTokens(), Object.keys(tokens))
    for (const message of multicasts) {
      assert.deepEqual(message.notification, { title: 'P2 Field Control', body: 'Staff note' })
    }
  })
})

describe('onNotificationCreated: dead tokens', () => {
  const NOT_REGISTERED = 'messaging/registration-token-not-registered'
  const INVALID = 'messaging/invalid-argument'
  const EVERYONE = { type: 'info', msg: 'Everything', tenantId: 'qbs', clientUids: ['c1'] }

  it('deletes the tokens FCM reports as not registered or invalid, and only those', async () => {
    const failures = {
      'tok-owner': NOT_REGISTERED,
      'tok-staff': INVALID,
      'tok-qbs': 'messaging/internal-error',
      'tok-c1': 'messaging/server-unavailable',
    }
    given({ tokens: TOKENS, users: USERS, failures })
    await notify(EVERYONE)
    assert.deepEqual(sentTokens(), [...STAFF, 'tok-qbs', 'tok-c1'])
    assert.deepEqual(deleted, ['tok-owner', 'tok-staff'])
  })

  it('keeps a token for every other failure FCM reports', async () => {
    const failures = {
      'tok-owner': 'messaging/internal-error',
      'tok-staff': 'messaging/server-unavailable',
      'tok-qbs': 'messaging/message-rate-exceeded',
      'tok-c1': 'messaging/third-party-auth-error',
    }
    given({ tokens: TOKENS, users: USERS, failures })
    await notify(EVERYONE)
    assert.deepEqual(deleted, [])
  })

  it('deletes nothing when every send succeeds', async () => {
    given({ tokens: TOKENS, users: USERS })
    await notify(EVERYONE)
    assert.deepEqual(deleted, [])
  })

  it('finds the dead token in every multicast, including the first and the last token of each', async () => {
    const failures = { tok0003: NOT_REGISTERED, tok0499: INVALID, tok0500: NOT_REGISTERED, tok0999: INVALID, tok1000: INVALID, tok1099: NOT_REGISTERED }
    given({ tokens: devices(1100), users: STAFF_ONLY, failures })
    await notify({ type: 'info', msg: 'Staff note' })
    assert.deepEqual(multicasts.map((message) => message.tokens.length), [500, 500, 100])
    assert.deepEqual(deleted, Object.keys(failures))
  })
})
