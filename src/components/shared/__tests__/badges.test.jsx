import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'
import {
  JOB_STATUS, INSPECTION_STATUS, PERMIT_STATUS, BILLING_STATUS, toneText,
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
    expect(pill.style.color).toBe(rgb(toneText(meta.tone)))
  })

  it.each(Object.entries(INSPECTION_STATUS))('InspectionBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<InspectionBadge status={status} />)
    expect(screen.getByText(meta.label).style.color).toBe(rgb(toneText(meta.tone)))
  })

  it.each(Object.entries(PERMIT_STATUS))('PermitBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<PermitBadge status={status} />)
    expect(screen.getByText(meta.label).style.color).toBe(rgb(toneText(meta.tone)))
  })

  it.each(Object.entries(BILLING_STATUS))('BillingBadge reads %s in the words and tone of the vocabulary', (status, meta) => {
    render(<BillingBadge status={status} />)
    expect(screen.getByText(meta.label).style.color).toBe(rgb(toneText(meta.tone)))
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

  it('says Unknown, muted, for a status the vocabulary does not have, in words that can be read', () => {
    render(<StatusBadge status="bogus" />)
    const pill = screen.getByText('Unknown')
    expect(pill.style.color).toBe(rgb(toneText('mute')))
    expect(pill.style.color).toBe(rgb(TONE_HEX.neutral))
  })
})

describe('Pill', () => {
  it.each(Object.keys(TONE_HEX))('sets the words of the %s tone in the text color of that tone', (tone) => {
    render(<Pill tone={tone}>Label</Pill>)
    expect(screen.getByText('Label').style.color).toBe(rgb(toneText(tone)))
  })

  it('sets muted words in the neutral gray, because the mute gray is too dim for text', () => {
    render(<Pill tone="mute">Label</Pill>)
    expect(screen.getByText('Label').style.color).toBe(rgb(TONE_HEX.neutral))
  })

  it('paints a tone it does not have as neutral', () => {
    render(<Pill tone="bogus">Label</Pill>)
    expect(screen.getByText('Label').style.color).toBe(rgb(TONE_HEX.neutral))
  })

  it('tints the fill and the border of a status tone with the tone itself, and not the lighter text color', () => {
    render(<Pill tone="critical">Label</Pill>)
    const { backgroundColor, borderColor } = screen.getByText('Label').style
    expect(backgroundColor).toBe('rgba(239, 68, 68, 0.13)')
    expect(borderColor).toBe('rgba(239, 68, 68, 0.33)')
  })
})

// The words of a pill are 9 to 11 pixels, so they need 4.5 to 1 against what is behind them:
// the pill's own tinted fill over the surface it sits on. A pill sits on the page, on a card
// or a dialog (surface 2), and in a row on a card (surface 3). jsdom draws nothing, so the
// ratio is worked out here, from the colors the pill sets and the surfaces index.css
// declares for the dark theme, by the WCAG formula.
describe('the words of a pill, on every surface', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../../../index.css'), 'utf8')
  const dark = css.slice(css.indexOf('.dark {'), css.indexOf('}', css.indexOf('.dark {')))
  const oklch = (property) => {
    const match = new RegExp(`${property}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(dark)
    return match.slice(1).map(Number)
  }
  // OKLCH to sRGB channels from 0 to 255 (Bjorn Ottosson's matrices).
  const srgb = ([L, C, h]) => {
    const a = C * Math.cos((h * Math.PI) / 180)
    const b = C * Math.sin((h * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    return linear.map((x) => 255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)))
  }
  const SURFACES = {
    page: srgb(oklch('--background')),
    'surface 2': srgb(oklch('--surface-2')),
    'surface 3': srgb(oklch('--surface-3')),
  }
  const channels = (color) => color.match(/[\d.]+/g).map(Number)
  const over = ([r, g, b, alpha = 1], under) => [r, g, b].map((c, i) => c * alpha + under[i] * (1 - alpha))
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (one, two) => {
    const [high, low] = [luminance(one), luminance(two)].sort((a, b) => b - a)
    return (high + 0.05) / (low + 0.05)
  }

  it('reads the three surfaces from index.css, darkest first', () => {
    const levels = Object.values(SURFACES).map(luminance)
    expect([...levels].sort((a, b) => a - b)).toEqual(levels)
    expect(levels[0]).toBeGreaterThan(0)
  })

  it('works the ratio out the way WCAG does', () => {
    expect(ratio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5)
    expect(ratio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2)
  })

  it.each(Object.keys(TONE_HEX).flatMap((tone) => Object.keys(SURFACES).map((surface) => [tone, surface])))(
    'gives the words of the %s pill at least 4.5 to 1 on the %s',
    (tone, surface) => {
      render(<Pill tone={tone}>Label</Pill>)
      const { color, backgroundColor } = screen.getByText('Label').style
      const fill = over(channels(backgroundColor), SURFACES[surface])
      expect(ratio(channels(color), fill), `${tone} on the ${surface}`).toBeGreaterThanOrEqual(4.5)
    },
  )
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
