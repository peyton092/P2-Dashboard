import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { axe } from '@/test/axe'
import { BRAND, SEMANTIC, hexToRgb } from '@/lib/tokens'
import { ToastProvider } from '../toast'
import { useToast } from '../use-toast'
import { ConfirmDialog } from '../confirm-dialog'

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
// The toasts on the screen, in the order they were shown. A toast is a plain element with no
// live role of its own; what a screen reader is told is in the two live elements below.
const toastEls = () => [...region().querySelectorAll('[data-toast]')]
const toastEl = (index = 0) => toastEls()[index]
// The toast with these words, if one is on the screen. The words are also in a live element
// for as long as the toast is, so they are looked for in the toasts and not in the page.
const onScreen = (words) => toastEls().find((el) => el.textContent.includes(words)) ?? null
// The two live elements. Both are in the region from the first render and empty until a toast
// is shown, because a screen reader announces a live region reliably only when it was there
// before its content changed. role="alert" is the one exception, and an injected
// role="status" is commonly skipped.
const polite = () => region().querySelector('[role="status"]')
const assertive = () => region().querySelector('[role="alert"]')

describe('the notifications region', () => {
  it('is a labelled region that is there before any toast, and announces nothing itself', () => {
    setup()
    const found = region()
    expect(found.getAttribute('aria-live')).toBe('off')
    expect(found.textContent).toBe('')
  })

  it('has a polite and an assertive live element from the first render, both empty', () => {
    setup()
    expect(polite()).toBeTruthy()
    expect(assertive()).toBeTruthy()
    expect(polite().textContent).toBe('')
    expect(assertive().textContent).toBe('')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('keeps the same two live elements while toasts come and go', () => {
    const { show } = setup()
    const before = [polite(), assertive()]
    show({ title: 'Saved.' })
    show({ title: 'Failed.', tone: 'error' })
    tick(10000)
    expect(polite()).toBe(before[0])
    expect(assertive()).toBe(before[1])
  })

  it('sits above the bottom bars of a phone, and at the usual corner from 768 pixels', () => {
    setup()
    expect(region().classList.contains('max-md:bottom-20')).toBe(true)
    expect(region().classList.contains('bottom-4')).toBe(true)
  })

  // A modal dialog hides what is outside it from a screen reader, except a branch of the
  // page with an aria-live attribute in it. The toast about the work a dialog started has
  // to be read while the dialog is still open, or a refusal is shown and never heard.
  it('stays in view of a screen reader while a modal dialog is open, so a toast raised over it is heard', async () => {
    vi.useRealTimers()
    const { show } = setup()
    render(<ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="Disconnect QuickBooks?" />)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Page control' })).toBeNull()

    show({ title: 'Could not disconnect. Try again.', tone: 'error', duration: 0 })

    expect(screen.getByRole('alert').textContent).toContain('Could not disconnect. Try again.')
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy()
  })

  it('holds the toasts that are shown', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    show({ title: 'Sent.' })
    expect(toastEls().map((el) => el.textContent)).toEqual(['Saved.', 'Sent.'])
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
    expect(toastEl().textContent).toContain('Could not save the material. Try again.')
    expect(toastEl().textContent).toContain('Missing or insufficient permissions.')
  })

  it('takes a plain string as its title', () => {
    const { show } = setup()
    show('Saved.')
    expect(toastEl().textContent).toContain('Saved.')
  })

  it.each([['success'], ['info'], ['brand'], ['error'], [undefined]])('has no live role of its own for the %s tone, so a screen reader is not told twice', (tone) => {
    const { show } = setup()
    show({ title: 'Saved.', tone })
    expect(toastEl().hasAttribute('role')).toBe(false)
    expect(toastEl().querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull()
  })

  it('leaves one live element for each of polite and assertive, however many toasts there are', () => {
    const { show, container } = setup()
    show({ title: 'Saved.' })
    show({ title: 'Failed.', tone: 'error' })
    show({ title: 'Sent.' })
    const live = [...container.ownerDocument.querySelectorAll('[aria-live]')]
    expect(live.map((el) => el.getAttribute('aria-live'))).toEqual(['off'])
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
    expect(toastEl().style.borderLeftColor).toBe(rgb(hex))
  })

  it('shows the tone with an icon as well as a color', () => {
    const { show } = setup()
    show({ title: 'Saved.', tone: 'success' })
    expect(toastEl().querySelector('svg')).toBeTruthy()
  })

  it('is taken away by its dismiss button, which is named', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(onScreen('Saved.')).toBeNull()
  })

  it('has a dismiss button that is 44 pixels square under 768 pixels and shows a focus ring', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    expect(dismiss.classList.contains('max-md:size-11')).toBe(true)
    expect(dismiss.classList.contains('focus-visible:ring-2')).toBe(true)
  })
})

describe('what a screen reader is told', () => {
  it.each([['success'], ['info'], ['brand'], [undefined]])('says the words of a %s toast in the polite element, and nothing in the assertive one', (tone) => {
    const { show } = setup()
    show({ title: 'Saved.', tone })
    expect(polite().textContent).toBe('Saved.')
    expect(assertive().textContent).toBe('')
  })

  it('says the words of an error toast in the assertive element, and nothing in the polite one', () => {
    const { show } = setup()
    show({ title: 'Could not save.', tone: 'error' })
    expect(assertive().textContent).toBe('Could not save.')
    expect(polite().textContent).toBe('')
  })

  it('says the title and then the description', () => {
    const { show } = setup()
    show({ title: 'Could not save. Try again.', description: 'Staff access required.', tone: 'error' })
    expect(assertive().textContent).toBe('Could not save. Try again. Staff access required.')
  })

  it('ends words that have no full stop with one, so they do not run together', () => {
    const { show } = setup()
    show({ title: 'CompanyCam sync complete', description: '3 photos across 2 matched projects.' })
    expect(polite().textContent).toBe('CompanyCam sync complete. 3 photos across 2 matched projects.')
  })

  it('names the action of a toast and the key that reaches it', () => {
    const { show } = setup()
    show({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} } })
    expect(polite().textContent).toBe('Notification dismissed. Undo available, press F8.')
  })

  it('takes the words away when the toast is dismissed', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(polite().textContent).toBe('')
  })

  it('takes the words of an error away from the assertive element and leaves the polite one alone', () => {
    const { show } = setup()
    show({ title: 'Saved.', duration: 0 })
    show({ title: 'Failed.', tone: 'error' })
    tick(4000)
    expect(assertive().textContent).toBe('')
    expect(polite().textContent).toBe('Saved.')
  })

  it('takes the words away when the toast times out', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    tick(4000)
    expect(polite().textContent).toBe('')
  })

  it('says a second toast with the same words in a new node, so that it is announced again', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    const first = polite().firstElementChild
    show({ title: 'Saved.' })
    const second = polite().firstElementChild
    expect(second.textContent).toBe('Saved.')
    expect(second).not.toBe(first)
    expect(first.isConnected).toBe(false)
  })

  it('says the newest toast, and keeps saying it when an older one goes', () => {
    const { show } = setup()
    show({ title: 'First.', duration: 1000 })
    show({ title: 'Second.', duration: 0 })
    expect(polite().textContent).toBe('Second.')
    tick(1000)
    expect(toastEls()).toHaveLength(1)
    expect(polite().textContent).toBe('Second.')
  })
})

describe('how long a toast stays', () => {
  it('goes after 4 seconds by default', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    tick(3999)
    expect(onScreen('Saved.')).toBeTruthy()
    tick(1)
    expect(onScreen('Saved.')).toBeNull()
  })

  it('goes after 8 seconds when it carries an action', () => {
    const { show } = setup()
    show({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} } })
    tick(7999)
    expect(onScreen('Notification dismissed.')).toBeTruthy()
    tick(1)
    expect(onScreen('Notification dismissed.')).toBeNull()
  })

  it('goes after the duration it was given, with or without an action', () => {
    const { show } = setup()
    show({ title: 'Short.', duration: 1000 })
    show({ title: 'Long.', duration: 12000, action: { label: 'Undo', onClick: () => {} } })
    tick(1000)
    expect(onScreen('Short.')).toBeNull()
    expect(onScreen('Long.')).toBeTruthy()
    tick(10999)
    expect(onScreen('Long.')).toBeTruthy()
    tick(1)
    expect(onScreen('Long.')).toBeNull()
  })

  it('stays until it is dismissed when the duration is 0', () => {
    const { show } = setup()
    show({ title: 'Stays.', duration: 0 })
    tick(60000)
    expect(onScreen('Stays.')).toBeTruthy()
  })

  it('times each toast from when it appeared', () => {
    const { show } = setup()
    show({ title: 'First.' })
    tick(3000)
    show({ title: 'Second.' })
    tick(1000)
    expect(onScreen('First.')).toBeNull()
    expect(onScreen('Second.')).toBeTruthy()
    tick(3000)
    expect(onScreen('Second.')).toBeNull()
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
    expect(onScreen('Notification dismissed.')).toBeNull()
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
      expect(onScreen('Notification dismissed.')).toBeNull()
    })

    it('Escape on the action dismisses the toast without running the action', () => {
      const onClick = vi.fn()
      const { show } = setup()
      show(withUndo(onClick))
      const undo = screen.getByRole('button', { name: 'Undo' })
      act(() => { undo.focus() })

      fireEvent.keyDown(undo, { key: 'Escape' })

      expect(onScreen('Notification dismissed.')).toBeNull()
      expect(onClick).not.toHaveBeenCalled()
    })

    it('Escape on the dismiss button dismisses the toast', () => {
      const { show } = setup()
      show({ title: 'Saved.' })
      const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
      act(() => { dismiss.focus() })
      fireEvent.keyDown(dismiss, { key: 'Escape' })
      expect(onScreen('Saved.')).toBeNull()
    })

    it('Escape dismisses only the toast that has focus', () => {
      const { show } = setup()
      show(withUndo(vi.fn(), { title: 'First.' }))
      show(withUndo(vi.fn(), { title: 'Second.' }))
      const first = screen.getAllByRole('button', { name: 'Undo' })[0]
      act(() => { first.focus() })

      fireEvent.keyDown(first, { key: 'Escape' })

      expect(onScreen('First.')).toBeNull()
      expect(onScreen('Second.')).toBeTruthy()
    })

    it('Escape with focus somewhere else on the page leaves the toasts alone', () => {
      const { show } = setup()
      show({ title: 'Saved.' })
      const page = screen.getByRole('button', { name: 'Page control' })
      act(() => { page.focus() })
      fireEvent.keyDown(page, { key: 'Escape' })
      expect(onScreen('Saved.')).toBeTruthy()
    })

    it('other keys do nothing to the toast', () => {
      const { show } = setup()
      show(withUndo())
      const undo = screen.getByRole('button', { name: 'Undo' })
      act(() => { undo.focus() })
      fireEvent.keyDown(undo, { key: 'a' })
      fireEvent.keyDown(undo, { key: 'Tab' })
      expect(onScreen('Notification dismissed.')).toBeTruthy()
    })
  })
})

// The region is last in the page. F8 takes a person using the keyboard straight to the
// newest toast, so that the Undo on it can be reached before it goes.
describe('the F8 shortcut', () => {
  const withUndo = (over = {}) => ({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} }, ...over })
  // The page sends the key to the document, wherever focus is. Whether the page cancelled
  // it comes back: false when it did, true when it left the key to the browser.
  const pressF8 = (init = {}) => fireEvent.keyDown(document, { key: 'F8', ...init })

  it('names the key on the action button of a toast, and not on the region', () => {
    const { show } = setup()
    show(withUndo())
    expect(region().hasAttribute('aria-keyshortcuts')).toBe(false)
    expect(region().getAttribute('aria-label')).toBe('Notifications')
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-keyshortcuts')).toBe('F8')
  })

  it('names the key on the dismiss button that the key reaches, which is that of the newest toast when it has no action', () => {
    const { show } = setup()
    show({ title: 'Older.' })
    show({ title: 'Newest.' })
    const [older, newest] = screen.getAllByRole('button', { name: 'Dismiss notification' })
    expect(older.hasAttribute('aria-keyshortcuts')).toBe(false)
    expect(newest.getAttribute('aria-keyshortcuts')).toBe('F8')
  })

  it('does not name the key on the dismiss button of a toast whose action the key reaches', () => {
    const { show } = setup()
    show(withUndo())
    expect(screen.getByRole('button', { name: 'Dismiss notification' }).hasAttribute('aria-keyshortcuts')).toBe(false)
  })

  it('moves focus to the action of the newest toast', () => {
    const { show } = setup()
    show(withUndo({ title: 'First.' }))
    show(withUndo({ title: 'Second.' }))
    act(() => { screen.getByRole('button', { name: 'Page control' }).focus() })

    pressF8()

    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Undo' })[1])
  })

  it('moves focus to the dismiss button of a newest toast that has no action', () => {
    const { show } = setup()
    show({ title: 'Saved.' })

    pressF8()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss notification' }))
  })

  it('reaches an error toast too, which is an alert and not a status', () => {
    const { show } = setup()
    show({ title: 'Could not save.', tone: 'error' })

    pressF8()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss notification' }))
  })

  it('looks only in its own region, and not at other statuses on the page', () => {
    const { show } = setup()
    render(<div role="status"><button type="button">Elsewhere</button></div>)
    show(withUndo())

    pressF8()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }))
  })

  it('holds the toast still once focus is in it, and Enter then runs the action', () => {
    const onClick = vi.fn()
    const { show } = setup()
    show(withUndo({ action: { label: 'Undo', onClick } }))

    pressF8()
    tick(60000)
    expect(onScreen('Notification dismissed.')).toBeTruthy()

    pressEnter(document.activeElement)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onScreen('Notification dismissed.')).toBeNull()
  })

  it('keeps the key from the browser when it moves focus', () => {
    const { show } = setup()
    show(withUndo())
    expect(pressF8()).toBe(false)
  })

  it('does nothing, and leaves the key to the browser, when there is no toast', () => {
    setup()
    expect(pressF8()).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })

  it.each([['ctrlKey'], ['metaKey'], ['altKey'], ['shiftKey']])('leaves F8 to the browser when %s is held', (modifier) => {
    const { show } = setup()
    show(withUndo())
    expect(pressF8({ [modifier]: true })).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves other keys alone', () => {
    const { show } = setup()
    show(withUndo())
    expect(fireEvent.keyDown(document, { key: 'F7' })).toBe(true)
    expect(fireEvent.keyDown(document, { key: 'f' })).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })

  // A modal dialog keeps focus inside itself. F8 would take focus out of it, to a toast that
  // sits behind the dialog for a screen reader, and Escape there would close the dialog too.
  describe('while a modal dialog is open', () => {
    const dialogProps = { onClose: () => {}, onConfirm: () => {}, title: 'Disconnect QuickBooks?' }
    const cancel = () => screen.getByRole('button', { name: 'Cancel' })
    const initialFocusLanded = () => waitFor(() => expect(document.activeElement).toBe(cancel()))

    it('does nothing, and leaves the key to the browser, so focus stays in the dialog', async () => {
      vi.useRealTimers()
      const { show } = setup()
      render(<ConfirmDialog open {...dialogProps} />)
      await screen.findByRole('dialog')
      await initialFocusLanded()
      show(withUndo({ duration: 0 }))

      expect(pressF8()).toBe(true)

      expect(document.activeElement).toBe(cancel())
    })

    it('works again once the dialog has closed', async () => {
      vi.useRealTimers()
      const { show } = setup()
      const view = render(<ConfirmDialog open {...dialogProps} />)
      await screen.findByRole('dialog')
      await initialFocusLanded()
      view.rerender(<ConfirmDialog open={false} {...dialogProps} />)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      show(withUndo({ duration: 0 }))

      expect(pressF8()).toBe(false)

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }))
    })

    it('is not stopped by a dialog that is not modal', () => {
      const { show } = setup()
      render(<div role="dialog" aria-label="A panel"><button type="button">In the panel</button></div>)
      show(withUndo())

      expect(pressF8()).toBe(false)

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }))
    })
  })

  // After the page is gone the key finds no region, so pressing it would show nothing. What
  // matters is that the listener itself is taken off the document, and not left behind.
  it('takes its listener off the document when the toasts are gone from the page', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    try {
      const { unmount } = setup()
      const keydowns = (spy) => spy.mock.calls.filter(([type]) => type === 'keydown').length
      expect(keydowns(add)).toBeGreaterThan(0)
      unmount()
      expect(keydowns(remove)).toBe(keydowns(add))
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })
})

// The toast that has focus goes when its action is pressed, when Escape is pressed on it and
// when its dismiss button is. Nothing moves focus when it is gone, so it would fall to the
// page and the next Tab would start from the top. It goes back to the control it came from.
describe('focus when a toast that holds it closes', () => {
  const withUndo = (over = {}) => ({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} }, ...over })
  const pressF8 = () => fireEvent.keyDown(document, { key: 'F8' })
  const pageControl = () => screen.getByRole('button', { name: 'Page control' })
  const undo = (index = 0) => screen.getAllByRole('button', { name: 'Undo' })[index]

  it('goes back to the control it was on after F8 and the action', () => {
    const onClick = vi.fn()
    const { show } = setup()
    show(withUndo({ action: { label: 'Undo', onClick } }))
    act(() => { pageControl().focus() })

    pressF8()
    expect(document.activeElement).toBe(undo())
    pressEnter(undo())

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onScreen('Notification dismissed.')).toBeNull()
    expect(document.activeElement).toBe(pageControl())
  })

  it('goes back to the control it was on after F8 and Escape', () => {
    const onClick = vi.fn()
    const { show } = setup()
    show(withUndo({ action: { label: 'Undo', onClick } }))
    act(() => { pageControl().focus() })

    pressF8()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })

    expect(onScreen('Notification dismissed.')).toBeNull()
    expect(onClick).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(pageControl())
  })

  it('goes back to the control it was on after F8 and the dismiss button', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    act(() => { pageControl().focus() })

    pressF8()
    pressEnter(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(onScreen('Saved.')).toBeNull()
    expect(document.activeElement).toBe(pageControl())
  })

  it('goes back to the control focus came from when it entered the toast with Tab', () => {
    const { show } = setup()
    show(withUndo())
    act(() => { pageControl().focus() })

    pressTab()
    expect(document.activeElement).toBe(undo())
    fireEvent.keyDown(undo(), { key: 'Escape' })

    expect(document.activeElement).toBe(pageControl())
  })

  it('goes back to the control it came from when focus moved from one button of the toast to another first', () => {
    const { show } = setup()
    show(withUndo())
    act(() => { pageControl().focus() })
    pressF8()
    pressTab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss notification' }))

    fireEvent.keyDown(document.activeElement, { key: 'Escape' })

    expect(document.activeElement).toBe(pageControl())
  })

  it('goes back to the control it came from the last time, and not to an earlier one', () => {
    const { show } = setup()
    render(<button type="button">Other control</button>)
    show(withUndo())
    act(() => { pageControl().focus() })
    pressF8()
    act(() => { screen.getByRole('button', { name: 'Other control' }).focus() })

    act(() => { undo().focus() })
    fireEvent.keyDown(undo(), { key: 'Escape' })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Other control' }))
  })

  it('goes to the first button of the newest toast that is left when the control it came from is gone', () => {
    const { show } = setup()
    const elsewhere = render(<button type="button">Elsewhere</button>)
    show(withUndo({ title: 'First.' }))
    show(withUndo({ title: 'Second.' }))
    act(() => { screen.getByRole('button', { name: 'Elsewhere' }).focus() })
    pressF8()
    expect(document.activeElement).toBe(undo(1))
    elsewhere.unmount()

    fireEvent.keyDown(undo(1), { key: 'Escape' })

    expect(onScreen('Second.')).toBeNull()
    expect(document.activeElement).toBe(undo(0))
  })

  // The control that is given back is the one focus came from this time. A control from an
  // earlier visit is not given back to a person who has since come to a toast from nowhere.
  it('does not give back the control of an earlier visit when focus comes to a toast from nowhere', () => {
    const { show } = setup()
    show(withUndo({ title: 'First.' }))
    act(() => { pageControl().focus() })
    pressF8()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(document.activeElement).toBe(pageControl())
    act(() => { pageControl().blur() })
    show(withUndo({ title: 'Second.' }))

    act(() => { undo().focus() })
    fireEvent.keyDown(undo(), { key: 'Escape' })

    expect(document.activeElement).toBe(document.body)
  })

  it('forgets the control when focus leaves the toasts for another control, and comes back from nowhere', () => {
    const { show } = setup()
    render(<button type="button">Other control</button>)
    show(withUndo())
    act(() => { pageControl().focus() })
    pressF8()
    const other = screen.getByRole('button', { name: 'Other control' })
    act(() => { other.focus() })
    act(() => { other.blur() })

    act(() => { undo().focus() })
    fireEvent.keyDown(undo(), { key: 'Escape' })

    expect(document.activeElement).toBe(document.body)
  })

  it('goes to the newest of the toasts that are left, and not the oldest, when the control it came from is gone', () => {
    const { show } = setup()
    const elsewhere = render(<button type="button">Elsewhere</button>)
    show(withUndo({ title: 'First.' }))
    show(withUndo({ title: 'Second.' }))
    show(withUndo({ title: 'Third.' }))
    act(() => { screen.getByRole('button', { name: 'Elsewhere' }).focus() })
    pressF8()
    expect(document.activeElement).toBe(undo(2))
    elsewhere.unmount()

    fireEvent.keyDown(undo(2), { key: 'Escape' })

    expect(onScreen('Third.')).toBeNull()
    expect(document.activeElement).toBe(undo(1))
  })

  it('leaves focus alone when there is nowhere to send it', () => {
    const { show } = setup()
    const elsewhere = render(<button type="button">Elsewhere</button>)
    show(withUndo())
    act(() => { screen.getByRole('button', { name: 'Elsewhere' }).focus() })
    pressF8()
    elsewhere.unmount()

    fireEvent.keyDown(undo(), { key: 'Escape' })

    expect(onScreen('Notification dismissed.')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('moves nothing when the toast that goes does not hold focus', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    act(() => { pageControl().focus() })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(onScreen('Saved.')).toBeNull()
    expect(document.activeElement).toBe(pageControl())
  })

  it('moves nothing when a toast times out while focus is somewhere else', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    act(() => { pageControl().focus() })

    tick(4000)

    expect(onScreen('Saved.')).toBeNull()
    expect(document.activeElement).toBe(pageControl())
  })

  it('moves nothing for a toast that goes while focus is in another toast', () => {
    const { show } = setup()
    show({ title: 'First.', duration: 1000 })
    show(withUndo({ title: 'Second.', duration: 0 }))
    act(() => { pageControl().focus() })
    pressF8()

    tick(1000)

    expect(onScreen('First.')).toBeNull()
    expect(document.activeElement).toBe(undo())
  })
})

describe('pausing', () => {
  const withUndo = (over = {}) => ({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} }, ...over })

  it('does not run out while the pointer is over the toast, and starts over when it leaves', () => {
    const { show } = setup()
    show({ title: 'Saved.' })
    tick(3000)
    fireEvent.pointerEnter(toastEl())

    tick(60000)
    expect(onScreen('Saved.')).toBeTruthy()

    fireEvent.pointerLeave(toastEl())
    tick(3999)
    expect(onScreen('Saved.')).toBeTruthy()
    tick(1)
    expect(onScreen('Saved.')).toBeNull()
  })

  it('does not run out while focus is inside the toast, and starts over when it leaves', () => {
    const { show } = setup()
    show(withUndo())
    const undo = screen.getByRole('button', { name: 'Undo' })
    tick(5000)
    act(() => { undo.focus() })

    tick(60000)
    expect(onScreen('Notification dismissed.')).toBeTruthy()

    act(() => { screen.getByRole('button', { name: 'Page control' }).focus() })
    tick(7999)
    expect(onScreen('Notification dismissed.')).toBeTruthy()
    tick(1)
    expect(onScreen('Notification dismissed.')).toBeNull()
  })

  it('stays paused while focus moves from one button of the toast to another', () => {
    const { show } = setup()
    show(withUndo())
    act(() => { screen.getByRole('button', { name: 'Undo' }).focus() })
    act(() => { screen.getByRole('button', { name: 'Dismiss notification' }).focus() })
    tick(60000)
    expect(onScreen('Notification dismissed.')).toBeTruthy()
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
    expect(onScreen('Notification dismissed.')).toBeTruthy()

    fireEvent.blur(dismiss, { relatedTarget: screen.getByRole('button', { name: 'Page control' }) })
    tick(8000)
    expect(onScreen('Notification dismissed.')).toBeNull()
  })

  it('stays paused while either the pointer or the focus is in, and runs when both are out', () => {
    const { show } = setup()
    show(withUndo())
    fireEvent.pointerEnter(toastEl())
    act(() => { screen.getByRole('button', { name: 'Undo' }).focus() })
    fireEvent.pointerLeave(toastEl())
    tick(60000)
    expect(onScreen('Notification dismissed.')).toBeTruthy()

    act(() => { screen.getByRole('button', { name: 'Page control' }).focus() })
    tick(8000)
    expect(onScreen('Notification dismissed.')).toBeNull()
  })

  it('pauses one toast and leaves the others running', () => {
    const { show } = setup()
    show({ title: 'First.' })
    show({ title: 'Second.' })
    fireEvent.pointerEnter(toastEl(0))
    tick(4000)
    expect(onScreen('First.')).toBeTruthy()
    expect(onScreen('Second.')).toBeNull()
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

// Axe takes real time, so these run on the real clock, and the toasts stay until the test
// ends (duration 0) instead of racing the clock.
describe('accessibility', () => {
  it('has no violations with a success toast that carries an action', async () => {
    vi.useRealTimers()
    const { show, container } = setup()
    show({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} }, duration: 0 })
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })

  it('has no violations with an error toast and a description', async () => {
    vi.useRealTimers()
    const { show, container } = setup()
    show({ title: 'Could not save. Try again.', description: 'Staff access required.', tone: 'error', duration: 0 })
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })

  it('has no violations with an error and a success on the screen, and their words in the live elements', async () => {
    vi.useRealTimers()
    const { show, container } = setup()
    show({ title: 'Notification dismissed.', action: { label: 'Undo', onClick: () => {} }, duration: 0 })
    show({ title: 'Could not save. Try again.', description: 'Staff access required.', tone: 'error', duration: 0 })
    expect(polite().textContent).not.toBe('')
    expect(assertive().textContent).not.toBe('')
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })

  it('has no violations with no toast at all', async () => {
    vi.useRealTimers()
    const { container } = setup()
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations()
  })
})
