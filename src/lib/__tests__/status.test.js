import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TONE_HEX } from '@/lib/tokens'
import { extraState } from '@/lib/extraStatus'
import {
  JOB_STATUS, INSPECTION_STATUS, PERMIT_STATUS, BILLING_STATUS, CO_STATUS, MATERIAL_STATUS,
  SUB_STATUS, SEVERITY, NOTIF_TYPE, TRADE, PHASE,
  JOB_STATUS_OPTIONS, PHASE_OPTIONS,
  statusMeta, statusLabel, statusTone, statusColor, statusOptions,
  toneHex, toneText, normalizeCoStatus, isCoAwaitingBuilder, isJobComplete,
} from '../status'
import { isJobComplete as isJobCompleteFromJobs } from '../jobs'

// The whole vocabulary in one table, so that every rule below runs over every map.
const MAPS = {
  JOB_STATUS, INSPECTION_STATUS, PERMIT_STATUS, BILLING_STATUS, CO_STATUS, MATERIAL_STATUS,
  SUB_STATUS, SEVERITY, NOTIF_TYPE, TRADE, PHASE,
}

// Hyphen minus, the Unicode hyphens, every dash and the minus sign.
const DASH = /[-\u2010-\u2015\u2212]/

// Sentence case: the first word starts with a capital, and a later word is
// either all lower case or an acronym (HVAC).
function isSentenceCase(label) {
  const [first, ...rest] = label.split(' ')
  return /^[A-Z]/.test(first) && rest.every((word) => word === word.toLowerCase() || word === word.toUpperCase())
}

describe.each(Object.entries(MAPS))('%s', (_name, map) => {
  const entries = Object.entries(map)

  it('holds at least one status', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('gives %s a label, a tone from the palette and a position', (key, meta) => {
    expect(typeof meta.label).toBe('string')
    expect(meta.label.trim()).not.toBe('')
    expect(Object.hasOwn(TONE_HEX, meta.tone), `${key} has tone ${meta.tone}`).toBe(true)
    expect(Number.isFinite(meta.order)).toBe(true)
    expect(meta.order, 'a known status sorts before the unknown one').toBeLessThan(99)
  })

  it('gives every status its own position', () => {
    const orders = entries.map(([, meta]) => meta.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('writes no label with a dash in it', () => {
    for (const [key, meta] of entries) expect(meta.label, key).not.toMatch(DASH)
  })

  it('writes every label in sentence case, spaced once', () => {
    for (const [key, meta] of entries) {
      expect(isSentenceCase(meta.label), `${key} reads "${meta.label}"`).toBe(true)
      expect(meta.label, key).toBe(meta.label.trim().replace(/\s+/g, ' '))
    }
  })

  it('cannot be changed by a screen', () => {
    expect(Object.isFrozen(map)).toBe(true)
    for (const meta of Object.values(map)) expect(Object.isFrozen(meta)).toBe(true)
    expect(() => { map.invented = { label: 'x', tone: 'mute', order: 1 } }).toThrow(TypeError)
  })
})

describe('what the screens write', () => {
  it('knows every job status the app sets', () => {
    expect(Object.keys(JOB_STATUS).sort()).toEqual(
      ['active', 'at-risk', 'blocked', 'complete', 'completed', 'hold', 'needs-action', 'on-track', 'pending'],
    )
  })

  it('reads needs action as a warning and active as info, so no job status wears the brand color', () => {
    expect(JOB_STATUS['needs-action'].tone).toBe('warning')
    expect(JOB_STATUS.active.tone).toBe('info')
    expect(Object.entries(JOB_STATUS).filter(([, meta]) => meta.tone === 'brand')).toEqual([])
  })

  it('keeps the brand color off every status, and gives it to the electrical trade alone', () => {
    // The brand orange is for navigation, actions and the focus ring. Electrical keeps it
    // as the one recorded exception: a trade is an identity cue, and not a status.
    for (const [name, map] of Object.entries(MAPS)) {
      const wearing = Object.entries(map).filter(([, meta]) => meta.tone === 'brand').map(([key]) => key)
      expect(wearing, name).toEqual(name === 'TRADE' ? ['electrical'] : [])
    }
  })

  it('knows the inspection statuses a person can pick, and the two the data also holds', () => {
    for (const key of ['pending', 'scheduled', 'passed', 'failed', 'blocked', 'n/a', 'pending-verification', 'not-started']) {
      expect(Object.hasOwn(INSPECTION_STATUS, key), key).toBe(true)
    }
  })

  it('knows the five permit statuses the Permits screen offers', () => {
    expect(Object.keys(PERMIT_STATUS)).toEqual(['pending', 'applied', 'approved', 'finaled', 'denied'])
    expect(statusTone(PERMIT_STATUS, 'approved')).toBe('success')
    expect(statusTone(PERMIT_STATUS, 'denied')).toBe('critical')
  })

  it('knows the billing statuses, including a job on hold', () => {
    expect(Object.keys(BILLING_STATUS).sort()).toEqual(['hold', 'invoiced', 'not-invoiced', 'paid', 'partial-pay'])
    expect(BILLING_STATUS.hold.label).toBe('On hold')
    expect(BILLING_STATUS.hold.tone).toBe('warning')
  })

  it('keeps the change order keys as they are stored, with sentence case labels', () => {
    expect(Object.entries(CO_STATUS).map(([key, meta]) => [key, meta.label])).toEqual([
      ['Draft', 'Draft'],
      ['Sent to Builder', 'Sent to builder'],
      ['Approved', 'Approved'],
      ['Rejected', 'Rejected'],
    ])
  })

  it('keeps the material keys as they are stored', () => {
    expect(Object.keys(MATERIAL_STATUS)).toEqual(['Ordered', 'In Transit', 'Delivered', 'At Job Site', 'Used', 'Cancelled'])
    expect(MATERIAL_STATUS['In Transit'].label).toBe('In transit')
  })

  it('knows the three subcontractor statuses', () => {
    expect(Object.keys(SUB_STATUS)).toEqual(['active', 'done', 'issue'])
  })

  it('ranks severity most urgent first', () => {
    expect(['critical', 'warning', 'info'].map((key) => SEVERITY[key].order)).toEqual([0, 1, 2])
    expect(Object.keys(SEVERITY).sort((a, b) => SEVERITY[a].order - SEVERITY[b].order)).toEqual(['critical', 'warning', 'info'])
  })

  it('names the four notification types the app writes', () => {
    expect(Object.keys(NOTIF_TYPE).sort()).toEqual(['error', 'info', 'success', 'warn'])
  })

  it('names the three trades, in the order the app lists them', () => {
    expect(Object.entries(TRADE).map(([key, meta]) => [key, meta.label])).toEqual([
      ['electrical', 'Electrical'],
      ['plumbing', 'Plumbing'],
      ['hvac', 'HVAC'],
    ])
    expect(Object.values(TRADE).map((meta) => meta.tone)).toEqual(['brand', 'cyan', 'info'])
  })

  it('names the phases, in the order a job goes through them', () => {
    expect(Object.entries(PHASE).map(([key, meta]) => [key, meta.label])).toEqual([
      ['precon', 'Precon'],
      ['rough-in', 'Rough in'],
      ['service-release', 'Service release'],
      ['trim', 'Trim'],
      ['final', 'Final'],
      ['closeout', 'Closeout'],
      ['complete', 'Complete'],
    ])
    expect(Object.keys(PHASE).map((key) => PHASE[key].order)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('statusMeta', () => {
  it('returns the label, tone and position of a known status', () => {
    expect(statusMeta(JOB_STATUS, 'blocked')).toEqual({ label: 'Blocked', tone: 'critical', order: 0 })
    expect(statusMeta(INSPECTION_STATUS, 'passed').tone).toBe('success')
    expect(statusMeta(CO_STATUS, 'Sent to Builder').label).toBe('Sent to builder')
  })

  it('reads a status it does not know as Unknown, muted, and last', () => {
    expect(statusMeta(JOB_STATUS, 'bogus')).toEqual({ label: 'Unknown', tone: 'mute', order: 99 })
    expect(statusMeta(JOB_STATUS, 'bogus').label).toBe('Unknown')
  })

  it.each([[undefined], [null], [''], [7], [{}], ['On Track'], ['constructor'], ['toString'], ['__proto__']])(
    'reads %j as Unknown',
    (key) => {
      expect(statusMeta(JOB_STATUS, key)).toEqual({ label: 'Unknown', tone: 'mute', order: 99 })
    },
  )

  it('is the same answer for every map', () => {
    for (const map of Object.values(MAPS)) expect(statusMeta(map, 'bogus').label).toBe('Unknown')
  })

  it('has short forms for the label, the tone and the color', () => {
    expect(statusLabel(BILLING_STATUS, 'partial-pay')).toBe('Partial pay')
    expect(statusTone(BILLING_STATUS, 'partial-pay')).toBe('warning')
    expect(statusColor(BILLING_STATUS, 'partial-pay')).toBe(TONE_HEX.warning)
    expect(statusLabel(BILLING_STATUS, 'bogus')).toBe('Unknown')
    expect(statusTone(BILLING_STATUS, 'bogus')).toBe('mute')
    expect(statusColor(BILLING_STATUS, 'bogus')).toBe(TONE_HEX.mute)
  })
})

describe('toneHex', () => {
  it.each(Object.entries(TONE_HEX))('reads %s from tokens.js', (tone, hex) => {
    expect(toneHex(tone)).toBe(hex)
  })

  it('reads a tone the palette does not have as neutral', () => {
    for (const tone of ['bogus', undefined, null, '', 'constructor']) expect(toneHex(tone)).toBe(TONE_HEX.neutral)
  })
})

describe('toneText', () => {
  it('is toneHex, except that mute reads as neutral so that small text stays legible', () => {
    for (const tone of Object.keys(TONE_HEX)) {
      expect(toneText(tone)).toBe(tone === 'mute' ? TONE_HEX.neutral : TONE_HEX[tone])
    }
    expect(toneText('bogus')).toBe(TONE_HEX.neutral)
  })
})

describe('statusOptions', () => {
  it('lists every status of a map as a menu entry, in the order of the map', () => {
    expect(statusOptions(SEVERITY)).toEqual([
      { value: 'critical', label: 'Critical', tone: 'critical', order: 0 },
      { value: 'warning', label: 'Warning', tone: 'warning', order: 1 },
      { value: 'info', label: 'Info', tone: 'info', order: 2 },
    ])
  })

  it('sorts by position, whatever order the map was written in', () => {
    const shuffled = { b: { label: 'B', tone: 'mute', order: 2 }, a: { label: 'A', tone: 'mute', order: 1 } }
    expect(statusOptions(shuffled).map((option) => option.value)).toEqual(['a', 'b'])
  })

  it('offers every job status in the job menu', () => {
    expect(JOB_STATUS_OPTIONS.map((option) => option.value).sort()).toEqual(Object.keys(JOB_STATUS).sort())
  })

  it('offers every phase in the phase menu, in the order a job goes through them', () => {
    expect(PHASE_OPTIONS.map((option) => option.value)).toEqual(Object.keys(PHASE))
    expect(PHASE_OPTIONS.map((option) => option.label)).toEqual(
      ['Precon', 'Rough in', 'Service release', 'Trim', 'Final', 'Closeout', 'Complete'],
    )
  })
})

describe('normalizeCoStatus', () => {
  it.each([
    ['Draft', 'Draft'],
    ['Sent to Builder', 'Sent to Builder'],
    ['pending', 'Sent to Builder'],
    ['sent-to-qbs', 'Sent to Builder'],
    ['Approved', 'Approved'],
    ['approved', 'Approved'],
    ['Rejected', 'Rejected'],
    ['rejected', 'Rejected'],
  ])('reads status %j as %s', (raw, key) => {
    expect(normalizeCoStatus(raw)).toBe(key)
  })

  it('reads anything it does not recognize as waiting for a decision, as the server does', () => {
    // A lower case draft is not a draft to the Cloud Functions either: only the
    // Title Case 'Draft' is, and extraStatus.js is pinned to the server's copy.
    for (const raw of ['draft', 'APPROVED', 'Cancelled', 'Sent To Builder', '', undefined, null, 7, ['Approved']]) {
      expect(normalizeCoStatus(raw), String(raw)).toBe('Sent to Builder')
    }
  })

  it('always returns a key of CO_STATUS, and agrees with extraState', () => {
    const states = { draft: 'Draft', pending: 'Sent to Builder', approved: 'Approved', rejected: 'Rejected' }
    for (const raw of ['Draft', 'Sent to Builder', 'pending', 'sent-to-qbs', 'Approved', 'approved', 'Rejected', 'rejected', 'draft', 'junk', '', undefined]) {
      const key = normalizeCoStatus(raw)
      expect(Object.hasOwn(CO_STATUS, key), String(raw)).toBe(true)
      expect(key).toBe(states[extraState({ status: raw })])
    }
  })
})

describe('isCoAwaitingBuilder', () => {
  it.each([
    [{ status: 'Sent to Builder' }, true],
    [{ status: 'pending' }, true],
    [{ status: 'sent-to-qbs' }, true],
    [{}, true],
    [{ status: 'Draft' }, false],
    [{ status: 'Approved' }, false],
    [{ status: 'approved' }, false],
    [{ status: 'Rejected' }, false],
    [{ status: 'rejected' }, false],
  ])('reads %j as %s', (extra, awaiting) => {
    expect(isCoAwaitingBuilder(extra)).toBe(awaiting)
  })

  it('reads a missing change order as waiting, like extraState', () => {
    expect(isCoAwaitingBuilder(null)).toBe(true)
    expect(isCoAwaitingBuilder(undefined)).toBe(true)
  })
})

describe('isJobComplete', () => {
  it('is true for complete and completed only', () => {
    expect(isJobComplete({ status: 'complete' })).toBe(true)
    expect(isJobComplete({ status: 'completed' })).toBe(true)
    for (const status of ['on-track', 'active', 'hold', 'Complete', '', undefined]) {
      expect(isJobComplete({ status }), String(status)).toBe(false)
    }
  })

  it('is false for a missing job', () => {
    expect(isJobComplete(null)).toBe(false)
    expect(isJobComplete(undefined)).toBe(false)
  })

  it('is still exported by jobs.js, as the same function', () => {
    expect(isJobCompleteFromJobs).toBe(isJobComplete)
  })
})

describe('the source', () => {
  it('writes no color of its own: every hex comes from tokens.js', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../status.js'), 'utf8')
    expect(source.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
  })
})
