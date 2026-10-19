import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/toast'
import { axe } from '@/test/axe'

// Clearing a notification is not asked about first, because it can be taken back: the
// toast that says it was dismissed carries an Undo button, and Undo writes the
// notification back as it was. Marking one read, and marking all read, tell the person
// the same way. Everything that would reach Firebase is replaced: the hooks module
// records the writes, and the toast is the real one, so the button pressed is the one a
// person sees.
const mocks = vi.hoisted(() => ({
  data: { notifs: [] },
  updateNotification: vi.fn(),
}))

vi.mock('../../firebase', () => ({
  auth: { currentUser: null },
  functions: {},
  db: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', async (importOriginal) => ({
  ...(await importOriginal()),
  updateNotification: mocks.updateNotification,
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import { Notifications } from '../../App'

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

const UNREAD = { _docId: 'n1', msg: 'QBS-003 electrical rough in passed', type: 'success', read: false, createdAt: { seconds: 1760000000 } }
const READ = { _docId: 'n2', msg: 'CO-004 approved', type: 'info', read: true, createdAt: { seconds: 1759990000 } }

beforeEach(() => {
  mocks.updateNotification.mockReset().mockResolvedValue(undefined)
  mocks.data = { notifs: [UNREAD, READ] }
})

afterEach(cleanup)

const open = () => render(<ToastProvider><Notifications /></ToastProvider>)
// An unread notification is a button, named by its message, that marks it read. A read one
// has nothing left to do but be cleared, so its message is text.
const card = (msg) => screen.getByRole('button', { name: `Unread notification: ${msg}` })
// The row of a notification, and the clear button in it, beside the message and not in it.
const row = (msg) => screen.getByText(msg).closest('li')
const clear = (msg) => within(row(msg)).getByRole('button', { name: 'Clear notification' })
const press = (el) => act(async () => { fireEvent.click(el) })
// The toasts are in their own region. The page header has a status of its own, the
// connection chip, which is not one of them.
const region = () => screen.getByRole('region', { name: 'Notifications' })
const toasts = () => [...region().querySelectorAll('[data-toast]')]
const toastText = () => region().textContent

describe('clearing a notification', () => {
  it('writes dismissed and read, and says so with an Undo button', async () => {
    open()
    await press(clear(UNREAD.msg))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(1)
    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { dismissed: true, read: true })
    expect(toastText()).toContain('Notification dismissed.')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('does not ask first: it is undoable instead of confirmed', async () => {
    open()
    await press(clear(UNREAD.msg))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('writes dismissed false when Undo is pressed, and says Undone', async () => {
    open()
    await press(clear(UNREAD.msg))

    await press(screen.getByRole('button', { name: 'Undo' }))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(2)
    expect(mocks.updateNotification).toHaveBeenLastCalledWith('n1', { dismissed: false, read: false })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(toastText()).toContain('Undone.')
  })

  it('puts a notification that was unread back as unread, and one that was read back as read', async () => {
    open()
    await press(clear(READ.msg))
    await press(screen.getByRole('button', { name: 'Undo' }))

    expect(mocks.updateNotification).toHaveBeenLastCalledWith('n2', { dismissed: false, read: true })
  })

  it('names the failure, with the reason, and offers no Undo, when the write fails', async () => {
    mocks.updateNotification.mockRejectedValue(sdkError('permission-denied', 'Staff access required.'))
    open()
    await press(clear(UNREAD.msg))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not dismiss the notification. Try again.')
    expect(alert.textContent).toContain('Staff access required.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('names the failure when Undo fails, and does not say Undone', async () => {
    open()
    await press(clear(UNREAD.msg))
    mocks.updateNotification.mockRejectedValue(sdkError('unavailable', 'The service is currently unavailable.'))

    await press(screen.getByRole('button', { name: 'Undo' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not undo. Try again.')
    expect(alert.textContent).toContain('The service is currently unavailable.')
    expect(toastText()).not.toContain('Undone.')
  })

  it('writes nothing for a notification that has no document', async () => {
    mocks.data = { notifs: [{ msg: 'No document yet', type: 'info', read: false }] }
    open()
    await press(clear('No document yet'))
    expect(mocks.updateNotification).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('marking read', () => {
  it('writes read for one notification when it is opened, and shows nothing else, since the dot goes', async () => {
    open()
    await press(card(UNREAD.msg))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(1)
    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { read: true })
    expect(toasts()).toHaveLength(0)
  })

  it('offers nothing to press for one that is read already, but its Clear', async () => {
    open()
    expect(screen.queryByRole('button', { name: new RegExp(READ.msg) })).toBeNull()
    expect(within(row(READ.msg)).getAllByRole('button').map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Clear notification'])
    expect(mocks.updateNotification).not.toHaveBeenCalled()
  })

  // Marking read takes the button away, so focus goes to the Clear button of the same row,
  // which stays, and the person keeps their place in the list.
  it('hands focus to the Clear button of the same row once the message is marked read', async () => {
    const { rerender } = open()
    act(() => { card(UNREAD.msg).focus() })
    await press(card(UNREAD.msg))
    mocks.data = { notifs: [{ ...UNREAD, read: true }, READ] }
    rerender(<ToastProvider><Notifications /></ToastProvider>)

    expect(document.activeElement).toBe(clear(UNREAD.msg))
  })

  it('describes each Clear button by the message it clears', () => {
    open()
    for (const msg of [UNREAD.msg, READ.msg]) {
      const button = clear(msg)
      expect(document.getElementById(button.getAttribute('aria-describedby')).textContent).toContain(msg)
    }
  })

  it('puts no control inside another, and has no accessibility violations', async () => {
    open()
    const list = row(UNREAD.msg).closest('ul')
    for (const button of within(list).getAllByRole('button')) {
      expect(button.querySelector('button, a, [role="button"]'), button.textContent).toBeNull()
    }
    expect(await axe(list)).toHaveNoViolations()
  })

  it('says it could not mark the notification read, with the reason, when the write fails', async () => {
    mocks.updateNotification.mockRejectedValue(sdkError('permission-denied', 'Staff access required.'))
    open()
    await press(card(UNREAD.msg))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not mark the notification read. Try again.')
    expect(alert.textContent).toContain('Staff access required.')
  })

  it('marks every unread notification read from the header, and says how many, with an Undo', async () => {
    mocks.data = { notifs: [UNREAD, { ...UNREAD, _docId: 'n3', msg: 'Another one' }, READ] }
    open()

    await press(screen.getByRole('button', { name: 'Mark all read' }))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(2)
    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { read: true })
    expect(mocks.updateNotification).toHaveBeenCalledWith('n3', { read: true })
    expect(toastText()).toContain('Marked 2 notifications read.')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('says one notification in the singular', async () => {
    open()
    await press(screen.getByRole('button', { name: 'Mark all read' }))
    expect(toastText()).toContain('Marked 1 notification read.')
  })

  it('puts the ones it marked back as unread when Undo is pressed', async () => {
    mocks.data = { notifs: [UNREAD, { ...UNREAD, _docId: 'n3', msg: 'Another one' }, READ] }
    open()
    await press(screen.getByRole('button', { name: 'Mark all read' }))
    mocks.updateNotification.mockClear()

    await press(screen.getByRole('button', { name: 'Undo' }))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(2)
    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { read: false })
    expect(mocks.updateNotification).toHaveBeenCalledWith('n3', { read: false })
    expect(toastText()).toContain('Undone.')
  })

  it('says it could not mark them read, with the reason, when a write fails', async () => {
    mocks.updateNotification.mockRejectedValue(sdkError('unavailable', 'The service is currently unavailable.'))
    open()
    await press(screen.getByRole('button', { name: 'Mark all read' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not mark the notifications read. Try again.')
    expect(alert.textContent).toContain('The service is currently unavailable.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
