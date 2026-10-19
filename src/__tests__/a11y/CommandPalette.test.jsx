import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import CommandPalette from '../../components/CommandPalette'

// The search that Ctrl or Cmd and K opens, open, read the way a screen reader and a keyboard
// read it. Its data comes from the data provider, which is replaced by a few records.
const mocks = vi.hoisted(() => ({
  data: {
    jobs: [{ id: 'QBS-003', name: 'Hillsboro Pike', address: '12 Main St', pm: 'Tim King' }],
    subs: [],
    extras: [],
    materials: [],
  },
}))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))

// jsdom draws nothing, so it has no scrollIntoView. The palette scrolls the active result
// into view; here that is a call that does nothing.
const scrollIntoView = Element.prototype.scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  Element.prototype.scrollIntoView = scrollIntoView
})

// The palette with a page behind it that has a control of its own, which opens it the way
// the sidebar's Search button does.
function renderPage() {
  render(
    <>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('p2:open-search'))}>Open search</button>
      <CommandPalette />
    </>,
  )
  return screen.getByRole('button', { name: 'Open search' })
}
async function openPalette() {
  const opener = renderPage()
  act(() => { opener.focus() })
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Search' })
  const box = screen.getByLabelText('Search query')
  await waitFor(() => expect(document.activeElement).toBe(box))
  return { opener, dialog, box }
}

// A test marked it.fails is one this screen does not pass yet. The change that makes it pass
// takes the mark off, in the same commit.

describe('the command palette, open', () => {
  it.fails('is a modal dialog named Search, with focus in the search box', async () => {
    const { dialog } = await openPalette()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it.fails('lists the results as a listbox of options, and the search box points at the active one', async () => {
    const { box } = await openPalette()

    const list = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    expect(box.getAttribute('aria-controls')).toBe(list.id)
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id)
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', ...options.slice(1).map(() => 'false')])
  })

  it.fails('moves the active option with the arrow keys, and opens it with Enter', async () => {
    const went = vi.fn()
    window.addEventListener('p2:navigate', went)
    try {
      const { box } = await openPalette()
      const options = screen.getAllByRole('option')

      fireEvent.keyDown(box, { key: 'ArrowDown' })
      expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id)
      fireEvent.keyDown(box, { key: 'ArrowUp' })
      fireEvent.keyDown(box, { key: 'ArrowDown' })
      expect(options[1].getAttribute('aria-selected')).toBe('true')

      fireEvent.keyDown(box, { key: 'Enter' })

      expect(went).toHaveBeenCalledTimes(1)
      expect(went.mock.calls[0][0].detail).toEqual({ id: 'war-room' })
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      window.removeEventListener('p2:navigate', went)
    }
  })

  it.fails('closes on Escape and gives focus back to the control that opened it', async () => {
    const { opener, box } = await openPalette()

    fireEvent.keyDown(box, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('has no accessibility violations, with the pages listed and with search results', async () => {
    const { box } = await openPalette()
    expect(await axe(document.body)).toHaveNoViolations()

    fireEvent.change(box, { target: { value: 'QBS' } })
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
