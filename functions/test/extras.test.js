import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import {
  NOTE_MAX,
  NOTE_REQUIRED,
  TOTAL_CHANGED,
  cleanRevisionNote,
  extraActivity,
  extraState,
  extraTransition,
  totalChanged,
  totalOf,
} from '../lib/extras.js'

const actor = { uid: 'u1', email: 'dana@qbs.example', displayName: 'Dana Lee' }
const pending = { id: 'CO-004', job: 'QBS-003', amount: 4100, status: 'pending' }

const code = (expected, message) => (err) => {
  assert.ok(err instanceof HttpsError, `expected an HttpsError, got ${err}`)
  assert.equal(err.code, expected)
  if (message !== undefined) assert.equal(err.message, message)
  return true
}

const isServerTime = (value) => value.isEqual(FieldValue.serverTimestamp())

// Job ids and change order numbers are data and keep their hyphens. Everything
// else in the words people read must be free of dashes of every kind.
const IDS = /[A-Z]+(-\d+)+/g
const assertNoDashes = (text) => {
  assert.doesNotMatch(text.replace(IDS, 'ID'), /[-‐-―−]/, `dash in: ${text}`)
}

describe('extraState', () => {
  const cases = [
    ['Draft', 'draft'],
    ['Sent to Builder', 'pending'],
    ['pending', 'pending'],
    ['Approved', 'approved'],
    ['approved', 'approved'],
    ['Rejected', 'rejected'],
    ['rejected', 'rejected'],
    ['', 'pending'],
    ['Cancelled', 'pending'],
    ['draft', 'pending'],
    ['APPROVED', 'pending'],
    ['REJECTED', 'pending'],
    ['Sent To Builder', 'pending'],
  ]
  for (const [status, state] of cases) {
    it(`reads status ${JSON.stringify(status)} as ${state}`, () => {
      assert.equal(extraState({ status }), state)
    })
  }

  it('reads a missing, null or non string status as pending', () => {
    assert.equal(extraState({}), 'pending')
    assert.equal(extraState({ status: null }), 'pending')
    assert.equal(extraState({ status: undefined }), 'pending')
    assert.equal(extraState({ status: 7 }), 'pending')
    assert.equal(extraState({ status: ['Approved'] }), 'pending')
  })

  it('reads a missing extra as pending', () => {
    assert.equal(extraState(null), 'pending')
    assert.equal(extraState(undefined), 'pending')
  })
})

describe('cleanRevisionNote', () => {
  it('returns the trimmed note', () => {
    assert.equal(cleanRevisionNote('  Swap the panel size  '), 'Swap the panel size')
  })

  it('accepts exactly NOTE_MAX characters and refuses one more', () => {
    assert.equal(NOTE_MAX, 1000)
    assert.equal(cleanRevisionNote('x'.repeat(1000)).length, 1000)
    assert.equal(cleanRevisionNote('x'.repeat(1001)), null)
  })

  it('counts the length after trimming', () => {
    assert.equal(cleanRevisionNote(`  ${'x'.repeat(1000)}  `).length, 1000)
  })

  it('returns null for a blank, missing or non string note', () => {
    for (const bad of ['', '   ', '\n\t', undefined, null, 5, {}, ['note'], true]) {
      assert.equal(cleanRevisionNote(bad), null, JSON.stringify(bad))
    }
  })
})

describe('extraTransition approve', () => {
  it('sets Approved, who approved it and a server timestamp, and nothing else', () => {
    const patch = extraTransition(pending, 'approve', actor)
    assert.deepEqual(Object.keys(patch).sort(), ['approvedAt', 'approvedBy', 'status'])
    assert.equal(patch.status, 'Approved')
    assert.deepEqual(patch.approvedBy, { uid: 'u1', email: 'dana@qbs.example', displayName: 'Dana Lee' })
    assert.ok(isServerTime(patch.approvedAt), 'approvedAt is a server timestamp')
  })

  it('records only uid, email and display name of the actor', () => {
    const patch = extraTransition(pending, 'approve', { ...actor, token: 'secret', role: 'owner' })
    assert.deepEqual(Object.keys(patch.approvedBy).sort(), ['displayName', 'email', 'uid'])
  })

  it('keeps a null email as null', () => {
    const patch = extraTransition(pending, 'approve', { ...actor, email: null })
    assert.equal(patch.approvedBy.email, null)
  })

  it('approves an extra that was sent to the builder, or has no status at all', () => {
    assert.equal(extraTransition({ status: 'Sent to Builder' }, 'approve', actor).status, 'Approved')
    assert.equal(extraTransition({}, 'approve', actor).status, 'Approved')
  })

  it('ignores a note, since the patch has no place for one', () => {
    const patch = extraTransition(pending, 'approve', actor, 'looks good')
    assert.deepEqual(Object.keys(patch).sort(), ['approvedAt', 'approvedBy', 'status'])
  })

  it('refuses a draft, saying it has not been sent', () => {
    assert.throws(
      () => extraTransition({ status: 'Draft' }, 'approve', actor),
      code('failed-precondition', 'This change order has not been sent for approval.'),
    )
  })

  it('refuses an extra that is already decided, in either casing', () => {
    for (const status of ['Approved', 'approved', 'Rejected', 'rejected']) {
      assert.throws(
        () => extraTransition({ status }, 'approve', actor),
        code('failed-precondition', 'This change order has already been decided.'),
        status,
      )
    }
  })
})

describe('extraTransition reject', () => {
  it('sets Rejected, who rejected it, a server timestamp and the trimmed note', () => {
    const patch = extraTransition(pending, 'reject', actor, '  Use the 200A panel  ')
    assert.deepEqual(Object.keys(patch).sort(), ['rejectNotes', 'rejectedAt', 'rejectedBy', 'status'])
    assert.equal(patch.status, 'Rejected')
    assert.deepEqual(patch.rejectedBy, { uid: 'u1', email: 'dana@qbs.example', displayName: 'Dana Lee' })
    assert.equal(patch.rejectNotes, 'Use the 200A panel')
    assert.ok(isServerTime(patch.rejectedAt), 'rejectedAt is a server timestamp')
  })

  it('records only uid, email and display name of the actor', () => {
    const patch = extraTransition(pending, 'reject', { ...actor, token: 'secret', role: 'owner' }, 'note')
    assert.deepEqual(Object.keys(patch.rejectedBy).sort(), ['displayName', 'email', 'uid'])
  })

  it('requires a note', () => {
    for (const bad of [undefined, null, '', '   ', 7, {}, 'x'.repeat(1001)]) {
      assert.throws(() => extraTransition(pending, 'reject', actor, bad), code('invalid-argument', NOTE_REQUIRED))
    }
    assert.equal(NOTE_REQUIRED, 'Say what should be revised.')
  })

  it('refuses a draft and a decided extra even with a good note', () => {
    assert.throws(
      () => extraTransition({ status: 'Draft' }, 'reject', actor, 'note'),
      code('failed-precondition', 'This change order has not been sent for approval.'),
    )
    for (const status of ['Approved', 'approved', 'Rejected', 'rejected']) {
      assert.throws(
        () => extraTransition({ status }, 'reject', actor, 'note'),
        code('failed-precondition', 'This change order has already been decided.'),
        status,
      )
    }
  })
})

describe('extraTransition send', () => {
  it('sets Sent to Builder, the qbs flag and both send times, and nothing else', () => {
    const patch = extraTransition({ status: 'Draft' }, 'send', actor)
    assert.deepEqual(Object.keys(patch).sort(), ['qbs', 'qbsSentAt', 'sentAt', 'status'])
    assert.equal(patch.status, 'Sent to Builder')
    assert.equal(patch.qbs, true)
    assert.ok(isServerTime(patch.qbsSentAt), 'qbsSentAt is a server timestamp')
    assert.ok(isServerTime(patch.sentAt), 'sentAt is a server timestamp')
  })

  it('sends from a draft, a rejected extra (after a revision) and one already sent', () => {
    for (const status of ['Draft', 'Rejected', 'rejected', 'Sent to Builder', 'pending', undefined]) {
      assert.equal(extraTransition({ status }, 'send', actor).status, 'Sent to Builder', String(status))
    }
  })

  it('refuses an approved extra', () => {
    for (const status of ['Approved', 'approved']) {
      assert.throws(
        () => extraTransition({ status }, 'send', actor),
        code('failed-precondition', 'This change order is already approved.'),
        status,
      )
    }
  })
})

describe('extraTransition in general', () => {
  it('throws for an action it does not know', () => {
    for (const bad of ['archive', 'Approve', 'APPROVE', '', undefined, null, 5]) {
      assert.throws(() => extraTransition(pending, bad, actor, 'note'), /Unknown change order action/, String(bad))
    }
  })

  it('does not modify the extra or the actor', () => {
    const extra = { ...pending }
    const who = { ...actor }
    extraTransition(extra, 'approve', who)
    extraTransition(extra, 'reject', who, 'note')
    extraTransition(extra, 'send', who)
    assert.deepEqual(extra, pending)
    assert.deepEqual(who, actor)
  })
})

describe('extraActivity', () => {
  const sent = { id: 'CO-004', job: 'QBS-003', amount: 4100, status: 'Sent to Builder' }

  it('words an approval as a success notification and a history line', () => {
    assert.deepEqual(extraActivity(sent, 'approve', actor), {
      type: 'success',
      action: 'approved',
      msg: 'CO-004 approved by Dana Lee: $4,100 (QBS-003)',
      summary: 'CO-004 approved: $4,100',
    })
  })

  it('words a revision request as a warn notification, with the note cut to 80 and 60 characters', () => {
    const note = 'a'.repeat(100)
    const result = extraActivity(sent, 'reject', actor, `  ${note}  `)
    assert.equal(result.type, 'warn')
    assert.equal(result.action, 'rejected')
    assert.equal(result.msg, `CO-004 revision requested by Dana Lee (QBS-003): ${'a'.repeat(80)}`)
    assert.equal(result.summary, `CO-004 revision requested: ${'a'.repeat(60)}`)
  })

  it('puts a note with line breaks on one line', () => {
    const result = extraActivity(sent, 'reject', actor, 'Use the 200A panel.\n\nAdd a   sub panel.')
    assert.equal(result.msg, 'CO-004 revision requested by Dana Lee (QBS-003): Use the 200A panel. Add a sub panel.')
    assert.equal(result.summary, 'CO-004 revision requested: Use the 200A panel. Add a sub panel.')
  })

  it('keeps a short note whole', () => {
    const result = extraActivity(sent, 'reject', actor, 'Use the 200A panel')
    assert.equal(result.msg, 'CO-004 revision requested by Dana Lee (QBS-003): Use the 200A panel')
    assert.equal(result.summary, 'CO-004 revision requested: Use the 200A panel')
  })

  it('leaves the note out of a revision request that has none', () => {
    const result = extraActivity(sent, 'reject', actor)
    assert.equal(result.msg, 'CO-004 revision requested by Dana Lee (QBS-003)')
    assert.equal(result.summary, 'CO-004 revision requested')
  })

  it('words a send as an info notification, with no actor', () => {
    assert.deepEqual(extraActivity(sent, 'send', actor), {
      type: 'info',
      action: 'sent',
      msg: 'CO-004 sent to the builder: $4,100 (QBS-003)',
      summary: 'CO-004 sent to the builder: $4,100',
    })
  })

  it('names the change order by id, then by coNumber, then plainly', () => {
    assert.match(extraActivity({ coNumber: 'CO-2026-001', job: 'QBS-003' }, 'send', actor).msg, /^CO-2026-001 sent/)
    assert.match(extraActivity({ id: 'CO-004', coNumber: 'CO-2026-001' }, 'send', actor).msg, /^CO-004 sent/)
    assert.match(extraActivity({ job: 'QBS-003' }, 'send', actor).msg, /^CO sent/)
    assert.match(extraActivity({ id: '  ', coNumber: '', job: 'QBS-003' }, 'send', actor).msg, /^CO sent/)
  })

  it('uses total, then amount, then zero, formatted in whole dollars', () => {
    const msg = (extra) => extraActivity({ id: 'CO-1', job: 'J', ...extra }, 'send', actor).msg
    assert.equal(msg({ total: 12345.4, amount: 1 }), 'CO-1 sent to the builder: $12,345 (J)')
    assert.equal(msg({ amount: 2900 }), 'CO-1 sent to the builder: $2,900 (J)')
    assert.equal(msg({}), 'CO-1 sent to the builder: $0 (J)')
    assert.equal(msg({ total: null, amount: 'many' }), 'CO-1 sent to the builder: $0 (J)')
  })

  it('writes a credit in brackets, not with a minus sign', () => {
    const msg = extraActivity({ id: 'CO-5', job: 'J', total: -500 }, 'approve', actor).msg
    assert.equal(msg, 'CO-5 approved by Dana Lee: ($500) (J)')
    assertNoDashes(msg)
  })

  it('leaves the job out when the extra has none', () => {
    assert.equal(extraActivity({ id: 'CO-9', amount: 10 }, 'send', actor).msg, 'CO-9 sent to the builder: $10')
    assert.equal(extraActivity({ id: 'CO-9', amount: 10 }, 'approve', actor).msg, 'CO-9 approved by Dana Lee: $10')
  })

  it('throws for an action it does not know', () => {
    assert.throws(() => extraActivity(sent, 'archive', actor), /Unknown change order action/)
  })

  it('writes no dashes in any wording', () => {
    const note = 'Please add the 3 phase panel'
    for (const action of ['approve', 'reject', 'send']) {
      const result = extraActivity({ ...sent, coNumber: 'CO-2026-001' }, action, actor, note)
      assertNoDashes(result.msg)
      assertNoDashes(result.summary)
    }
  })
})

describe('totalOf and totalChanged', () => {
  it('reads the stored total as total, else amount, else 0', () => {
    assert.equal(totalOf({ total: 4200, amount: 4100 }), 4200)
    assert.equal(totalOf({ amount: 4100 }), 4100)
    assert.equal(totalOf({ total: 0, amount: 4100 }), 0)
    assert.equal(totalOf({}), 0)
    assert.equal(totalOf(null), 0)
  })

  it('is never a change when no expectedTotal was sent', () => {
    assert.equal(totalChanged({ amount: 4100 }, undefined), false)
  })

  it('compares the total sent with the stored one as numbers', () => {
    assert.equal(totalChanged({ amount: 4100 }, 4100), false)
    assert.equal(totalChanged({ amount: '4100' }, 4100), false)
    assert.equal(totalChanged({ total: 4200, amount: 4100 }, 4200), false)
    assert.equal(totalChanged({}, 0), false)
    assert.equal(totalChanged({ amount: 4100 }, 4000), true)
    assert.equal(totalChanged({ total: 4200, amount: 4100 }, 4100), true)
    assert.equal(totalChanged({ amount: 4100 }, 'abc'), true)
  })

  it('words the refusal without a dash', () => {
    assertNoDashes(TOTAL_CHANGED)
  })
})
