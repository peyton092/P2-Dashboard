import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import { axe } from '@/test/axe'
import { BRAND, SEMANTIC, hexToRgb } from '@/lib/tokens'
import { ToastProvider } from '../toast'
import { useToast } from '../use-toast'

// Every test here runs on fake timers for setTimeout alone, so none of them waits for real
// time: the clock moves when the test moves it, inside act.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })

// A page with one control on it, and a way for the test to show a toast.
function Rig({ toastRef }) {
  const toast = useToast()
  useEffect(() => { toastRef.current = toast }, [toast, toastRef])
  return <button type="button">Page control</button>
}

function setup() {
  const toastRef = { current: null }
  const view = render(<ToastProvider><Rig toastRef={toastRef} /></ToastProvider>)
  const show = (options) => {
    let id
    act(() => { id = toastRef.current(options) })
    return id
  }
  return { show, ...view }
}

// jsdom has no Tab key. This does what a browser does with one: it moves focus to the next
// tabbable element in document order, or the previous one with shift.
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
function pressTab({ shift = false } = {}) {
  const stops = [...document.querySelectorAll(TABBABLE)]
  const at = stops.indexOf(document.activeElement)
  const next = stops[(at + (shift ? -1 : 1) + stops.length) % stops.length]
  act(() => { next.focus() })
}

// jsdom does not turn Enter on a button into a click. A browser does: it sends the key, and
// clicks the button unless the page cancelled the key.
function pressEnter(el) {
  const proceeded = fireEvent.keyDown(el, { key: 'Enter' })
  if (proceeded) fireEvent.click(el)
}

const region = () => screen.getByRole('region', { name: 'Notifications' })
const rgb = (hex) => `rgb(${hexToRgb(hex).join(', ')})`

describe('the notifications region', () => {
  it('is a labelled region that is there before any toast, and has no live region of its own', () => {
    setup()
    const found = region()
    expect(found.hasAttribute('aria-live')).toBe(false)
    expect(found.textContent).toBe('')
  })

  it('holds the toasts that are shown', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    show({ title: 'Sent.' })
    expect(within(region()).getAllByRole('status').map((el) => el.textContent.replace('Dismiss notification', ''))).toEqual(['Saved.', 'Sent.'])
  })

  it('takes the toast layer from the scale', () => {
    setup()
    expect(region().classList.contains('z-(--z-toast)')).toBe(true)
  })
})

describe('a toast', () => {
  it('shows its title and its description', () => {
    const { show } = setup()
    show({ title: 'Could not save the material. Try again.', description: 'Missing or insufficient permissions.', tone: 'error' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not save the material. Try again.')
    expect(alert.textContent).toContain('Missing or insufficient permissions.')
  })

  it('takes a plain string as its title', () => {
    const { show } = setup()
    show('Saved.')
    expect(screen.getByRole('status').textContent).toContain('Saved.')
  })

  it.each([['success'], ['info'], ['brand'], [undefined]])('is a status for the %s tone, which a screen reader reads politely', (tone) => {
    const { show } = setup()
    show({ title: 'Saved.', tone })
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is an alert for the error tone, which a screen reader reads at once', () => {
    const { show } = setup()
    show({ title: 'Could not save.', tone: 'error' })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('gives each toast the one role and no live region above it, so nothing is read twice', () => {
    const { show, container } = setup()
    show({ title: 'Saved.' })
    show({ title: 'Failed.', tone: 'error' })
    expect(container.ownerDocument.querySelectorAll('[aria-live]').length).toBe(0)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it.each([
    ['success', SEMANTIC.success],
    ['error', SEMANTIC.critical],
    ['info', SEMANTIC.info],
    ['brand', BRAND],
  ])('marks the %s tone with its token color on the left edge', (tone, hex) => {
    const { show } = setup()
    show({ title: 'Saved.', tone })
    const toast = screen.getByRole(tone === 'error' ? 'alert' : 'status')
    expect(toast.style.borderLeftColor).toBe(rgb(hex))
  })

  it('shows the tone with an icon as well as a color', () => {
    const { show } = setup()
    show({ title: 'Saved.', tone: 'success' })
    expect(screen.getByRole('status').querySelector('svg')).toBeTruthy()
  })

  it('is taken away by its dismiss button, which is named', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('has a dismiss button that is 44 pixels square under 768 pixels and shows a focus ring', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    expect(dismiss.classList.contains('max-md:size-11')).toBe(true)
    expect(dismiss.classList.contains('focus-visible:ring-2')).toBe(true)
  })
})

describe('how long a toast stays', () => {
  it('goes after 4 seconds by default', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    tick(3999)
    expect(screen.queryByText('Saved.')).toBeTruthy()
    tick(1)
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('goes after 8 seconds when it carries an action', () => {
    const { show } = setup()
    show({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} } })
    tick(7999)
    expect(screen.queryByText('Notification dismissed.')).toBeTruthy()
    tick(1)
    expect(screen.queryByText('Notification dismissed.')).toBeNull()
  })

  it('goes after the duration it was given, with or without an action', () => {
    const { show } = setup()
    show({ title: 'Short.', duration: 1000 })
    show({ title: 'Long.', duration: 12000, action: { label: 'Undo', onClick: () => {} } })
    tick(1000)
    expect(screen.queryByText('Short.')).toBeNull()
    expect(screen.queryByText('Long.')).toBeTruthy()
    tick(10999)
    expect(screen.queryByText('Long.')).toBeTruthy()
    tick(1)
    expect(screen.queryByText('Long.')).toBeNull()
  })

  it('stays until it is dismissed when the duration is 0', () => {
    const { show } = setup()
    show({ title: 'Stays.', duration: 0 })
    tick(60000)
    expect(screen.queryByText('Stays.')).toBeTruthy()
  })

  it('times each toast from when it appeared', () => {
    const { show } = setup()
    show({ title: 'First.' })
    tick(3000)
    show({ title: 'Second.' })
    tick(1000)
    expect(screen.queryByText('First.')).toBeNull()
    expect(screen.queryByText('Second.')).toBeTruthy()
    tick(3000)
    expect(screen.queryByText('Second.')).toBeNull()
  })

  it('clears its timer when it is dismissed, and when the provider goes', () => {
    const { show, unmount } = setup()
    show({ title: 'Saved.' })
    expect(vi.getTimerCount()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(vi.getTimerCount()).toBe(0)

    show({ title: 'Again.' })
    show({ title: 'And again.', action: { label: 'Undo', onClick: () => {} } })
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('an action', () => {
  const withUndo = (onClick = vi.fn(), over = {}) => ({ title: 'Notification dismissed.', action: { label: 'Undo', onClick }, ...over })

  it('is a button with the label it was given', () => {
    const { show } = setup()
    show(withUndo())
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo.tagName).toBe('BUTTON')
    expect(undo.getAttribute('type')).toBe('button')
  })

  it('runs its onClick once when it is pressed, and takes the toast away', () => {
    const onClick = vi.fn()
    const { show } = setup()
    show(withUndo(onClick))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Notification dismissed.')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not run its onClick until it is pressed', () => {
    const onClick = vi.fn()
    const { show } = setup()
    show(withUndo(onClick))
    tick(7999)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('has a target 44 pixels tall under 768 pixels and a visible focus ring', () => {
    const { show } = setup()
    show(withUndo())
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo.classList.contains('max-md:min-h-11')).toBe(true)
    expect(undo.classList.contains('focus-visible:ring-2')).toBe(true)
  })

  it('shows no action button for a toast that has none', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    expect(screen.getAllByRole('button').map((el) => el.getAttribute('aria-label') || el.textContent)).toEqual(['Page control', 'Dismiss notification'])
  })

  describe('from the keyboard', () => {
    it('is reached with Tab, before the dismiss button, and Enter runs it', () => {
      const onClick = vi.fn()
      const { show } = setup()
      show(withUndo(onClick))

      act(() => { screen.getByRole('button', { name: 'Page control' }).focus() })
      pressTab()
      const undo = screen.getByRole('button', { name: 'Undo' })
      expect(document.activeElement).toBe(undo)
      pressTab()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss notification' }))
      pressTab({ shift: true })
      expect(document.activeElement).toBe(undo)

      pressEnter(undo)
      expect(onClick).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Notification dismissed.')).toBeNull()
    })

    it('Escape on the action dismisses the toast without running the action', () => {
      const onClick = vi.fn()
      const { show } = setup()
      show(withUndo(onClick))
      const undo = screen.getByRole('button', { name: 'Undo' })
      act(() => { undo.focus() })

      fireEvent.keyDown(undo, { key: 'Escape' })

      expect(screen.queryByText('Notification dismissed.')).toBeNull()
      expect(onClick).not.toHaveBeenCalled()
    })

    it('Escape on the dismiss button dismisses the toast', () => {
      const { show } = setup()
      show({ title: 'Saved.' })
      const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
      act(() => { dismiss.focus() })
      fireEvent.keyDown(dismiss, { key: 'Escape' })
      expect(screen.queryByText('Saved.')).toBeNull()
    })

    it('Escape dismisses only the toast that has focus', () => {
      const { show } = setup()
      show(withUndo(vi.fn(), { title: 'First.' }))
      show(withUndo(vi.fn(), { title: 'Second.' }))
      const first = screen.getAllByRole('button', { name: 'Undo' })[0]
      act(() => { first.focus() })

      fireEvent.keyDown(first, { key: 'Escape' })

      expect(screen.queryByText('First.')).toBeNull()
      expect(screen.queryByText('Second.')).toBeTruthy()
    })

    it('Escape with focus somewhere else on the page leaves the toasts alone', () => {
      const { show } = setup()
      show({ title: 'Saved.' })
      const page = screen.getByRole('button', { name: 'Page control' })
      act(() => { page.focus() })
      fireEvent.keyDown(page, { key: 'Escape' })
      expect(screen.queryByText('Saved.')).toBeTruthy()
    })

    it('other keys do nothing to the toast', () => {
      const { show } = setup()
      show(withUndo())
      const undo = screen.getByRole('button', { name: 'Undo' })
      act(() => { undo.focus() })
      fireEvent.keyDown(undo, { key: 'a' })
      fireEvent.keyDown(undo, { key: 'Tab' })
      expect(screen.queryByText('Notification dismissed.')).toBeTruthy()
    })
  })
})

describe('pausing', () => {
  const withUndo = (over = {}) => ({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} }, ...over })
  const toastEl = () => screen.getByRole('status')

  it('does not run out while the pointer is over the toast, and starts over when it leaves', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    tick(3000)
    fireEvent.pointerEnter(toastEl())

    tick(60000)
    expect(screen.queryByText('Saved.')).toBeTruthy()

    fireEvent.pointerLeave(toastEl())
    tick(3999)
    expect(screen.queryByText('Saved.')).toBeTruthy()
    tick(1)
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('does not run out while focus is inside the toast, and starts over when it leaves', () => {
    const { show } = setup()
    show(withUndo())
    const undo = screen.getByRole('button', { name: 'Undo' })
    tick(5000)
    act(() => { undo.focus() })

    tick(60000)
    expect(screen.queryByText('Notification dismissed.')).toBeTruthy()

    act(() => { screen.getByRole('button', { name: 'Page control' }).focus() })
    tick(7999)
    expect(screen.queryByText('Notification dismissed.')).toBeTruthy()
    tick(1)
    expect(screen.queryByText('Notification dismissed.')).toBeNull()
  })

  it('stays paused while focus moves from one button of the toast to another', () => {
    const { show } = setup()
    show(withUndo())
    act(() => { screen.getByRole('button', { name: 'Undo' }).focus() })
    act(() => { screen.getByRole('button', { name: 'Dismiss notification' }).focus() })
    tick(60000)
    expect(screen.queryByText('Notification dismissed.')).toBeTruthy()
  })

  // The browser sends the blur of the button focus leaves before the focus of the one it
  // goes to, with the second as the relatedTarget of the first. Each event is its own
  // render, so a toast that took the blur for leaving would run its timer for an instant.
  it('is not left running by the blur of a button when focus is going to the other button', () => {
    const { show } = setup()
    show(withUndo())
    const undo = screen.getByRole('button', { name: 'Undo' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    act(() => { undo.focus() })

    fireEvent.blur(undo, { relatedTarget: dismiss })
    tick(60000)
    expect(screen.queryByText('Notification dismissed.')).toBeTruthy()

    fireEvent.blur(dismiss, { relatedTarget: screen.getByRole('button', { name: 'Page control' }) })
    tick(8000)
    expect(screen.queryByText('Notification dismissed.')).toBeNull()
  })

  it('stays paused while either the pointer or the focus is in, and runs when both are out', () => {
    const { show } = setup()
    show(withUndo())
    fireEvent.pointerEnter(toastEl())
    act(() => { screen.getByRole('button', { name: 'Undo' }).focus() })
    fireEvent.pointerLeave(toastEl())
    tick(60000)
    expect(screen.queryByText('Notification dismissed.')).toBeTruthy()

    act(() => { screen.getByRole('button', { name: 'Page control' }).focus() })
    tick(8000)
    expect(screen.queryByText('Notification dismissed.')).toBeNull()
  })

  it('pauses one toast and leaves the others running', () => {
    const { show } = setup()
    show({ title: 'First.' })
    show({ title: 'Second.' })
    fireEvent.pointerEnter(screen.getAllByRole('status')[0])
    tick(4000)
    expect(screen.queryByText('First.')).toBeTruthy()
    expect(screen.queryByText('Second.')).toBeNull()
  })

  it('has no timer running while it is paused', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    fireEvent.pointerEnter(toastEl())
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.pointerLeave(toastEl())
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('accessibility', () => {
  it('has no violations with a success toast that carries an action', async () => {
    vi.useRealTimers()
    const { show, container } = setup()
    show({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} } })
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })

  it('has no violations with an error toast and a description', async () => {
    vi.useRealTimers()
    const { show, container } = setup()
    show({ title: 'Could not save. Try again.', description: 'Staff access required.', tone: 'error' })
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })

  it('has no violations with no toast at all', async () => {
    vi.useRealTimers()
    const { container } = setup()
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })
})
