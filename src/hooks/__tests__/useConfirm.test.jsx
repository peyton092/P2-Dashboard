import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { useConfirm } from '../useConfirm'

// useConfirm is the question every consequential action asks first. A screen asks with
// ask({ title, body, confirmLabel, tone, onConfirm }) and puts dialog in its markup. These
// tests drive it as a screen does: a button asks, and onConfirm is the work, which the
// screens give as a run() of useMutation, so it resolves to { ok } and never rejects.

afterEach(cleanup)

// Resolves when the test says so, to look at the dialog in between.
function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

function Page({ onConfirm = () => {}, instant, asks = {} }) {
  const { ask, dialog } = useConfirm()
  return (
    <>
      <button
        type="button"
        onClick={() => ask({
          title: 'Disconnect QuickBooks?',
          body: 'Automatic sync of invoices stops until you reconnect.',
          confirmLabel: 'Disconnect',
          tone: 'critical',
          instant,
          onConfirm,
          ...asks,
        })}
      >
        Open the question
      </button>
      {dialog}
    </>
  )
}

const opener = () => screen.getByRole('button', { name: 'Open the question' })
// Focus the opener, as a keyboard user arrives at it, and open the dialog.
const openIt = async () => {
  act(() => { opener().focus() })
  fireEvent.click(opener())
  return screen.findByRole('dialog')
}
// Base UI puts focus inside a dialog on the next animation frame after it mounts. A test
// that moves focus or presses a button waits for that first, or the frame lands later on a
// slow machine, on top of what the test did.
const openSettled = async () => {
  const dialog = await openIt()
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
}
const confirmButton = () => screen.getByRole('button', { name: /^(Disconnect|Working)$/ })
const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

describe('useConfirm', () => {
  it('shows no dialog until something asks', () => {
    render(<Page />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks with the title and the body it was given, and offers Cancel and the confirm label', async () => {
    render(<Page />)
    const dialog = await openIt()

    expect(screen.getByRole('dialog', { name: 'Disconnect QuickBooks?' })).toBe(dialog)
    expect(screen.getByText('Automatic sync of invoices stops until you reconnect.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(confirmButton().textContent).toBe('Disconnect')
  })

  it('paints the confirm button as destructive for the critical tone, and in the brand color by default', async () => {
    const { unmount } = render(<Page />)
    await openIt()
    expect(confirmButton().classList.contains('text-destructive')).toBe(true)
    unmount()

    render(<Page asks={{ tone: undefined, confirmLabel: undefined, title: 'Submit this invoice?' }} />)
    await openIt()
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(confirm.classList.contains('bg-brand')).toBe(true)
  })

  it('does not call onConfirm when Cancel is pressed, and closes', async () => {
    const onConfirm = vi.fn()
    render(<Page onConfirm={onConfirm} />)
    await openSettled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not call onConfirm when Escape is pressed, and closes', async () => {
    const onConfirm = vi.fn()
    render(<Page onConfirm={onConfirm} />)
    const dialog = await openSettled()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await gone()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('returns focus to the control that asked when it closes', async () => {
    render(<Page />)
    await openSettled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await gone()

    await waitFor(() => expect(document.activeElement).toBe(opener()))
  })

  it('can be asked again after it was cancelled', async () => {
    render(<Page />)
    await openSettled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await gone()

    fireEvent.click(opener())
    expect(await screen.findByRole('dialog', { name: 'Disconnect QuickBooks?' })).toBeTruthy()
  })

  describe('when the work is a server call', () => {
    it('calls onConfirm once, with nothing, and reads Working while the work is out', async () => {
      const work = deferred()
      const onConfirm = vi.fn(() => work.promise)
      render(<Page onConfirm={onConfirm} />)
      await openSettled()

      fireEvent.click(confirmButton())

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm).toHaveBeenCalledWith()
      expect(screen.getByRole('button', { name: 'Working' }).getAttribute('aria-disabled')).toBe('true')
      expect(screen.getByRole('status').textContent).toBe('Working')
      expect(screen.getByRole('dialog')).toBeTruthy()

      await act(async () => { work.resolve({ ok: true }) })
      await gone()
    })

    it('closes when the work went through', async () => {
      render(<Page onConfirm={() => Promise.resolve({ ok: true, value: 1 })} />)
      await openSettled()

      fireEvent.click(confirmButton())

      await gone()
    })

    it('closes when onConfirm gives back nothing, as a plain function does', async () => {
      render(<Page onConfirm={() => Promise.resolve()} />)
      await openSettled()

      fireEvent.click(confirmButton())

      await gone()
    })

    it('stays open, with the confirm button back, when the work failed, so it can be tried again', async () => {
      const onConfirm = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Staff access required.' }).mockResolvedValueOnce({ ok: true })
      render(<Page onConfirm={onConfirm} />)
      await openSettled()

      fireEvent.click(confirmButton())
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' }).getAttribute('aria-disabled')).not.toBe('true'))
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole('status').textContent).toBe('')

      fireEvent.click(confirmButton())
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
      await gone()
    })

    it('calls onConfirm once when the button is pressed again while the work is out', async () => {
      const work = deferred()
      const onConfirm = vi.fn(() => work.promise)
      render(<Page onConfirm={onConfirm} />)
      await openSettled()

      fireEvent.click(confirmButton())
      fireEvent.click(screen.getByRole('button', { name: 'Working' }))
      fireEvent.click(screen.getByRole('button', { name: 'Working' }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      await act(async () => { work.resolve({ ok: true }) })
      await gone()
    })

    it('lets the person cancel while the work is out, and does not open the dialog again when it ends', async () => {
      const work = deferred()
      render(<Page onConfirm={() => work.promise} />)
      await openSettled()
      fireEvent.click(confirmButton())

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await gone()
      await act(async () => { work.resolve({ ok: false }) })

      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('does not set state once the screen is gone', async () => {
      const work = deferred()
      const { unmount } = render(<Page onConfirm={() => work.promise} />)
      await openSettled()
      fireEvent.click(confirmButton())
      unmount()

      await act(async () => { work.resolve({ ok: true }) })
    })
  })

  describe('when the work is instant', () => {
    it('closes at once, and runs the work', async () => {
      const work = deferred()
      const onConfirm = vi.fn(() => work.promise)
      render(<Page instant onConfirm={onConfirm} />)
      await openSettled()

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      await gone()
      expect(screen.queryByText('Working')).toBeNull()
      await act(async () => { work.resolve({ ok: true }) })
    })

    it('does not reopen when the work fails', async () => {
      render(<Page instant onConfirm={() => Promise.resolve({ ok: false })} />)
      await openSettled()

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

      await gone()
    })
  })

  it('has no accessibility violations while it asks, or while it works', async () => {
    const work = deferred()
    render(<Page onConfirm={() => work.promise} />)
    await openSettled()
    expect(await axe(document.body)).toHaveNoViolations()

    fireEvent.click(confirmButton())
    expect(await axe(document.body)).toHaveNoViolations()
    await act(async () => { work.resolve({ ok: true }) })
    await gone()
  })
})
