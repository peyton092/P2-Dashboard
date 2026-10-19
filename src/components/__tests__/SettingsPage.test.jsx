import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { axe } from '@/test/axe'
import { openSettled, initialFocusLanded } from '@/test/dialog'
import { OFFLINE_WAIT_MS } from '@/hooks/useMutation'

// Only the owner sees the Backfill access scopes button. It calls the backfillScopes
// Cloud Function, which checks the role again on the server, and reports what the
// function counted. Everything that would reach Firebase is replaced: the callable
// is a spy, and the toast is the spy the page is given through its context.
//
// The rest of the page is covered further down: the feature toggles, the password, and
// the two integrations, QuickBooks and CompanyCam, whose Disconnect buttons ask first.
const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  call: vi.fn(),
  toast: vi.fn(),
  functions: { name: 'the-functions' },
  setDoc: vi.fn(),
  updatePassword: vi.fn(),
  reauthenticate: vi.fn(),
  // What the page's listeners are told when they start, by document path.
  snapshots: {},
}))

vi.mock('../../firebase', () => ({
  auth: { currentUser: { email: 'owner@p2.test' } },
  db: {},
  functions: mocks.functions,
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('../../use-data', () => ({ useData: () => ({ jobs: [], settings: {} }) }))
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  setDoc: mocks.setDoc,
  // The page listens to the QuickBooks and CompanyCam connections on its own.
  onSnapshot: (ref, next) => {
    const snapshot = mocks.snapshots[ref.path]
    if (snapshot) next(snapshot)
    return () => {}
  },
}))
vi.mock('firebase/auth', () => ({
  updatePassword: mocks.updatePassword,
  EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
  reauthenticateWithCredential: mocks.reauthenticate,
}))
vi.mock('../../lib/push', () => ({ enablePushNotifications: vi.fn() }))

import SettingsPage from '../SettingsPage'

const RESULT = { ok: true, users: 5, jobs: 44, extras: 12, submits: 3, notifications: 8, skipped: 0 }
const DESCRIPTION = "Writes tenant and client access fields onto every job, change order, submission and notification, and refreshes everyone's sign in claims. Safe to run more than once."

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

beforeEach(() => {
  // The System card reads two build constants that vite defines at build time.
  vi.stubGlobal('__APP_VERSION__', 'test')
  vi.stubGlobal('__BUILD_DATE__', 'test')
  mocks.httpsCallable.mockReset().mockReturnValue(mocks.call)
  mocks.call.mockReset().mockResolvedValue({ data: RESULT })
  mocks.toast.mockReset()
  mocks.setDoc.mockReset()
  mocks.updatePassword.mockReset()
  mocks.reauthenticate.mockReset()
  mocks.snapshots = {}
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const open = (role) =>
  render(
    <ToastContext.Provider value={mocks.toast}>
      <SettingsPage role={role} onLogout={() => {}} />
    </ToastContext.Provider>,
  )
const button = () => screen.queryByRole('button', { name: 'Backfill access scopes' })

// Makes the call fail. The page logs a failed call before it shows the message, so the tests
// that use this keep that quiet, and get the spy to check it was logged. Nothing else is muted:
// a console.error in any other test shows up in the output.
function failWith(error, { once = false } = {}) {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  if (once) mocks.call.mockRejectedValueOnce(error)
  else mocks.call.mockRejectedValue(error)
  return logged
}
const run = async (result = RESULT) => {
  mocks.call.mockResolvedValue({ data: result })
  open('owner')
  fireEvent.click(button())
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
  return mocks.toast.mock.calls[0][0]
}

// No dash of any kind in anything a person reads: a hyphen, a hyphen like character,
// an en dash, an em dash or a minus sign.
const DASH = /[-\u2010-\u2015\u2212]/

describe('the Backfill access scopes button', () => {
  it('is on the page for the owner', () => {
    open('owner')
    expect(button()).toBeTruthy()
    expect(screen.getByText(DESCRIPTION)).toBeTruthy()
  })

  it.each([['internal'], ['builder'], ['client'], ['Owner'], [''], [null], [undefined]])('is not on the page for role %j, nor is its description', (role) => {
    open(role)
    expect(button()).toBeNull()
    expect(screen.queryByText(/Writes tenant and client access fields/)).toBeNull()
    expect(screen.queryByText('Access Scopes')).toBeNull()
  })

  it('leaves the rest of the page as it was for everyone, the owner included', () => {
    for (const role of ['owner', 'internal']) {
      open(role)
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Change Password' })).toBeTruthy()
      expect(screen.getByText('Feature Toggles')).toBeTruthy()
      cleanup()
    }
  })

  it('is labelled exactly Backfill access scopes, with the description beneath it', () => {
    open('owner')
    const label = button()
    const description = screen.getByText(DESCRIPTION)
    expect(label.textContent).toBe('Backfill access scopes')
    expect(label.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no dash in its label, its description or its heading', () => {
    open('owner')
    for (const text of [button().textContent, DESCRIPTION, screen.getByText('Access Scopes').textContent]) {
      expect(text).not.toMatch(DASH)
    }
  })

  it('calls backfillScopes once, with no data, and gives the call the time a long run needs', async () => {
    await run()
    expect(mocks.httpsCallable).toHaveBeenCalledTimes(1)
    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.functions, 'backfillScopes', { timeout: 540000 })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith()
  })

  it('does not call it just because the page opened', () => {
    open('owner')
    expect(mocks.httpsCallable).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('shows the counts from the result in a success toast', async () => {
    expect(await run()).toEqual({
      tone: 'success',
      title: 'Access scopes backfilled',
      description: 'Stamped 44 jobs, 12 change orders, 3 submissions and 8 notifications. Claims set for 5 users.',
    })
  })

  it('says one job, one change order, one submission, one notification and one user in the singular', async () => {
    const toast = await run({ ok: true, users: 1, jobs: 1, extras: 1, submits: 1, notifications: 1, skipped: 0 })
    expect(toast.description).toBe('Stamped 1 job, 1 change order, 1 submission and 1 notification. Claims set for 1 user.')
  })

  it('says zero in the plural', async () => {
    const toast = await run({ ok: true, users: 0, jobs: 0, extras: 0, submits: 0, notifications: 0, skipped: 0 })
    expect(toast.description).toBe('Stamped 0 jobs, 0 change orders, 0 submissions and 0 notifications. Claims set for 0 users.')
  })

  it('counts a field the result leaves out as zero', async () => {
    const toast = await run({ ok: true, jobs: 2 })
    expect(toast.description).toBe('Stamped 2 jobs, 0 change orders, 0 submissions and 0 notifications. Claims set for 0 users.')
  })

  it('adds how many documents were left alone when there were any', async () => {
    const many = await run({ ...RESULT, skipped: 7 })
    expect(many.description).toBe(
      'Stamped 44 jobs, 12 change orders, 3 submissions and 8 notifications. Claims set for 5 users. 7 documents have no matching job and were left alone.',
    )
    cleanup()
    mocks.toast.mockReset()
    const one = await run({ ...RESULT, skipped: 1 })
    expect(one.description).toMatch(/ 1 document has no matching job and was left alone\.$/)
  })

  it('adds how many drafts stay staff only when there were any', async () => {
    const many = await run({ ...RESULT, drafts: 3 })
    expect(many.description).toBe(
      'Stamped 44 jobs, 12 change orders, 3 submissions and 8 notifications. Claims set for 5 users. 3 drafts stay staff only until they are sent.',
    )
    cleanup()
    mocks.toast.mockReset()
    const one = await run({ ...RESULT, drafts: 1 })
    expect(one.description).toBe(
      'Stamped 44 jobs, 12 change orders, 3 submissions and 8 notifications. Claims set for 5 users. 1 draft stays staff only until it is sent.',
    )
  })

  it.each([[0], [undefined], [null], ['3'], [NaN]])('says nothing about drafts when the count is %p', async (drafts) => {
    const toast = await run({ ...RESULT, drafts })
    expect(toast.description).toBe('Stamped 44 jobs, 12 change orders, 3 submissions and 8 notifications. Claims set for 5 users.')
    expect(toast.description).not.toMatch(/draft/)
  })

  it('puts the sentence about drafts after the one about documents left alone', async () => {
    const toast = await run({ ...RESULT, skipped: 2, drafts: 4 })
    expect(toast.description).toBe(
      'Stamped 44 jobs, 12 change orders, 3 submissions and 8 notifications. Claims set for 5 users. 2 documents have no matching job and were left alone. 4 drafts stay staff only until they are sent.',
    )
  })

  it('does not count the drafts whose scope was deleted among the ones that stay staff only until sent', async () => {
    const toast = await run({ ...RESULT, draftsCleared: 6 })
    expect(toast.description).not.toMatch(/draft/)
  })

  it('has no dash in any toast it shows', async () => {
    for (const result of [RESULT, { ...RESULT, skipped: 3 }, { ...RESULT, jobs: 1, skipped: 1 }, { ...RESULT, drafts: 1 }, { ...RESULT, skipped: 2, drafts: 5 }]) {
      cleanup()
      mocks.toast.mockReset()
      const toast = await run(result)
      expect(toast.title).not.toMatch(DASH)
      expect(toast.description).not.toMatch(DASH)
    }
    cleanup()
    mocks.toast.mockReset()
    failWith(sdkError('internal', 'internal'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    const failure = mocks.toast.mock.calls[0][0]
    expect(failure.title).not.toMatch(DASH)
    expect(failure.description).not.toMatch(DASH)
  })

  it('shows the message the function sent when it refuses, in an error toast, and logs the error', async () => {
    const refusal = sdkError('permission-denied', 'Owner access required.')
    const logged = failWith(refusal)
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'error', title: 'Backfill failed', description: 'Owner access required.' })
    expect(logged).toHaveBeenCalledWith('Backfill error:', refusal)
  })

  it('shows the message of any error, whether or not it came from the function', async () => {
    failWith(new Error('The backfill stopped before it finished. It is safe to run again.'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0].description).toBe('The backfill stopped before it finished. It is safe to run again.')
  })

  it('shows a plain message, not the bare code, when no reply came back', async () => {
    failWith(sdkError('internal', 'internal'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'error', title: 'Backfill failed', description: 'Could not run the backfill. Try again.' })
  })

  it('shows no success toast for a failed run', async () => {
    failWith(sdkError('internal', 'internal'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled())
    expect(mocks.toast.mock.calls.every(([toast]) => toast.tone === 'error')).toBe(true)
  })

  it('is disabled and says Running while the call is in flight, and cannot be started twice', async () => {
    let finish
    mocks.call.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    open('owner')
    fireEvent.click(button())
    const running = await screen.findByRole('button', { name: 'Running…' })
    expect(running.disabled).toBe(true)
    expect(button()).toBeNull()
    fireEvent.click(running)
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(running.textContent).not.toMatch(DASH)

    finish({ data: RESULT })
    await waitFor(() => expect(button()).toBeTruthy())
    expect(button().disabled).toBe(false)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('can be run again after a failure', async () => {
    failWith(sdkError('internal', 'internal'), { once: true })
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(button()?.disabled).toBe(false))
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2))
    expect(mocks.toast.mock.calls[1][0].tone).toBe('success')
  })
})

// ── The rest of the page ─────────────────────────────────────────────────────

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)
const press = (el) => act(async () => { fireEvent.click(el) })

// Base UI puts focus inside a dialog on the next animation frame after it mounts. A test
// that presses a button in it waits for that first, or the frame lands later on a slow
// machine, on top of what the test did.
const ask = async (name) => {
  const dialog = await screen.findByRole('dialog', { name })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
}
const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

describe('the feature toggles', () => {
  const toggle = (name) => screen.getByRole('switch', { name })

  it('names each switch by its feature', () => {
    open('owner')
    expect(screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label'))).toEqual([
      'SMS Notifications', 'Email Digests', 'AI Morning Briefing', 'CompanyCam Sync', 'Crew GPS Tracking',
      'Mandatory Daily Reports', 'Collections Automation', 'HVAC Startup Blocking', 'QBS Portal Access',
    ])
  })

  it('writes the switch that was turned on, merged into the settings, and says so', async () => {
    open('owner')
    await press(toggle('SMS Notifications'))

    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    const [ref, data, options] = mocks.setDoc.mock.calls[0]
    expect(ref.path).toBe('config/settings')
    expect(data).toEqual({ smsNotifications: true })
    expect(options).toEqual({ merge: true })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'SMS Notifications turned on.' }])
  })

  it('writes a switch that starts on as turned off', async () => {
    open('owner')
    await press(toggle('HVAC Startup Blocking'))

    expect(mocks.setDoc.mock.calls[0][1]).toEqual({ hvacStartupBlocking: false })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'HVAC Startup Blocking turned off.' }])
  })

  it('says it could not change the setting, with the reason, when the write is refused', async () => {
    mocks.setDoc.mockRejectedValue(refused())
    open('owner')
    await press(toggle('Email Digests'))

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not change Email Digests. Try again.',
      description: 'You do not have permission to do that.',
    }])
  })
})

describe('changing the password', () => {
  const start = async (current = 'old password', next = 'new password') => {
    open('owner')
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  }
  const update = () => screen.getByRole('button', { name: /^(Update Password|Saving…)$/ })

  // The two boxes are on the shared Field: each is named by its label, and the new one is
  // described by how long it has to be, which a placeholder would hide while it is typed in.
  it('names the two password boxes by their labels, and says how long the new one must be', async () => {
    open('owner')
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))

    const current = screen.getByLabelText('Current password')
    const next = screen.getByLabelText('New password')
    expect([current.type, next.type]).toEqual(['password', 'password'])
    expect([current.autocomplete, next.autocomplete]).toEqual(['current-password', 'new-password'])
    expect(document.getElementById(next.getAttribute('aria-describedby')).textContent).toBe('At least 6 characters.')
  })
  const authError = (code, message = `Firebase: Error (${code}).`) => Object.assign(new Error(message), { code })

  it('signs the person in again with the current password, sets the new one, and says so', async () => {
    await start()
    await press(update())

    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1)
    expect(mocks.reauthenticate.mock.calls[0][1]).toEqual({ email: 'owner@p2.test', password: 'old password' })
    expect(mocks.updatePassword).toHaveBeenCalledWith(expect.anything(), 'new password')
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Password updated.' }])
  })

  it('closes the form and clears the boxes once the password is changed', async () => {
    await start()
    await press(update())

    expect(screen.queryByLabelText('Current password')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(screen.getByLabelText('Current password').value).toBe('')
    expect(screen.getByLabelText('New password').value).toBe('')
  })

  it('reads Saving and takes no second press while it is out', async () => {
    const pending = deferred()
    mocks.reauthenticate.mockReturnValue(pending.promise)
    await start()
    await press(update())

    expect(update().textContent).toBe('Saving…')
    expect(update().disabled).toBe(true)
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve() })
  })

  it.each([
    ['auth/wrong-password', 'Current password is incorrect.'],
    ['auth/invalid-credential', 'Current password is incorrect.'],
    ['auth/too-many-requests', 'Too many attempts. Try again later.'],
    ['auth/weak-password', 'New password must be at least 6 characters.'],
    ['auth/network-request-failed', 'No connection. Check it and try again.'],
  ])('says %s in words, in the toast and under the boxes, and keeps the form open', async (code, words) => {
    mocks.reauthenticate.mockRejectedValue(authError(code))
    await start()
    await press(update())

    expect(toastCalls()).toEqual([{ tone: 'error', title: 'Could not update the password. Try again.', description: words }])
    expect(screen.getByText(words, { selector: 'p' })).toBeTruthy()
    expect(screen.getByLabelText('Current password').value).toBe('old password')
    expect(update().disabled).toBe(false)
    expect(mocks.updatePassword).not.toHaveBeenCalled()
  })

  // The sign in service is a call to a server, and nothing queues one, so "saved on this
  // device" would be false of it. The form waits for the answer however long it takes.
  it('reads Saving past the wait while the device is offline, and says nothing is saved on this device', async () => {
    const pending = deferred()
    mocks.reauthenticate.mockReturnValue(pending.promise)
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await start()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await press(update())
      await act(async () => { vi.advanceTimersByTime(OFFLINE_WAIT_MS * 4) })

      expect(update().textContent).toBe('Saving…')
      expect(screen.getByLabelText('Current password')).toBeTruthy()
      expect(mocks.toast).not.toHaveBeenCalled()

      await act(async () => { pending.resolve() })

      expect(toastCalls()).toEqual([{ tone: 'success', title: 'Password updated.' }])
      expect(screen.queryByLabelText('Current password')).toBeNull()
    } finally {
      vi.useRealTimers()
      onLine.mockRestore()
    }
  })

  it('shows no raw SDK text for a code it has no words for', async () => {
    mocks.updatePassword.mockRejectedValue(authError('auth/requires-recent-login'))
    await start()
    await press(update())

    expect(toastCalls()).toEqual([{ tone: 'error', title: 'Could not update the password. Try again.' }])
    expect(screen.queryByText(/Firebase: Error/)).toBeNull()
    expect(screen.getByText('Could not update the password. Try again.', { selector: 'p' })).toBeTruthy()
  })

  // The words under the boxes are an alert on the box they concern, which is marked invalid
  // and described by them: a wrong current password on the first box, a short new one on
  // the second. An error that concerns neither box is an alert under them both.
  it.each([
    ['auth/wrong-password', 'Current password', 'New password', 'Current password is incorrect.'],
    ['auth/weak-password', 'New password', 'Current password', 'New password must be at least 6 characters.'],
  ])('puts %s on the %s box as an alert, and marks that box invalid', async (code, box, otherBox, words) => {
    mocks.reauthenticate.mockRejectedValue(authError(code))
    await start()
    await press(update())

    const input = screen.getByLabelText(box)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(words)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby').split(' ')).toContain(alert.id)
    expect(screen.getByLabelText(otherBox).hasAttribute('aria-invalid')).toBe(false)
  })

  it('reads an error that concerns neither box out as an alert, and marks neither invalid', async () => {
    mocks.reauthenticate.mockRejectedValue(authError('auth/network-request-failed'))
    await start()
    await press(update())

    expect(screen.getByRole('alert').textContent).toBe('No connection. Check it and try again.')
    for (const box of ['Current password', 'New password']) {
      expect(screen.getByLabelText(box).hasAttribute('aria-invalid'), box).toBe(false)
    }
  })

  it('clears the message under the boxes as soon as the person tries again', async () => {
    const pending = deferred()
    mocks.reauthenticate.mockRejectedValueOnce(authError('auth/wrong-password')).mockReturnValueOnce(pending.promise)
    await start()
    await press(update())
    expect(screen.getByText('Current password is incorrect.', { selector: 'p' })).toBeTruthy()

    await press(update())

    expect(update().textContent).toBe('Saving…')
    expect(screen.queryByText('Current password is incorrect.', { selector: 'p' })).toBeNull()
    await act(async () => { pending.resolve() })
    expect(mocks.updatePassword).toHaveBeenCalledTimes(1)
  })

  it('has no dash in any of the words it shows', async () => {
    for (const code of ['auth/wrong-password', 'auth/too-many-requests', 'auth/weak-password', 'auth/network-request-failed', 'auth/other']) {
      cleanup()
      mocks.toast.mockReset()
      mocks.reauthenticate.mockReset().mockRejectedValue(authError(code))
      await start()
      await press(update())
      for (const toast of toastCalls()) {
        expect(toast.title).not.toMatch(DASH)
        expect(toast.description ?? '').not.toMatch(DASH)
      }
    }
  })
})

// The two integrations are alike, so the same checks run for both. Disconnecting stops
// something that was running, so it is asked about first, in a dialog and not the
// browser's own confirm. The question stays open under the Working button while the
// function runs, and a refusal leaves it open under the error toast.
describe.each([
  {
    name: 'QuickBooks',
    path: 'qb_config/tokens',
    callable: 'qbDisconnect',
    connected: { exists: () => true, data: () => ({ access_token: 'x', realmId: '123' }) },
    body: 'Automatic sync of invoices stops until you reconnect.',
    success: 'QuickBooks disconnected.',
    failure: 'Could not disconnect QuickBooks. The connection is unchanged. Try again.',
  },
  {
    name: 'CompanyCam',
    path: 'cc_config/tokens',
    callable: 'ccDisconnect',
    connected: { exists: () => true, data: () => ({ access_token: 'x', scope: 'read' }) },
    body: 'Photo sync stops until you reconnect.',
    success: 'CompanyCam disconnected.',
    failure: 'Could not disconnect CompanyCam. The connection is unchanged. Try again.',
  },
])('disconnecting $name', (integration) => {
  const disconnect = () => screen.getByRole('button', { name: /^(Disconnect|Disconnecting…)$/ })
  const openConnected = () => {
    mocks.snapshots[integration.path] = integration.connected
    open('owner')
  }
  const confirmButton = (dialog) => within(dialog).getByRole('button', { name: /^(Disconnect|Working)$/ })

  it('asks in a dialog, and not the browser confirm, and calls nothing until it is confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)

    expect(within(dialog).getByText(integration.body)).toBeTruthy()
    expect(confirmButton(dialog).classList.contains('text-destructive')).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(mocks.httpsCallable).not.toHaveBeenCalledWith(mocks.functions, integration.callable)
  })

  it('calls the function once it is confirmed, closes, and says it is disconnected', async () => {
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)

    await press(confirmButton(dialog))

    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.functions, integration.callable)
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith()
    await gone()
    expect(toastCalls()).toEqual([{ tone: 'success', title: integration.success }])
  })

  it('stays open reading Working while the function runs, and switches the page button off', async () => {
    const pending = deferred()
    mocks.call.mockReturnValue(pending.promise)
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)

    await press(confirmButton(dialog))

    expect(within(dialog).getByRole('button', { name: 'Working' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.toast).not.toHaveBeenCalled()
    // The page is behind the dialog, hidden from the accessibility tree while it is open.
    const behind = screen.getAllByRole('button', { name: 'Disconnecting…', hidden: true })
    expect(behind.length).toBeGreaterThan(0)
    expect(behind.every((el) => el.disabled)).toBe(true)

    await act(async () => { pending.resolve({ data: {} }) })
    await gone()
  })

  // Disconnecting is a call to a Cloud Function, and nothing queues one. A question that
  // closed on "saved on this device" would say the integration was disconnected when it was
  // not. It stays open reading Working until the function has answered.
  it('stays open reading Working past the wait while the device is offline, and says nothing is saved on this device', async () => {
    const pending = deferred()
    mocks.call.mockReturnValue(pending.promise)
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await press(confirmButton(dialog))
      await act(async () => { vi.advanceTimersByTime(OFFLINE_WAIT_MS * 4) })

      expect(within(dialog).getByRole('button', { name: 'Working' }).getAttribute('aria-disabled')).toBe('true')
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(mocks.toast).not.toHaveBeenCalled()

      await act(async () => { pending.resolve({ data: {} }) })

      expect(toastCalls()).toEqual([{ tone: 'success', title: integration.success }])
    } finally {
      vi.useRealTimers()
      onLine.mockRestore()
    }
  })

  it('calls nothing when it is cancelled', async () => {
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('stays open under the error toast, with the reason, when the function refuses, so it can be tried again', async () => {
    mocks.call.mockRejectedValueOnce(sdkError('permission-denied', 'Staff access required.'))
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)

    await press(confirmButton(dialog))

    expect(toastCalls()).toEqual([{ tone: 'error', title: integration.failure, description: 'Staff access required.' }])
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(confirmButton(dialog).textContent).toBe('Disconnect')

    await press(confirmButton(dialog))
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await gone()
    expect(mocks.toast).toHaveBeenLastCalledWith({ tone: 'success', title: integration.success })
  })

  it('shows a plain message, not the bare code, when no reply came back', async () => {
    mocks.call.mockRejectedValue(sdkError('internal', 'internal'))
    openConnected()
    fireEvent.click(disconnect())
    await press(confirmButton(await ask(`Disconnect ${integration.name}?`)))

    expect(toastCalls()).toEqual([{ tone: 'error', title: integration.failure }])
  })

  it('has no dash in the question or in anything it says', async () => {
    mocks.call.mockRejectedValueOnce(sdkError('internal', 'internal'))
    openConnected()
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)
    expect(dialog.textContent).not.toMatch(DASH)
    await press(confirmButton(dialog))
    await press(confirmButton(dialog))
    await gone()
    for (const toast of toastCalls()) expect(toast.title).not.toMatch(DASH)
  })

  it('returns focus to the Disconnect button when the question is cancelled', async () => {
    openConnected()
    act(() => { disconnect().focus() })
    fireEvent.click(disconnect())
    const dialog = await ask(`Disconnect ${integration.name}?`)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await gone()

    await waitFor(() => expect(document.activeElement).toBe(disconnect()))
  })

  it('offers no Disconnect when it is not connected', () => {
    open('owner')
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })
})

// Nine switches that each carry the name of their feature, and two questions that are modal
// dialogs with a title, a body and two named buttons.
describe('accessibility', () => {
  it('has no violations on the page with its nine named switches', async () => {
    const { container } = open('owner')
    expect(screen.getAllByRole('switch')).toHaveLength(9)
    expect(await axe(container)).toHaveNoViolations()
  })

  it.each([
    ['QuickBooks', 'qb_config/tokens', { access_token: 'x', realmId: '123' }],
    ['CompanyCam', 'cc_config/tokens', { access_token: 'x', scope: 'read' }],
  ])('has no violations with the %s disconnect question open, or while it reads Working', async (name, path, data) => {
    const pending = deferred()
    mocks.call.mockReturnValue(pending.promise)
    mocks.snapshots[path] = { exists: () => true, data: () => data }
    open('owner')
    fireEvent.click(screen.getByRole('button', { name: /^(Disconnect|Disconnecting…)$/ }))
    const dialog = await openSettled(`Disconnect ${name}?`)
    await initialFocusLanded()
    expect(await axe(document.body)).toHaveNoViolations()

    await press(within(dialog).getByRole('button', { name: 'Disconnect' }))
    expect(within(dialog).getByRole('button', { name: 'Working' })).toBeTruthy()
    expect(await axe(document.body)).toHaveNoViolations()
    await act(async () => { pending.resolve({ data: {} }) })
    await gone()
  })
})

describe('the page no longer uses the browser confirm', () => {
  it('never calls window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.snapshots['qb_config/tokens'] = { exists: () => true, data: () => ({ access_token: 'x' }) }
    open('owner')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await ask('Disconnect QuickBooks?')
    await press(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await gone()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
