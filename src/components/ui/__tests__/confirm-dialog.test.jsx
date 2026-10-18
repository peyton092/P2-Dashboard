import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { ConfirmDialog } from '../confirm-dialog'

afterEach(cleanup)

function Page({ onConfirm = () => {}, onClose = () => {}, ...props }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Reject change order</button>
      <ConfirmDialog
        open={open}
        onClose={(...args) => { onClose(...args); setOpen(false) }}
        onConfirm={onConfirm}
        title="Reject this change order?"
        body="The builder is told it was rejected."
        {...props}
      />
    </>
  )
}

const openIt = async () => {
  const opener = screen.getByRole('button', { name: 'Reject change order' })
  act(() => { opener.focus() })
  fireEvent.click(opener)
  return screen.findByRole('dialog')
}
const actions = (dialog) =>
  [...dialog.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') !== 'Close')

describe('ConfirmDialog', () => {
  it('asks with its title and its body, and describes itself with the body', async () => {
    render(<Page />)
    const dialog = await openIt()

    expect(screen.getByRole('dialog', { name: 'Reject this change order?' })).toBe(dialog)
    const body = screen.getByText('The builder is told it was rejected.')
    expect(dialog.getAttribute('aria-describedby')).toBe(body.id)
  })

  it('has two buttons, Cancel first in the document and the confirm button after it', async () => {
    render(<Page />)
    const dialog = await openIt()

    expect(actions(dialog).map((button) => button.textContent)).toEqual(['Cancel', 'Confirm'])
  })

  it('puts focus on Cancel when it opens, so Enter does not confirm by accident', async () => {
    render(<Page />)
    await openIt()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
  })

  it('names the confirm button with confirmLabel', async () => {
    render(<Page confirmLabel="Reject it" />)
    const dialog = await openIt()

    expect(actions(dialog).map((button) => button.textContent)).toEqual(['Cancel', 'Reject it'])
  })

  it('calls onConfirm when the confirm button is pressed, and not onClose', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<Page onConfirm={onConfirm} onClose={onClose} />)
    await openIt()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onConfirm and onClose with nothing, so a handler never gets the click event', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<Page onConfirm={onConfirm} onClose={onClose} />)
    await openIt()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledWith()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledWith()
  })

  it('calls onClose, and never onConfirm, when Cancel is pressed', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<Page onConfirm={onConfirm} onClose={onClose} />)
    await openIt()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('calls onClose, and never onConfirm, when Escape is pressed', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<Page onConfirm={onConfirm} onClose={onClose} />)
    const dialog = await openIt()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('says Working and ignores a press while it is busy, and leaves Cancel alone', async () => {
    const onConfirm = vi.fn()
    render(<Page onConfirm={onConfirm} busy />)
    const dialog = await openIt()

    const [cancel, confirm] = actions(dialog)
    expect(confirm.textContent).toBe('Working')
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(cancel.hasAttribute('disabled')).toBe(false)
    expect(cancel.hasAttribute('aria-disabled')).toBe(false)
  })

  // A button that is natively disabled cannot hold focus, so pressing confirm with the
  // keyboard would drop focus to the page behind a modal dialog. While busy it is
  // aria-disabled instead, which keeps it in the tab order and tells a screen reader it
  // is off, and the press is ignored.
  it('is not natively disabled while it is busy, so it can keep focus', async () => {
    render(<Page busy />)
    const dialog = await openIt()

    const confirm = actions(dialog)[1]
    expect(confirm.hasAttribute('disabled')).toBe(false)
    expect(confirm.tabIndex).toBe(0)
  })

  // A page starts the work from onConfirm and sets busy, as the screens do.
  function Starts({ onConfirm }) {
    const [busy, setBusy] = useState(false)
    return <Page busy={busy} onConfirm={() => { onConfirm(); setBusy(true) }} />
  }

  it('keeps focus on the confirm button when the work starts', async () => {
    render(<Starts onConfirm={() => {}} />)
    await openIt()
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    act(() => { confirm.focus() })

    fireEvent.click(confirm)

    await waitFor(() => expect(confirm.textContent).toBe('Working'))
    expect(document.activeElement).toBe(confirm)
  })

  it('calls onConfirm once when it is pressed again while the work runs', async () => {
    const onConfirm = vi.fn()
    render(<Starts onConfirm={onConfirm} />)
    await openIt()
    const confirm = screen.getByRole('button', { name: 'Confirm' })

    fireEvent.click(confirm)
    await waitFor(() => expect(confirm.textContent).toBe('Working'))
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('announces Working in a status region while it is busy, and is quiet when it is not', async () => {
    const { rerender } = render(<Page />)
    await openIt()

    // The region is in the document before the work starts, which is what lets a
    // screen reader announce the text that arrives in it.
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    expect(status.classList.contains('sr-only')).toBe(true)

    rerender(<Page busy />)
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Working')

    rerender(<Page busy={false} />)
    expect(status.textContent).toBe('')
  })

  it('keeps the confirm label and an enabled button while it is not busy', async () => {
    render(<Page busy={false} confirmLabel="Reject it" />)
    const dialog = await openIt()

    const confirm = actions(dialog)[1]
    expect(confirm.textContent).toBe('Reject it')
    expect(confirm.hasAttribute('disabled')).toBe(false)
  })

  it('paints the confirm button in the brand color by default, with dark text', async () => {
    render(<Page />)
    const dialog = await openIt()

    const confirm = actions(dialog)[1]
    expect(confirm.classList.contains('bg-brand')).toBe(true)
    expect(confirm.classList.contains('text-brand-foreground')).toBe(true)
  })

  it('paints the confirm button as destructive for the critical tone', async () => {
    render(<Page tone="critical" />)
    const dialog = await openIt()

    const confirm = actions(dialog)[1]
    expect(confirm.classList.contains('bg-brand')).toBe(false)
    expect(confirm.classList.contains('text-destructive')).toBe(true)
  })

  it('has buttons that are 44 pixels tall under 768 pixels, from the footer they sit in', async () => {
    render(<Page />)
    const dialog = await openIt()

    for (const button of actions(dialog)) {
      expect(button.parentElement.classList.contains('max-md:[&>button]:min-h-11'), button.textContent).toBe(true)
    }
  })

  it('has no accessibility violations, busy or not', async () => {
    const { rerender } = render(<Page />)
    await openIt()
    expect(await axe(document.body)).toHaveNoViolations()

    rerender(<Page busy />)
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
