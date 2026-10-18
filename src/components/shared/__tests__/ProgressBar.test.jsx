import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'
import { ProgressBar } from '../ProgressBar'

afterEach(cleanup)

// jsdom writes a color back as rgb(), whatever the style was set with.
const rgb = (hex) => `rgb(${hexToRgb(hex).join(', ')})`
const fillOf = (container) => container.firstElementChild.firstElementChild

describe('ProgressBar', () => {
  it('fills to the value', () => {
    const { container } = render(<ProgressBar value={40} />)
    expect(fillOf(container).style.width).toBe('40%')
  })

  it('never fills past the ends of the bar', () => {
    expect(fillOf(render(<ProgressBar value={140} />).container).style.width).toBe('100%')
    cleanup()
    expect(fillOf(render(<ProgressBar value={-5} />).container).style.width).toBe('0%')
  })

  it('is the brand color unless it is told a tone', () => {
    const { container } = render(<ProgressBar value={40} />)
    expect(fillOf(container).style.backgroundColor).toBe(rgb(TONE_HEX.brand))
  })

  it.each(Object.entries(TONE_HEX))('paints the %s tone with the color of tokens.js', (tone, hex) => {
    const { container } = render(<ProgressBar value={40} tone={tone} />)
    expect(fillOf(container).style.backgroundColor).toBe(rgb(hex))
  })

  it('paints a tone it does not have as neutral', () => {
    const { container } = render(<ProgressBar value={40} tone="bogus" />)
    expect(fillOf(container).style.backgroundColor).toBe(rgb(TONE_HEX.neutral))
  })

  it('passes a class name to the track', () => {
    const { container } = render(<ProgressBar value={40} className="mt-2" />)
    expect(container.firstElementChild.classList.contains('mt-2')).toBe(true)
  })
})
