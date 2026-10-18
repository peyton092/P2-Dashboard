import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'
import {
  JOB_STATUS, INSPECTION_STATUS, PERMIT_STATUS, BILLING_STATUS,
} from '@/lib/status'

// The shared index also exports the inline edits, which reach for Firestore.
vi.mock('../../../hooks/useFirestore', () => ({ updateJob: vi.fn() }))

import * as shared from '../index'
import { Pill, StatusBadge, InspectionBadge, PermitBadge, BillingBadge } from '../badges'

afterEach(cleanup)

// jsdom writes a color back as rgb(), whatever the style was set with.
const rgb = (hex) => `rgb(${hexToRgb(hex).join(', ')})`

describe('the status badges', () => {
  it.each(Object.entries(JOB_STATUS))('StatusBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<StatusBadge status={status} />)
    const pill = screen.getByText(meta.label)
    expect(pill.style.color).toBe(rgb(TONE_HEX[meta.tone]))
  })

  it.each(Object.entries(INSPECTION_STATUS))('InspectionBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<InspectionBadge status={status} />)
    expect(screen.getByText(meta.label).style.color).toBe(rgb(TONE_HEX[meta.tone]))
  })

  it.each(Object.entries(PERMIT_STATUS))('PermitBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<PermitBadge status={status} />)
    expect(screen.getByText(meta.label).style.color).toBe(rgb(TONE_HEX[meta.tone]))
  })

  it.each(Object.entries(BILLING_STATUS))('BillingBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<BillingBadge status={status} />)
    expect(screen.getByText(meta.label).style.color).toBe(rgb(TONE_HEX[meta.tone]))
  })

  it('shows a job on hold as On hold, and not as not invoiced', () => {
    render(<BillingBadge status="hold" />)
    expect(screen.getByText('On hold')).toBeTruthy()
    expect(screen.queryByText('Not invoiced')).toBeNull()
  })

  it('reads a job with no billing status as not invoiced', () => {
    render(<BillingBadge />)
    expect(screen.getByText('Not invoiced')).toBeTruthy()
    cleanup()
    render(<BillingBadge status={null} />)
    expect(screen.getByText('Not invoiced')).toBeTruthy()
  })

  it('says Unknown, muted, for a status the vocabulary does not have', () => {
    render(<StatusBadge status="bogus" />)
    const pill = screen.getByText('Unknown')
    expect(pill.style.color).toBe(rgb(TONE_HEX.mute))
  })
})

describe('Pill', () => {
  it.each(Object.entries(TONE_HEX))('paints the %s tone with the color of tokens.js', (tone, hex) => {
    render(<Pill tone={tone}>Label</Pill>)
    expect(screen.getByText('Label').style.color).toBe(rgb(hex))
  })

  it('paints a tone it does not have as neutral', () => {
    render(<Pill tone="bogus">Label</Pill>)
    expect(screen.getByText('Label').style.color).toBe(rgb(TONE_HEX.neutral))
  })

  it('tints the fill and the border of a status tone with the same color', () => {
    render(<Pill tone="success">Label</Pill>)
    const { backgroundColor, borderColor } = screen.getByText('Label').style
    expect(backgroundColor).toBe('rgba(34, 197, 94, 0.13)')
    expect(borderColor).toBe('rgba(34, 197, 94, 0.33)')
  })
})

describe('the shared index', () => {
  it('exports the Pill based badges', () => {
    for (const name of ['Pill', 'StatusBadge', 'InspectionBadge', 'PermitBadge', 'BillingBadge', 'PriorityBadge']) {
      expect(typeof shared[name], name).toBe('function')
    }
  })

  it('exports none of the old badges or status tables', () => {
    for (const name of ['InspBadge', 'JobBadge', 'inspMeta', 'iMeta', 'statusMeta', 'sMeta']) {
      expect(shared[name], name).toBeUndefined()
    }
  })

  it('no longer has the two legacy files', () => {
    for (const file of ['legacy-badge-meta.js', 'legacy-badges.jsx']) {
      expect(existsSync(resolve(import.meta.dirname, '..', file)), file).toBe(false)
    }
  })
})
