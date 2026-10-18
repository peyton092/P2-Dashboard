import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
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

  it('has nothing to draw until something asks, and the same dialog to draw after', () => {
    const { result } = renderHook(() => useConfirm())
    expect(result.current.dialog).toBeFalsy()

    act(() => { result.current.ask({ title: 'Disconnect QuickBooks?', onConfirm: () => {} }) })
    expect(result.current.dialog).toBeTruthy()
  })

  it('gives the same ask on every render', () => {
    const { result, rerender } = renderHook(() => useConfirm())
    const first = result.current.ask
    rerender()
    act(() => { result.current.ask({ title: 'Disconnect QuickBooks?', onConfirm: () => {} }) })
    expect(result.current.ask).toBe(first)
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

    it('closes when the work was saved on this device and is still to be sent, as run says offline', async () => {
      render(<Page onConfirm={() => Promise.resolve({ ok: true, value: undefined, queued: true })} />)
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

    it('runs the work once when the button is pressed again after the work went through, while the dialog is closing', async () => {
      const onConfirm = vi.fn(() => Promise.resolve({ ok: true }))
      render(<Page onConfirm={onConfirm} />)
      await openSettled()
      const button = confirmButton()

      await act(async () => { fireEvent.click(button) })
      fireEvent.click(button)

      expect(onConfirm).toHaveBeenCalledTimes(1)
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

    it('sets nothing and says nothing once the screen is gone, and the work still ran once', async () => {
      const work = deferred()
      const onConfirm = vi.fn(() => work.promise)
      const complaints = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { unmount } = render(<Page onConfirm={onConfirm} />)
      await openSettled()
      fireEvent.click(confirmButton())
      unmount()

      await act(async () => { work.resolve({ ok: true }) })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(complaints).not.toHaveBeenCalled()
      complaints.mockRestore()
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

  // The popup stays on the screen and focused through its exit, and Base UI gives focus back only
  // when it is gone, so a second Enter on the confirm button arrives while the dialog is closing,
  // or in the same turn as the first. For taking a line off a form that took the next line off
  // too. jsdom closes a dialog at once, so these call the handler the dialog was given, which is
  // what a press after the first one reaches.
  describe('a confirm that arrives after the question was answered', () => {
    const asked = (request) => {
      const rig = renderHook(() => useConfirm())
      act(() => { rig.result.current.ask({ title: 'Remove line 2?', confirmLabel: 'Remove line', ...request }) })
      return { ...rig, confirm: rig.result.current.dialog.props.onConfirm, cancel: rig.result.current.dialog.props.onClose }
    }

    it('runs an instant question once when it is confirmed three times in the same turn', async () => {
      const onConfirm = vi.fn()
      const { confirm } = asked({ instant: true, onConfirm })

      await act(async () => { confirm(); confirm(); confirm() })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('runs an instant question once when it is confirmed again after the first has finished', async () => {
      const onConfirm = vi.fn(() => Promise.resolve({ ok: true }))
      const { confirm } = asked({ instant: true, onConfirm })

      await act(async () => { await confirm() })
      await act(async () => { await confirm() })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('runs a server call once when it is confirmed again after it went through', async () => {
      const onConfirm = vi.fn(() => Promise.resolve({ ok: true }))
      const { confirm } = asked({ onConfirm })

      await act(async () => { await confirm() })
      await act(async () => { await confirm() })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('runs a server call once when it is confirmed three times in the same turn', async () => {
      const onConfirm = vi.fn(() => Promise.resolve({ ok: true }))
      const { confirm } = asked({ onConfirm })

      await act(async () => { confirm(); confirm(); confirm() })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('runs nothing when it is confirmed after it was cancelled', async () => {
      const onConfirm = vi.fn()
      const { confirm, cancel } = asked({ onConfirm })

      act(() => { cancel() })
      await act(async () => { await confirm() })

      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('still lets a server call that failed be confirmed again, which is what stays open for', async () => {
      const onConfirm = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
      const { confirm } = asked({ onConfirm })

      await act(async () => { await confirm() })
      await act(async () => { await confirm() })

      expect(onConfirm).toHaveBeenCalledTimes(2)
    })

    it('answers the next question afresh', async () => {
      const first = vi.fn()
      const second = vi.fn()
      const { result } = renderHook(() => useConfirm())
      act(() => { result.current.ask({ title: 'First?', instant: true, onConfirm: first }) })
      await act(async () => { await result.current.dialog.props.onConfirm() })

      act(() => { result.current.ask({ title: 'Second?', instant: true, onConfirm: second }) })
      await act(async () => { await result.current.dialog.props.onConfirm() })

      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)
    })
  })

  // One screen can serve two questions with one useConfirm (Settings does, for QuickBooks and
  // for CompanyCam). Cancel stays on while the work is out, so a person can cancel one and ask
  // the other before the first has ended.
  describe('with two questions asked of it one after the other', () => {
    function TwoAskers({ first, second }) {
      const { ask, dialog } = useConfirm()
      return (
        <>
          <button type="button" onClick={() => ask({ title: 'Disconnect QuickBooks?', confirmLabel: 'Disconnect', onConfirm: first })}>Ask QuickBooks</button>
          <button type="button" onClick={() => ask({ title: 'Disconnect CompanyCam?', confirmLabel: 'Disconnect', onConfirm: second })}>Ask CompanyCam</button>
          {dialog}
        </>
      )
    }
    // The buttons on the page are found again by their role, which the page has again only
    // once the dialog that hid it has gone.
    const askFor = async (name, title) => {
      fireEvent.click(await screen.findByRole('button', { name }))
      const dialog = await screen.findByRole('dialog', { name: title })
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
      return dialog
    }

    async function cancelledWhileWorking() {
      const quickBooks = deferred()
      const companyCam = vi.fn(() => Promise.resolve({ ok: true }))
      render(<TwoAskers first={() => quickBooks.promise} second={companyCam} />)
      await askFor('Ask QuickBooks', 'Disconnect QuickBooks?')
      fireEvent.click(confirmButton())
      expect(screen.getByRole('button', { name: 'Working' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await gone()
      return { quickBooks, companyCam }
    }

    it('opens the second question ready to answer, and not reading Working for work that is not its own', async () => {
      await cancelledWhileWorking()

      await askFor('Ask CompanyCam', 'Disconnect CompanyCam?')

      expect(screen.getByRole('button', { name: 'Disconnect' }).getAttribute('aria-disabled')).not.toBe('true')
      expect(screen.queryByRole('button', { name: 'Working' })).toBeNull()
      expect(screen.getByRole('status').textContent).toBe('')
    })

    it('keeps the second question open when the work of the first ends, whether it went through or failed', async () => {
      const { quickBooks, companyCam } = await cancelledWhileWorking()
      await askFor('Ask CompanyCam', 'Disconnect CompanyCam?')

      await act(async () => { quickBooks.resolve({ ok: true }) })

      expect(screen.getByRole('dialog', { name: 'Disconnect CompanyCam?' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Disconnect' }).getAttribute('aria-disabled')).not.toBe('true')
      expect(companyCam).not.toHaveBeenCalled()
    })

    it('answers the second question on its own work, when the first is still out', async () => {
      const { quickBooks, companyCam } = await cancelledWhileWorking()
      await askFor('Ask CompanyCam', 'Disconnect CompanyCam?')

      fireEvent.click(confirmButton())
      await gone()
      await act(async () => { quickBooks.resolve({ ok: false }) })

      expect(companyCam).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('does not let the first work, ending after the second began, take the second out of Working', async () => {
      const quickBooks = deferred()
      const companyCam = deferred()
      render(<TwoAskers first={() => quickBooks.promise} second={() => companyCam.promise} />)
      await askFor('Ask QuickBooks', 'Disconnect QuickBooks?')
      fireEvent.click(confirmButton())
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await gone()
      await askFor('Ask CompanyCam', 'Disconnect CompanyCam?')
      fireEvent.click(confirmButton())
      expect(screen.getByRole('button', { name: 'Working' })).toBeTruthy()

      await act(async () => { quickBooks.resolve({ ok: true }) })

      expect(screen.getByRole('button', { name: 'Working' })).toBeTruthy()
      await act(async () => { companyCam.resolve({ ok: true }) })
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
