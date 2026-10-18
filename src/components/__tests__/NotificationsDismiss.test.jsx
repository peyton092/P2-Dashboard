import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/toast'

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
const card = (msg, unread) => screen.getByRole('button', { name: `${unread ? 'Unread notification' : 'Notification'}: ${msg}` })
// The clear button in the card of a notification.
const clear = (msg, unread) => within(card(msg, unread)).getByRole('button', { name: 'Clear notification' })
const press = (el) => act(async () => { fireEvent.click(el) })
// The toasts are in their own region. The page header has a status of its own, the
// connection chip, which is not one of them.
const region = () => screen.getByRole('region', { name: 'Notifications' })
const toasts = () => [...region().querySelectorAll('[data-toast]')]
const toastText = () => region().textContent

describe('clearing a notification', () => {
  it('writes dismissed and read, and says so with an Undo button', async () => {
    open()
    await press(clear(UNREAD.msg, true))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(1)
    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { dismissed: true, read: true })
    expect(toastText()).toContain('Notification dismissed.')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('does not ask first: it is undoable instead of confirmed', async () => {
    open()
    await press(clear(UNREAD.msg, true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('writes dismissed false when Undo is pressed, and says Undone', async () => {
    open()
    await press(clear(UNREAD.msg, true))

    await press(screen.getByRole('button', { name: 'Undo' }))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(2)
    expect(mocks.updateNotification).toHaveBeenLastCalledWith('n1', { dismissed: false, read: false })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(toastText()).toContain('Undone.')
  })

  it('puts a notification that was unread back as unread, and one that was read back as read', async () => {
    open()
    await press(clear(READ.msg, false))
    await press(screen.getByRole('button', { name: 'Undo' }))

    expect(mocks.updateNotification).toHaveBeenLastCalledWith('n2', { dismissed: false, read: true })
  })

  it('names the failure, with the reason, and offers no Undo, when the write fails', async () => {
    mocks.updateNotification.mockRejectedValue(sdkError('permission-denied', 'Staff access required.'))
    open()
    await press(clear(UNREAD.msg, true))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not dismiss the notification. Try again.')
    expect(alert.textContent).toContain('Staff access required.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('names the failure when Undo fails, and does not say Undone', async () => {
    open()
    await press(clear(UNREAD.msg, true))
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
    await press(clear('No document yet', true))
    expect(mocks.updateNotification).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('marking read', () => {
  it('writes read for one notification when it is opened, and shows nothing else, since the dot goes', async () => {
    open()
    await press(card(UNREAD.msg, true))

    expect(mocks.updateNotification).toHaveBeenCalledTimes(1)
    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { read: true })
    expect(toasts()).toHaveLength(0)
  })

  it('writes nothing for one that is read already', async () => {
    open()
    await press(card(READ.msg, false))
    expect(mocks.updateNotification).not.toHaveBeenCalled()
  })

  it('says it could not mark the notification read, with the reason, when the write fails', async () => {
    mocks.updateNotification.mockRejectedValue(sdkError('permission-denied', 'Staff access required.'))
    open()
    await press(card(UNREAD.msg, true))

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
