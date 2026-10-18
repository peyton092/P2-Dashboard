import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'
import { hexToRgb } from '@/lib/tokens'
import { toneHex } from '@/lib/status'
import { useConnectionState } from '@/hooks/useConnectionState'
import { ConnectionChip } from '../ConnectionChip'

// The chip is shown for whatever the hook says, so the hook is replaced by a value
// each test chooses. What the hook says, and when, is tested with the hook.
vi.mock('@/hooks/useConnectionState', () => ({ useConnectionState: vi.fn() }))

// How jsdom writes an inline color: rgb(34, 197, 94) for the success green.
const rgb = (tone) => `rgb(${hexToRgb(toneHex(tone)).join(', ')})`

const STATES = [
  ['online', 'Live', 'success'],
  ['syncing', 'Syncing', 'warning'],
  ['offline', 'Offline', 'critical'],
]

beforeEach(() => {
  vi.mocked(useConnectionState).mockReturnValue('online')
})

afterEach(cleanup)

describe('ConnectionChip', () => {
  it.each(STATES)('shows %s as the word %s', (state, word) => {
    vi.mocked(useConnectionState).mockReturnValue(state)
    render(<ConnectionChip />)

    expect(screen.getByRole('status').textContent).toBe(word)
  })

  it.each(STATES)('paints %s as %s in one tone, for the text and for the dot', (state, _word, tone) => {
    vi.mocked(useConnectionState).mockReturnValue(state)
    render(<ConnectionChip />)

    const status = screen.getByRole('status')
    expect(status.firstElementChild.style.color).toBe(rgb(tone))
    expect(status.querySelector('[aria-hidden="true"]').style.backgroundColor).toBe(rgb(tone))
  })

  it('is a polite live region, so a change is announced without taking over the reader', () => {
    render(<ConnectionChip />)

    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  })

  it.each(STATES)('keeps the dot of %s out of the reading, because it is a picture and carries no state', (state) => {
    vi.mocked(useConnectionState).mockReturnValue(state)
    render(<ConnectionChip />)

    const dot = screen.getByRole('status').querySelector('[aria-hidden="true"]')
    expect(dot).not.toBeNull()
    expect(dot.textContent).toBe('')
  })

  it('changes the words inside the same region, so that a screen reader announces the change', () => {
    const { rerender } = render(<ConnectionChip />)
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('Live')

    vi.mocked(useConnectionState).mockReturnValue('offline')
    rerender(<ConnectionChip />)

    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toBe('Offline')
  })

  it.each(STATES)('has no accessibility violations when it reads %s', async (state) => {
    vi.mocked(useConnectionState).mockReturnValue(state)
    const { container } = render(<ConnectionChip />)

    expect(await axe(container)).toHaveNoViolations()
  })
})
