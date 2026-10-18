import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  PHASE_MESSAGE,
  TRADE_PHASES,
  TRADE_MESSAGE,
  inspectionActivity,
  inspectionPatch,
  validateInspection,
} from '../lib/inspections.js'

const IDS = /[A-Z]+(-\d+)+/g
const assertNoDashes = (text) => {
  assert.doesNotMatch(text.replace(IDS, 'ID'), /[-‐-―−]/, `dash in: ${text}`)
}

describe('TRADE_PHASES', () => {
  it('lists the phases each trade is inspected in', () => {
    assert.deepEqual(TRADE_PHASES, {
      electrical: ['roughIn', 'trim', 'final'],
      plumbing: ['roughIn', 'final'],
      hvac: ['roughIn', 'final'],
    })
  })

  it('cannot be changed by a caller', () => {
    assert.ok(Object.isFrozen(TRADE_PHASES))
    assert.ok(Object.isFrozen(TRADE_PHASES.electrical))
  })
})

describe('validateInspection', () => {
  const good = { jobDocId: 'k3Jd9sLq0PzXv81AbCdE', trade: 'electrical', phase: 'roughIn' }

  it('accepts every trade with each of its phases', () => {
    for (const [trade, phases] of Object.entries(TRADE_PHASES)) {
      for (const phase of phases) {
        const checked = validateInspection({ ...good, trade, phase })
        assert.deepEqual(checked, { ok: true, value: { jobDocId: good.jobDocId, trade, phase } })
      }
    }
  })

  it('returns only the three fields, whatever else was sent', () => {
    const checked = validateInspection({ ...good, result: 'passed', insp: { x: 1 }, __proto__: { y: 1 } })
    assert.deepEqual(Object.keys(checked.value).sort(), ['jobDocId', 'phase', 'trade'])
  })

  it('refuses a missing or unusable job document id', () => {
    for (const jobDocId of [undefined, null, '', 'a/b', 5, '..']) {
      assert.deepEqual(validateInspection({ ...good, jobDocId }), { ok: false, message: 'Choose a job.' })
    }
  })

  it('refuses a trade that is not electrical, plumbing or HVAC', () => {
    for (const trade of [undefined, null, '', 'Electrical', 'roofing', 'constructor', '__proto__', 5]) {
      assert.deepEqual(validateInspection({ ...good, trade }), {
        ok: false,
        message: 'Choose electrical, plumbing or HVAC.',
      })
    }
  })

  it('refuses a phase the trade does not have, plumbing trim above all', () => {
    const message = 'That inspection phase does not exist for this trade.'
    assert.deepEqual(validateInspection({ ...good, trade: 'plumbing', phase: 'trim' }), { ok: false, message })
    assert.deepEqual(validateInspection({ ...good, trade: 'hvac', phase: 'trim' }), { ok: false, message })
    for (const phase of [undefined, null, '', 'Final', 'rough in', 'start', 'constructor', 5]) {
      assert.deepEqual(validateInspection({ ...good, phase }), { ok: false, message })
    }
  })

  it('checks the job first, then the trade, then the phase', () => {
    assert.equal(validateInspection({ jobDocId: '', trade: 'x', phase: 'y' }).message, 'Choose a job.')
    assert.equal(validateInspection({ jobDocId: 'j', trade: 'x', phase: 'y' }).message, 'Choose electrical, plumbing or HVAC.')
    assert.equal(validateInspection({ jobDocId: 'j', trade: 'hvac', phase: 'y' }).message, 'That inspection phase does not exist for this trade.')
  })

  it('refuses data that is not an object', () => {
    for (const bad of [undefined, null, 'x', 5, []]) {
      assert.deepEqual(validateInspection(bad), { ok: false, message: 'Choose a job.' })
    }
  })
})

describe('inspectionPatch', () => {
  const noon = new Date('2026-10-18T12:00:00Z')

  it('sets the phase result and its date with dotted field paths', () => {
    assert.deepEqual(inspectionPatch('electrical', 'roughIn', 'passed', noon), {
      'insp.electrical.roughIn': 'passed',
      'insp.electrical.roughInDate': '2026-10-18',
    })
    assert.deepEqual(inspectionPatch('hvac', 'final', 'failed', noon), {
      'insp.hvac.final': 'failed',
      'insp.hvac.finalDate': '2026-10-18',
    })
    assert.deepEqual(inspectionPatch('electrical', 'trim', 'passed', noon), {
      'insp.electrical.trim': 'passed',
      'insp.electrical.trimDate': '2026-10-18',
    })
  })

  // The day is the one on the calendar in Middle Tennessee (see lib/business-time.js),
  // which is five hours behind UTC in daylight time and six in standard time.
  describe('dates it by the day in Central time, not the UTC day', () => {
    const dated = (instant) => inspectionPatch('hvac', 'final', 'passed', new Date(instant))['insp.hvac.finalDate']

    it('keeps the evening on the day it happened', () => {
      assert.equal(dated('2026-10-18T23:59:59Z'), '2026-10-18')
      assert.equal(dated('2026-10-19T00:00:00Z'), '2026-10-18')
      assert.equal(dated('2026-10-19T00:05:00Z'), '2026-10-18')
    })

    it('turns the day over at local midnight, a second before and at it, in daylight time', () => {
      assert.equal(dated('2026-10-19T04:59:59Z'), '2026-10-18')
      assert.equal(dated('2026-10-19T05:00:00Z'), '2026-10-19')
    })

    it('turns the day over at local midnight, a second before and at it, in standard time', () => {
      assert.equal(dated('2026-01-06T05:59:59Z'), '2026-01-05')
      assert.equal(dated('2026-01-06T06:00:00Z'), '2026-01-06')
    })

    it('follows the change to and from daylight saving time', () => {
      assert.equal(dated('2026-03-09T04:59:59Z'), '2026-03-08')
      assert.equal(dated('2026-03-09T05:00:00Z'), '2026-03-09')
      assert.equal(dated('2026-11-02T05:59:59Z'), '2026-11-01')
      assert.equal(dated('2026-11-02T06:00:00Z'), '2026-11-02')
    })

    it('reads an instant written in another zone as the instant it is', () => {
      assert.equal(dated('2026-01-05T03:00:00-08:00'), '2026-01-05')
      assert.equal(dated('2026-01-05T22:30:00-08:00'), '2026-01-06')
    })
  })

  describe('with no time given', () => {
    afterEach(() => {
      mock.timers.reset()
    })

    it('uses the day it is now in Central time', () => {
      mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T00:30:00Z') })
      const patch = inspectionPatch('hvac', 'final', 'passed')
      assert.match(patch['insp.hvac.finalDate'], /^\d{4}-\d{2}-\d{2}$/)
      assert.equal(patch['insp.hvac.finalDate'], '2026-10-18')
    })
  })

  it('throws for a result other than passed or failed', () => {
    for (const bad of ['pending', 'Passed', undefined, null, '']) {
      assert.throws(() => inspectionPatch('hvac', 'final', bad, noon), /Unknown inspection result/, String(bad))
    }
  })
})

describe('inspectionActivity', () => {
  const job = { id: 'QBS-003' }

  it('words a pass as a success and a fail as an error', () => {
    assert.deepEqual(inspectionActivity(job, 'electrical', 'roughIn', 'passed'), {
      type: 'success',
      action: 'passed',
      msg: 'QBS-003 electrical rough in passed',
      summary: 'QBS-003 electrical rough in passed',
    })
    assert.deepEqual(inspectionActivity(job, 'electrical', 'roughIn', 'failed'), {
      type: 'error',
      action: 'failed',
      msg: 'QBS-003 electrical rough in failed',
      summary: 'QBS-003 electrical rough in failed',
    })
  })

  it('names every trade and phase in plain words', () => {
    assert.equal(inspectionActivity(job, 'plumbing', 'final', 'passed').msg, 'QBS-003 plumbing final passed')
    assert.equal(inspectionActivity(job, 'hvac', 'roughIn', 'failed').msg, 'QBS-003 HVAC rough in failed')
    assert.equal(inspectionActivity(job, 'electrical', 'trim', 'passed').msg, 'QBS-003 electrical trim passed')
    assert.deepEqual(TRADE_MESSAGE, { electrical: 'electrical', plumbing: 'plumbing', hvac: 'HVAC' })
    assert.deepEqual(PHASE_MESSAGE, { roughIn: 'rough in', trim: 'trim', final: 'final' })
  })

  it('falls back to Job when the job has no id', () => {
    assert.equal(inspectionActivity({}, 'hvac', 'final', 'passed').msg, 'Job HVAC final passed')
    assert.equal(inspectionActivity(null, 'hvac', 'final', 'passed').msg, 'Job HVAC final passed')
  })

  it('writes no dashes in any wording', () => {
    for (const [trade, phases] of Object.entries(TRADE_PHASES)) {
      for (const phase of phases) {
        for (const result of ['passed', 'failed']) {
          const { msg, summary } = inspectionActivity(job, trade, phase, result)
          assertNoDashes(msg)
          assertNoDashes(summary)
        }
      }
    }
  })
})
