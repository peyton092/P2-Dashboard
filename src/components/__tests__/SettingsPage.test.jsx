import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// Only the owner sees the Backfill access scopes button. It calls the backfillScopes
// Cloud Function, which checks the role again on the server, and reports what the
// function counted. Everything that would reach Firebase is replaced: the callable
// is a spy, and the toast is the spy the page is given through its context.
const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  call: vi.fn(),
  toast: vi.fn(),
  functions: { name: 'the-functions' },
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
  setDoc: vi.fn(),
  // The page listens to the QuickBooks and CompanyCam connections on its own.
  onSnapshot: () => () => {},
}))
vi.mock('firebase/auth', () => ({
  updatePassword: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
}))
vi.mock('../../lib/push', () => ({ enablePushNotifications: vi.fn() }))

import SettingsPage from '../SettingsPage'

const RESULT = { ok: true, users: 5, jobs: 44, extras: 12, submits: 3, notifications: 8, skipped: 0 }
const DESCRIPTION = "Writes tenant and client access fields onto every job, change order, submission and notification, and refreshes everyone's sign in claims. Safe to run more than once."

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

beforeEach(() => {
  // The page logs a failed call before it shows it; the tests that make one fail stay quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // The System card reads two build constants that vite defines at build time.
  vi.stubGlobal('__APP_VERSION__', 'test')
  vi.stubGlobal('__BUILD_DATE__', 'test')
  mocks.httpsCallable.mockReset().mockReturnValue(mocks.call)
  mocks.call.mockReset().mockResolvedValue({ data: RESULT })
  mocks.toast.mockReset()
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

  it('has no dash in any toast it shows', async () => {
    for (const result of [RESULT, { ...RESULT, skipped: 3 }, { ...RESULT, jobs: 1, skipped: 1 }]) {
      cleanup()
      mocks.toast.mockReset()
      const toast = await run(result)
      expect(toast.title).not.toMatch(DASH)
      expect(toast.description).not.toMatch(DASH)
    }
    cleanup()
    mocks.toast.mockReset()
    mocks.call.mockRejectedValue(sdkError('internal', 'internal'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    const failure = mocks.toast.mock.calls[0][0]
    expect(failure.title).not.toMatch(DASH)
    expect(failure.description).not.toMatch(DASH)
  })

  it('shows the message the function sent when it refuses, in an error toast', async () => {
    mocks.call.mockRejectedValue(sdkError('permission-denied', 'Owner access required.'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'error', title: 'Backfill failed', description: 'Owner access required.' })
  })

  it('shows the message of any error, whether or not it came from the function', async () => {
    mocks.call.mockRejectedValue(new Error('The backfill stopped before it finished. It is safe to run again.'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0].description).toBe('The backfill stopped before it finished. It is safe to run again.')
  })

  it('shows a plain message, not the bare code, when no reply came back', async () => {
    mocks.call.mockRejectedValue(sdkError('internal', 'internal'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast.mock.calls[0][0]).toEqual({ tone: 'error', title: 'Backfill failed', description: 'Could not run the backfill. Try again.' })
  })

  it('shows no success toast for a failed run', async () => {
    mocks.call.mockRejectedValue(sdkError('internal', 'internal'))
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
    mocks.call.mockRejectedValueOnce(sdkError('internal', 'internal'))
    open('owner')
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(button()?.disabled).toBe(false))
    fireEvent.click(button())
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2))
    expect(mocks.toast.mock.calls[1][0].tone).toBe('success')
  })
})
