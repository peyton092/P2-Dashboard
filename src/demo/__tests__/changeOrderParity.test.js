import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The demo answers approveExtra, rejectExtra and sendExtraToBuilder with copies of the
// server's rules (../callables.js), so that a builder or a client sees what the real
// app would do. These tests hold the copies to the originals in functions/: the scope
// rule, the document id rule, the change order rules (state, note, total, transition,
// activity wording) and the notification and history documents. A server change to a
// rule or a sentence fails these tests until the demo copy follows it.
//
// functions/lib/activity.js imports firebase-admin, which is stood in for with vi.mock.
// functions/lib/extras.js also imports firebase-functions, which only the functions
// package installs, so its own source is run here with its two imports stood in for,
// and the test first holds that those two are all it imports. The sentences of
// functions/extras.js, which exports none of them, are read from its source.

const SERVER_TIME = vi.hoisted(() => Object.freeze({ fieldValue: 'serverTimestamp' }))

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => SERVER_TIME } }))

import * as serverActivity from '../../../functions/lib/activity.js'
import * as serverScope from '../../../functions/lib/scope.js'
import * as serverDocId from '../../../functions/lib/doc-id.js'
import * as demo from '../callables'
import { extraState as browserExtraState } from '../../lib/extraStatus'
import { isServerTimestamp } from '../timestamp'

const read = (path) => readFileSync(resolve(import.meta.dirname, '../../../functions', path), 'utf8')

class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// The exports of a server file whose only imports are named ones in given, from its
// own source as it is. Returns the imports it read, as name from package, and the
// module.
function runServerSource(path, given) {
  const source = read(path)
  const imports = [...source.matchAll(/^import \{ (\w+) \} from '([^']+)'$/gm)].map(([, name, from]) => `${name} from ${from}`)
  const names = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map(([, name]) => name)
  const body = source.replace(/^import .*$/gm, '').replace(/^export (const|function) /gm, '$1 ')
  const module = new Function(...Object.keys(given), `${body}\nreturn { ${names.join(', ')} }`)(...Object.values(given))
  return { imports, module }
}

const extrasFile = runServerSource('lib/extras.js', { HttpsError, FieldValue: { serverTimestamp: () => SERVER_TIME } })
const serverExtras = extrasFile.module
const serverSource = read('extras.js')

it('runs the server change order rules from their own source, which imports two Firebase names only', () => {
  expect(extrasFile.imports).toEqual(['HttpsError from firebase-functions/v2/https', 'FieldValue from firebase-admin/firestore'])
  expect(Object.keys(serverExtras)).toEqual(expect.arrayContaining(['NOTE_MAX', 'NOTE_REQUIRED', 'TOTAL_CHANGED', 'extraState', 'cleanRevisionNote', 'totalChanged', 'extraTransition', 'extraActivity']))
})

// A value with either side's server timestamp written the same way, so the two compare.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null, (_key, inner) =>
  (inner === SERVER_TIME || isServerTimestamp(inner) ? 'server time' : inner)))

// What a rule does: what it returns, or what it refuses with. The browser sees a
// server refusal's code as functions/ and the code, as the demo writes it.
function outcome(run) {
  try {
    return { returns: plain(run()) }
  } catch (error) {
    const code = typeof error.code === 'string' && !error.code.startsWith('functions/') ? `functions/${error.code}` : error.code ?? null
    return { refuses: { code, message: error.message } }
  }
}

const STATUSES = ['Draft', 'Sent to Builder', 'pending', undefined, 'Approved', 'approved', 'Rejected', 'rejected', 'Archived', 42]
const ACTIONS = ['send', 'approve', 'reject', 'archive']
const NOTES = [undefined, '', '   ', 'Move the panel to the garage', `  ${'x'.repeat(1000)}  `, 'x'.repeat(1001), 'line one\n\n  line two', 42]
const ACTOR = { uid: 'demo-builder', email: 'builder@example.com', displayName: 'Casey Morrow', role: 'builder' }

describe('the change order rules of the demo and of the server', () => {
  it('have the same limits and sentences', () => {
    expect(demo.NOTE_MAX).toBe(serverExtras.NOTE_MAX)
    expect(demo.NOTE_REQUIRED).toBe(serverExtras.NOTE_REQUIRED)
    expect(demo.TOTAL_CHANGED).toBe(serverExtras.TOTAL_CHANGED)
  })

  it('read the state of a change order the same way, the browser copy too', () => {
    for (const status of STATUSES) {
      const extra = { status }
      expect(browserExtraState(extra), String(status)).toBe(serverExtras.extraState(extra))
    }
    expect(browserExtraState(undefined)).toBe(serverExtras.extraState(undefined))
  })

  it('clean a revision note the same way', () => {
    for (const note of NOTES) expect(demo.cleanRevisionNote(note), JSON.stringify(note)).toBe(serverExtras.cleanRevisionNote(note))
  })

  it('compare the total a person was shown the same way', () => {
    const extras = [{ total: 4100 }, { total: '4100' }, { amount: 916.55 }, {}, { total: 0, amount: 50 }, { total: null, amount: 50 }]
    const shown = [undefined, 4100, '4100', 4100.01, 916.55, 0, 50, null, 'abc']
    for (const extra of extras) {
      for (const expected of shown) {
        expect(demo.totalChanged(extra, expected), `${JSON.stringify(extra)} ${expected}`).toBe(serverExtras.totalChanged(extra, expected))
      }
    }
  })

  it('make the same change, or refuse it with the same code and sentence, for every state, action and note', () => {
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        for (const note of NOTES) {
          const extra = { id: 'CO-004', status, total: 4100, job: 'QBS-003' }
          const label = `${status} ${action} ${JSON.stringify(note)}`
          expect(outcome(() => demo.extraTransition(extra, action, ACTOR, note)), label)
            .toEqual(outcome(() => serverExtras.extraTransition(extra, action, ACTOR, note)))
        }
      }
    }
  })

  it('word the notification and the history line the same way', () => {
    const extras = [
      { id: 'CO-004', job: 'QBS-003', total: 4100 },
      { coNumber: 'CO-2026-014', job: 'QBS-024', amount: 916.55 },
      { id: '  ', coNumber: ' ', job: '  ', total: -250 },
      { total: 'abc' },
      {},
      undefined,
    ]
    for (const extra of extras) {
      for (const action of ACTIONS) {
        for (const note of NOTES) {
          const label = `${JSON.stringify(extra)} ${action} ${JSON.stringify(note)}`
          expect(outcome(() => demo.extraActivity(extra, action, ACTOR, note)), label)
            .toEqual(outcome(() => serverExtras.extraActivity(extra, action, ACTOR, note)))
        }
      }
    }
  })
})

describe('the documents written beside a change, in the demo and on the server', () => {
  const actor = { uid: 'demo-owner', email: 'owner@example.com', displayName: 'Dana Whitlock' }

  it('write the same notification', () => {
    for (const input of [
      { type: 'success', msg: 'CO-004 approved by Dana Whitlock: $4,100 (QBS-003)', jobId: 'QBS-003', scope: { tenantId: 'qbs', clientUids: ['demo-client'] }, actor },
      { type: 'info', msg: 'Sent', jobId: undefined, scope: { tenantId: 'p2-core', clientUids: [] }, actor },
    ]) {
      expect(plain(demo.notificationDoc(input))).toEqual(plain(serverActivity.notificationDoc(input)))
    }
  })

  it('write the same history line', () => {
    for (const input of [
      { type: 'change-order', action: 'approved', summary: 'CO-004 approved: $4,100', jobId: 'QBS-003', extraId: 'co-004', actor },
      { type: 'inspection', action: 'passed', summary: 'QBS-044 plumbing rough in passed', jobId: null, actor },
    ]) {
      expect(plain(demo.historyDoc(input))).toEqual(plain(serverActivity.historyDoc(input)))
    }
  })
})

describe('who may act on a change order, in the demo and on the server', () => {
  const claims = [
    null,
    { uid: 'o', role: 'owner', tenantId: 'p2-core' },
    { uid: 'i', role: 'internal', tenantId: 'p2-core' },
    { uid: 'b', role: 'builder', tenantId: 'qbs' },
    { uid: 'b', role: 'builder', tenantId: 'vision' },
    { uid: 'b', role: 'builder', tenantId: '' },
    { uid: 'b', role: 'builder', tenantId: null },
    { uid: 'demo-client', role: 'client', tenantId: 'p2-core' },
    { uid: '', role: 'client', tenantId: 'p2-core' },
    { uid: 'g', role: 'guest', tenantId: 'qbs' },
    { uid: 'n', role: null, tenantId: 'qbs' },
  ]
  const docs = [
    { tenantId: 'qbs', clientUids: ['demo-client'] },
    { tenantId: 'vision', clientUids: [] },
    { tenantId: '', clientUids: ['demo-client'] },
    { clientUids: ['demo-client', 7, null] },
    { tenantId: 'qbs', clientUids: 'demo-client' },
    {},
    undefined,
  ]

  it('give a job the same scope', () => {
    for (const job of docs) expect(demo.scopeForJob(job), JSON.stringify(job)).toEqual(serverScope.scopeForJob(job))
  })

  it('let the same people act on the same change orders', () => {
    for (const who of claims) {
      for (const extra of docs) {
        expect(demo.canActOnExtra(who, extra), `${JSON.stringify(who)} ${JSON.stringify(extra)}`).toBe(serverScope.canActOnExtra(who, extra))
      }
    }
  })

  it('take the same document ids', () => {
    for (const id of ['co-004', 'QBS-001', 'abc.DEF_9', 'a/b', '', ' x', '.hidden', '_x', 'x'.repeat(200), 'x'.repeat(201), 42, null, undefined]) {
      expect(demo.cleanDocId(id), JSON.stringify(id)).toBe(serverDocId.cleanDocId(id))
    }
  })
})

describe('the refusals of the change order callables', () => {
  // functions/extras.js keeps these sentences to itself, so they are read from its source.
  const sentence = (name) => new RegExp(`const ${name} = '([^']*)'`).exec(serverSource)?.[1]

  it('name a change order or a job that is gone, and one that is not yours, as the server does', () => {
    expect(demo.EXTRA_GONE).toBe(sentence('EXTRA_GONE'))
    expect(demo.JOB_GONE).toBe(sentence('JOB_GONE'))
    expect(demo.NOT_YOURS).toBe(sentence('NOT_YOURS'))
  })

  it('ask for a change order with the server sentence when none is named', async () => {
    const store = { get: () => undefined, find: () => [] }
    const user = { uid: 'demo-owner', email: 'owner@example.com', claims: { role: 'owner', tenantId: 'p2-core' } }
    const refusal = await demo.runCallable('approveExtra', { extraId: 'a/b' }, { store, user }).catch((error) => error)
    expect(refusal.code).toBe('functions/invalid-argument')
    expect(serverSource).toContain(`throw new HttpsError('invalid-argument', '${refusal.message}')`)
  })
})
