import { useEffect, useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { openSettled } from '@/test/dialog'
import { Dialog, DialogBody } from '@/components/ui/dialog'
import { ToastProvider } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
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

describe('the command palette, open', () => {
  it('is a modal dialog named Search, with focus in the search box', async () => {
    const { dialog } = await openPalette()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('lists the results as a listbox of options, and the search box points at the active one', async () => {
    const { box } = await openPalette()

    const list = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    expect(box.getAttribute('aria-controls')).toBe(list.id)
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id)
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', ...options.slice(1).map(() => 'false')])
  })

  it('moves the active option with the arrow keys, and opens it with Enter', async () => {
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

  it('closes on Escape and gives focus back to the control that opened it', async () => {
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

describe('the command palette and the keyboard', () => {
  const pressShortcut = (init) => fireEvent.keyDown(document.activeElement || document.body, { key: 'k', ...init })

  it.each([['ctrlKey'], ['metaKey']])('opens and closes with %s and K', async (modifier) => {
    renderPage()

    pressShortcut({ [modifier]: true })
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeTruthy()

    pressShortcut({ [modifier]: true })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull())
  })

  // A modal dialog holds focus in itself and hides the page from a screen reader, so a palette
  // opened over it would sit where nobody can reach it. The shortcut does nothing until the
  // dialog is closed.
  it.each([['ctrlKey'], ['metaKey']])('ignores %s and K while a modal dialog is open', async (modifier) => {
    render(
      <>
        <Dialog open onClose={() => {}} title="Edit job">
          <DialogBody><button type="button">Save job</button></DialogBody>
        </Dialog>
        <CommandPalette />
      </>,
    )
    const dialog = await openSettled('Edit job')

    pressShortcut({ [modifier]: true })
    // The palette puts focus in its box a moment after it opens, so the test waits as long.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    // The dialog hides the rest of the page from a screen reader, so a palette that opened
    // anyway would be hidden too, and is looked for among hidden elements.
    expect(screen.queryByRole('dialog', { name: 'Search', hidden: true })).toBeNull()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps Tab in the search box while it is open', async () => {
    const { box } = await openPalette()

    expect(fireEvent.keyDown(box, { key: 'Tab' })).toBe(false)
    expect(fireEvent.keyDown(box, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(box)
  })

  // The list scrolls to the active option when the arrow keys move it, and not when the
  // pointer does: a list that scrolls under a pointer moves the option away from it.
  it('scrolls to the active option when the keys move it, and not when the pointer does', async () => {
    const { box } = await openPalette()
    const options = screen.getAllByRole('option')

    fireEvent.mouseMove(options[3])
    expect(options[3].getAttribute('aria-selected')).toBe('true')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(options[4].getAttribute('aria-selected')).toBe('true')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('opens an option that is clicked, and keeps focus in the search box as it is pressed', async () => {
    const went = vi.fn()
    window.addEventListener('p2:navigate', went)
    try {
      await openPalette()
      const option = screen.getByRole('option', { name: /War Room/ })

      expect(fireEvent.mouseDown(option)).toBe(false)
      fireEvent.click(option)

      expect(went.mock.calls.map(([event]) => event.detail)).toEqual([{ id: 'war-room' }])
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      window.removeEventListener('p2:navigate', went)
    }
  })

  it('says so when nothing matches, and leaves the list closed', async () => {
    const { box } = await openPalette()

    fireEvent.change(box, { target: { value: 'nothing like this' } })

    expect(screen.getByRole('status').textContent).toBe('No matches.')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    expect(box.hasAttribute('aria-activedescendant')).toBe(false)
    expect(await axe(document.body)).toHaveNoViolations()
  })
})

// F8 takes focus to the newest toast, except while a modal dialog is open, which the toast
// layer knows by aria-modal. The palette is one, so F8 leaves focus in its search box.
describe('the command palette and the toasts', () => {
  function ShowsAToast() {
    const toast = useToast()
    const shown = useRef(false)
    useEffect(() => {
      if (shown.current) return
      shown.current = true
      toast({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} } })
    }, [toast])
    return null
  }

  it('keeps F8 from moving focus out of the open palette', async () => {
    render(
      <ToastProvider>
        <ShowsAToast />
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('p2:open-search'))}>Open search</button>
        <CommandPalette />
      </ToastProvider>,
    )
    const undo = await screen.findByRole('button', { name: 'Undo' })
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }))
    const box = await screen.findByLabelText('Search query')
    await waitFor(() => expect(document.activeElement).toBe(box))

    fireEvent.keyDown(document, { key: 'F8' })

    expect(document.activeElement).toBe(box)
    expect(document.activeElement).not.toBe(undo)
  })
})
