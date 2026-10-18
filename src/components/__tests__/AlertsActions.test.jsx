import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// On the alerts screen, resolving and dismissing an alert are asked about first, because
// each takes it out of the queue. The question closes at once when it is answered, since
// the write is applied on the screen at once, and a refusal is told by the toast alone.
// Snoozing and re-scanning are not asked about. Everything that would reach Firebase is
// replaced, and the clock is held, so the times the writes carry are known.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], extras: [], agentAlerts: [], loading: false },
  generated: [],
  updateAgentAlert: vi.fn(),
  addAgentAlert: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({
  updateAgentAlert: mocks.updateAgentAlert,
  addAgentAlert: mocks.addAgentAlert,
}))
vi.mock('../../agent/alerts', () => ({
  generateAlerts: () => mocks.generated,
  ALERT_TYPE_LABEL: {},
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import AlertsPage from '../AlertsPage'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

const ALERT = {
  _docId: 'a1', id: 'QBS-003_stalled', jobId: 'QBS-003', type: 'stalled', severity: 'critical',
  title: 'Stalled 5 days', description: 'No update in 5 days.', recommendation: 'Call the PM.', status: 'open',
  createdAt: { seconds: 1760000000 },
}
const CLIENT_ONLY = {
  id: 'QBS-004_stalled', jobId: 'QBS-004', type: 'stalled', severity: 'warning',
  title: 'Three days since update', description: 'Last activity 3 days ago.', status: 'open',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
  for (const mock of [mocks.updateAgentAlert, mocks.addAgentAlert, mocks.toast]) mock.mockReset()
  mocks.generated = []
  mocks.data = { jobs: [], extras: [], agentAlerts: [ALERT], loading: false }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const open = () => render(<ToastContext.Provider value={mocks.toast}><AlertsPage /></ToastContext.Provider>)
// Base UI puts focus inside a dialog on the next animation frame after it mounts. A test
// that presses a button in it waits for that first, or the frame lands later on a slow
// machine, on top of what the test did.
const ask = async (name) => {
  const dialog = await screen.findByRole('dialog', { name })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
}
const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
const confirm = (dialog, name) => act(async () => { fireEvent.click(within(dialog).getByRole('button', { name })) })

describe('resolving an alert', () => {
  it('asks first, and writes nothing until it is confirmed', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve alert' }))
    const dialog = await ask('Resolve this alert?')

    expect(within(dialog).getByText('The alert is marked resolved and moves to the Resolved filter.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Resolve' }).classList.contains('bg-brand')).toBe(true)
    expect(mocks.updateAgentAlert).not.toHaveBeenCalled()
    expect(mocks.addAgentAlert).not.toHaveBeenCalled()
  })

  it('writes the status and the time once it is confirmed, closes at once, and says so', async () => {
    const write = deferred()
    mocks.updateAgentAlert.mockReturnValue(write.promise)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve alert' }))
    const dialog = await ask('Resolve this alert?')

    await confirm(dialog, 'Resolve')

    expect(mocks.updateAgentAlert).toHaveBeenCalledTimes(1)
    expect(mocks.updateAgentAlert).toHaveBeenCalledWith('a1', { status: 'resolved', resolvedAt: '2026-10-18T15:00:00.000Z' })
    await gone()
    expect(mocks.toast).not.toHaveBeenCalled()

    await act(async () => { write.resolve() })
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Alert resolved.' })
  })

  it('writes nothing when it is cancelled', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve alert' }))
    const dialog = await ask('Resolve this alert?')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(mocks.updateAgentAlert).not.toHaveBeenCalled()
  })

  it('adds an alert the screen worked out itself, which has no document yet', async () => {
    mocks.data = { jobs: [], extras: [], agentAlerts: [], loading: false }
    mocks.generated = [CLIENT_ONLY]
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve alert' }))
    await confirm(await ask('Resolve this alert?'), 'Resolve')

    expect(mocks.updateAgentAlert).not.toHaveBeenCalled()
    expect(mocks.addAgentAlert).toHaveBeenCalledWith({ ...CLIENT_ONLY, status: 'resolved', resolvedAt: '2026-10-18T15:00:00.000Z' })
  })

  it('says it could not resolve the alert, with the reason, when the write is refused', async () => {
    mocks.updateAgentAlert.mockRejectedValue(refused())
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve alert' }))
    await confirm(await ask('Resolve this alert?'), 'Resolve')

    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not resolve the alert. Try again.',
      description: 'Missing or insufficient permissions.',
    })
  })
})

describe('dismissing an alert', () => {
  it('asks first, and says what happens to the alert', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const dialog = await ask('Dismiss this alert?')

    expect(within(dialog).getByText('The alert leaves the queue. It returns if a scan finds the problem again.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Dismiss' }).classList.contains('text-destructive')).toBe(true)
    expect(mocks.updateAgentAlert).not.toHaveBeenCalled()
  })

  it('writes the status once it is confirmed, closes at once, and says so', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await confirm(await ask('Dismiss this alert?'), 'Dismiss')

    expect(mocks.updateAgentAlert).toHaveBeenCalledWith('a1', { status: 'dismissed' })
    await gone()
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Alert dismissed.' })
  })

  it('writes nothing when it is cancelled', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const dialog = await ask('Dismiss this alert?')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await gone()
    expect(mocks.updateAgentAlert).not.toHaveBeenCalled()
  })

  it('says it could not dismiss the alert, with the reason, when the write is refused', async () => {
    mocks.updateAgentAlert.mockRejectedValue(refused())
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await confirm(await ask('Dismiss this alert?'), 'Dismiss')

    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not dismiss the alert. Try again.',
      description: 'Missing or insufficient permissions.',
    })
  })
})

describe('snoozing an alert', () => {
  it('is not asked about: it writes the status and the time a day on, and says so', async () => {
    open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Snooze 24h' })) })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateAgentAlert).toHaveBeenCalledWith('a1', { status: 'snoozed', snoozeUntil: '2026-10-19T15:00:00.000Z' })
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Alert snoozed for 24 hours.' })
  })

  it('says it could not snooze the alert, with the reason, when the write is refused', async () => {
    mocks.updateAgentAlert.mockRejectedValue(refused())
    open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Snooze 24h' })) })

    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not snooze the alert. Try again.',
      description: 'Missing or insufficient permissions.',
    })
  })
})

describe('re-scanning the jobs', () => {
  const scan = () => screen.getByRole('button', { name: /^(Re-scan jobs|Scanning…)$/ })

  it('writes every alert it worked out, and says how many', async () => {
    mocks.generated = [CLIENT_ONLY, { ...CLIENT_ONLY, id: 'QBS-005_stalled', jobId: 'QBS-005' }]
    open()
    await act(async () => { fireEvent.click(scan()) })

    expect(mocks.addAgentAlert).toHaveBeenCalledTimes(2)
    expect(mocks.addAgentAlert).toHaveBeenCalledWith({ ...CLIENT_ONLY, status: 'open' })
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Scan finished. 2 alerts refreshed.' })
  })

  it('says one alert in the singular', async () => {
    mocks.generated = [CLIENT_ONLY]
    open()
    await act(async () => { fireEvent.click(scan()) })
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Scan finished. 1 alert refreshed.' })
  })

  it('reads Scanning and takes no second press while it runs', async () => {
    const write = deferred()
    mocks.generated = [CLIENT_ONLY]
    mocks.addAgentAlert.mockReturnValue(write.promise)
    open()
    await act(async () => { fireEvent.click(scan()) })

    expect(scan().textContent).toContain('Scanning…')
    expect(scan().disabled).toBe(true)
    fireEvent.click(scan())
    expect(mocks.addAgentAlert).toHaveBeenCalledTimes(1)

    await act(async () => { write.resolve() })
    expect(scan().disabled).toBe(false)
  })

  it('says the scan failed, with the reason, and switches the button back on, when a write is refused', async () => {
    mocks.generated = [CLIENT_ONLY]
    mocks.addAgentAlert.mockRejectedValue(refused())
    open()
    await act(async () => { fireEvent.click(scan()) })

    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not scan the jobs. Try again.',
      description: 'Missing or insufficient permissions.',
    })
    expect(scan().disabled).toBe(false)
  })
})
