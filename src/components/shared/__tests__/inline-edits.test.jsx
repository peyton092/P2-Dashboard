import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { JOB_STATUS, PHASE, MATERIAL_STATUS, BILLING_STATUS } from '@/lib/status'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'

// Base UI shows its focus guards to VoiceOver as buttons when jsdom's vendor
// says Apple. Nothing here depends on that, but the select test does the same.
vi.hoisted(() => {
  Object.defineProperty(window.navigator, 'vendor', { value: 'Google Inc.', configurable: true })
})

const mocks = vi.hoisted(() => ({ updateJob: vi.fn() }))
vi.mock('../../../hooks/useFirestore', () => ({ updateJob: mocks.updateJob }))

import {
  InlineStatusSelect, InlinePhaseSelect, BillingStatusSelect, MatStatusBadge,
} from '../inline-edits'

const rgb = (hex) => `rgb(${hexToRgb(hex).join(', ')})`

beforeEach(() => { mocks.updateJob.mockReset() })
afterEach(cleanup)

// The closed select, found by its role. There is one per render.
const trigger = () => screen.getByRole('combobox')
// What the select says, without the arrow beside it.
const shown = () => trigger().querySelector('[data-slot="select-value"]').textContent
const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)
async function open() {
  fireEvent.click(trigger())
  await screen.findByRole('listbox')
}
// A person points at an option before pressing it, and the list only takes a
// press on the option it has under the pointer.
function choose(name) {
  const option = screen.getByRole('option', { name })
  fireEvent.pointerMove(option)
  fireEvent.mouseMove(option)
  fireEvent.click(option)
}

describe('InlineStatusSelect', () => {
  const job = { _docId: 'job1', status: 'on-track' }

  it('shows the words of the status, and not the stored key', () => {
    render(<InlineStatusSelect job={job} />)
    expect(shown()).toBe('On track')
    expect(trigger().style.color).toBe(rgb(TONE_HEX.success))
  })

  it('offers every job status, most urgent first', async () => {
    render(<InlineStatusSelect job={job} />)
    await open()
    expect(optionNames()).toEqual([
      'Blocked', 'On hold', 'At risk', 'Needs action', 'Active', 'On track', 'Pending', 'Complete', 'Completed',
    ])
    expect(optionNames()).toHaveLength(Object.keys(JOB_STATUS).length)
  })

  it('stores the key of the status that was chosen', async () => {
    render(<InlineStatusSelect job={job} />)
    await open()
    choose('On hold')
    expect(mocks.updateJob).toHaveBeenCalledTimes(1)
    expect(mocks.updateJob).toHaveBeenCalledWith('job1', { status: 'hold' })
  })

  it('stores nothing for a job with no document', async () => {
    render(<InlineStatusSelect job={{ status: 'on-track' }} />)
    await open()
    choose('Blocked')
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('says Unknown for a status the vocabulary does not have', () => {
    render(<InlineStatusSelect job={{ _docId: 'job1', status: 'bogus' }} />)
    expect(shown()).toBe('Unknown')
  })
})

describe('InlinePhaseSelect', () => {
  it('offers every phase, in the order a job goes through them', async () => {
    render(<InlinePhaseSelect job={{ _docId: 'job1', phase: 'Trim' }} />)
    await open()
    expect(optionNames()).toEqual(['Precon', 'Rough in', 'Service release', 'Trim', 'Final', 'Closeout', 'Complete'])
  })

  it.each([
    ['Rough-In', 'Rough in'],
    ['Service Release', 'Service release'],
    ['service-release', 'Service release'],
    ['Rough in', 'Rough in'],
  ])('shows a stored phase %j as %s', (phase, words) => {
    render(<InlinePhaseSelect job={{ _docId: 'job1', phase }} />)
    expect(shown()).toBe(words)
  })

  it('shows a phase it does not know as written, without its hyphens', () => {
    render(<InlinePhaseSelect job={{ _docId: 'job1', phase: 'rough-in-passed' }} />)
    expect(shown()).toBe('Rough in passed')
  })

  it('shows a phase for a job with none, from how far along it is, in words with no dash', () => {
    render(<InlinePhaseSelect job={{ _docId: 'job1', progress: 10 }} />)
    expect(shown()).not.toMatch(/[-\u2010-\u2015\u2212]/)
    expect(shown()).toBe('Rough in phase')
  })

  // The HVAC alert reads a stored service-release as the service being obtained,
  // which choosing the phase does not mean. The menu has always stored the words.
  it('stores the words of the phase and never its key', async () => {
    render(<InlinePhaseSelect job={{ _docId: 'job1', phase: 'Trim' }} />)
    await open()
    choose('Service release')
    expect(mocks.updateJob).toHaveBeenCalledWith('job1', { phase: 'Service release' })
    expect(JSON.stringify(mocks.updateJob.mock.calls)).not.toContain('service-release')
    expect(Object.keys(PHASE)).toContain('service-release')
  })
})

describe('BillingStatusSelect', () => {
  it('shows a job with no billing status as not invoiced', () => {
    render(<BillingStatusSelect job={{ _docId: 'job1' }} />)
    expect(shown()).toBe('Not invoiced')
  })

  it('shows a job on hold as On hold in the hold tone', () => {
    render(<BillingStatusSelect job={{ _docId: 'job1', billingStatus: 'hold' }} />)
    expect(shown()).toBe('On hold')
    expect(trigger().style.color).toBe(rgb(TONE_HEX[BILLING_STATUS.hold.tone]))
  })

  it('offers the four statuses a person picks, and leaves hold to the billing queue', async () => {
    render(<BillingStatusSelect job={{ _docId: 'job1', billingStatus: 'invoiced' }} />)
    await open()
    expect(optionNames()).toEqual(['Not invoiced', 'Invoiced', 'Partial pay', 'Paid'])
  })

  it('stores the key of the status that was chosen', async () => {
    render(<BillingStatusSelect job={{ _docId: 'job1', billingStatus: 'invoiced' }} />)
    await open()
    choose('Partial pay')
    expect(mocks.updateJob).toHaveBeenCalledWith('job1', { billingStatus: 'partial-pay' })
  })
})

describe('MatStatusBadge', () => {
  const onUpdate = vi.fn()
  beforeEach(() => onUpdate.mockReset())

  it('shows the words of the status, in sentence case', () => {
    render(<MatStatusBadge status="In Transit" docId="m1" onUpdate={onUpdate} />)
    expect(shown()).toBe('In transit')
    expect(trigger().style.color).toBe(rgb(TONE_HEX[MATERIAL_STATUS['In Transit'].tone]))
  })

  it('reads an older lower case status as the one it stands for', () => {
    render(<MatStatusBadge status="in-transit" docId="m1" onUpdate={onUpdate} />)
    expect(shown()).toBe('In transit')
  })

  it('offers the six statuses a material can have', async () => {
    render(<MatStatusBadge status="Ordered" docId="m1" onUpdate={onUpdate} />)
    await open()
    expect(optionNames()).toEqual(['Ordered', 'In transit', 'Delivered', 'At job site', 'Used', 'Cancelled'])
  })

  it('stores the key as the materials screen stores it', async () => {
    render(<MatStatusBadge status="Ordered" docId="m1" onUpdate={onUpdate} />)
    await open()
    choose('At job site')
    expect(onUpdate).toHaveBeenCalledWith('m1', 'At Job Site')
  })
})

describe('the source', () => {
  it('writes no color of its own', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../inline-edits.jsx'), 'utf8')
    expect(source.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
  })
})
