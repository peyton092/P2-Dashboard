import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { extraState as onServer } from '../lib/extras.js'
import { extraState as inBrowser } from '../../src/lib/extraStatus.js'

// extraState exists twice, because the Cloud Functions and the browser are two
// runtimes that share no code: functions/lib/extras.js and src/lib/extraStatus.js.
// A status read differently on the two sides would let a portal offer a decision
// the function then refuses, or the reverse. This holds the two copies to the same
// answer over one table of inputs. The browser file is imported by this test only;
// nothing the functions deploy loads it.
const STATUSES = [
  // every spelling the screens, the functions and the demo data have written
  'Draft', 'Sent to Builder', 'Approved', 'Rejected', 'pending', 'approved', 'rejected',
  // the same words in other casing, which are not the stored ones
  'draft', 'DRAFT', 'sent to builder', 'Sent To Builder', 'Pending', 'PENDING',
  'APPROVED', 'REJECTED',
  // blanks, padding and text nobody writes
  '', ' ', ' Approved', 'Approved ', 'approved\n', 'Cancelled', 'sent-to-qbs', 'on hold', 'Void',
]

const NOT_TEXT = [undefined, null, 0, 1, 7, Number.NaN, true, false, [], ['Approved'], {}, { status: 'Approved' }, () => 'Approved']

const INPUTS = [
  ...STATUSES.map((status) => [{ status }]),
  ...NOT_TEXT.map((status) => [{ status }]),
  [{}],
  [{ id: 'CO-004', job: 'QBS-003', amount: 4100 }],
  [{ status: 'Approved', extra: 'fields', are: 'ignored' }],
  [null],
  [undefined],
  [7],
  ['Approved'],
  [[]],
]

const STATES = ['draft', 'pending', 'approved', 'rejected']

describe('extraState on the server and in the browser', () => {
  for (const [input] of INPUTS) {
    it(`agrees on ${inspect(input, { breakLength: Infinity })}`, () => {
      const fromServer = onServer(input)
      assert.ok(STATES.includes(fromServer), `the server answered ${inspect(fromServer)}`)
      assert.equal(inBrowser(input), fromServer)
    })
  }

  it('is checked over a table that reaches all four states', () => {
    const reached = new Set(INPUTS.map(([input]) => onServer(input)))
    assert.deepEqual([...reached].sort(), [...STATES].sort())
  })
})
