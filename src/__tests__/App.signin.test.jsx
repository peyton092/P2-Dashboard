import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

// The root component picks its screen from what Firebase reports about the
// signed in user, and these tests report that by hand. They count how often the
// data hooks start a subscription, because a Firestore listener that starts
// before sign in is refused by the rules, ends there, and never starts again:
// a data provider that is still mounted after sign in shows no documents until
// the page is reloaded. Importing App.jsx pulls in the whole app, so everything
// that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
  auth: { currentUser: null },
  authCallback: null,
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  signOut: vi.fn(),
}))

// What the stand-ins for the data provider's hooks record: how many
// subscriptions each has started in this test, and how many are running now.
const probe = vi.hoisted(() => {
  const names = ['jobs', 'extras', 'notifs', 'subs', 'materials', 'submits', 'dailyReports', 'urgentItems', 'settings', 'agentAlerts']
  const zeros = () => Object.fromEntries(names.map((name) => [name, 0]))
  return {
    names,
    counter: zeros(),
    running: zeros(),
    reset() {
      Object.assign(this.counter, zeros())
      Object.assign(this.running, zeros())
    },
  }
})
const { counter, running } = probe

vi.mock('../firebase', () => ({
  auth: mocks.auth,
  db: {},
  functions: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  onAuthStateChanged: (_auth, callback) => {
    mocks.authCallback = callback
    return () => { mocks.authCallback = null }
  },
  signOut: mocks.signOut,
}))

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  collection: (_db, ...segments) => ({ path: segments.join('/') }),
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
  // The Command Center listens to the QuickBooks status on its own.
  onSnapshot: () => () => {},
}))

vi.mock('../hooks/useFirestore', async (importOriginal) => {
  const { useEffect } = await import('react')
  const actual = await importOriginal()

  // Stands in for one of the real hooks. Those subscribe in an effect that runs
  // when the component using them mounts, so each run of this effect counts as
  // one subscription, and its cleanup as the end of that subscription.
  const subscribing = (name, data) => {
    const result = { ...data, loading: false, error: null }
    return function useSubscription() {
      useEffect(() => {
        probe.counter[name]++
        probe.running[name]++
        return () => { probe.running[name]-- }
      }, [])
      return result
    }
  }
  // The hooks some screens call for themselves; the data provider does not.
  const quiet = (data) => {
    const result = { ...data, loading: false, error: null }
    return () => result
  }

  // Every helper that writes becomes a spy, so nothing reaches Firestore.
  const helpers = Object.fromEntries(
    Object.keys(actual).filter((name) => !name.startsWith('use')).map((name) => [name, vi.fn()]),
  )

  return {
    ...helpers,
    useJobs: subscribing('jobs', { jobs: [] }),
    useAllExtras: subscribing('extras', { extras: [] }),
    useNotifications: subscribing('notifs', { notifs: [] }),
    useSubs: subscribing('subs', { subs: [] }),
    useMaterials: subscribing('materials', { materials: [] }),
    useSubmits: subscribing('submits', { submits: [] }),
    useDailyReports: subscribing('dailyReports', { dailyReports: [] }),
    useUrgentItems: subscribing('urgentItems', { urgentItems: [] }),
    useSettings: subscribing('settings', { settings: {} }),
    useAgentAlerts: subscribing('agentAlerts', { alerts: [] }),
    useHistory: quiet({ history: [] }),
    useSupplierInvoices: quiet({ invoices: [] }),
    useJobFiles: quiet({ files: [] }),
    useSubmitReplies: quiet({ replies: [] }),
  }
})

import App from '../App'

// The first screen a test shows loads its code on demand, which is slow on a busy runner.
vi.setConfig({ testTimeout: 20000 })

// The user Firebase hands the app, with the claims on their ID token.
const withClaims = (uid, claims) => ({
  uid,
  email: `${uid}@p2.test`,
  displayName: uid,
  getIdTokenResult: async () => ({ claims }),
})
const signedIn = (uid, role, tenantId = 'p2-core', clientJobIds = []) => withClaims(uid, { role, tenantId, clientJobIds })

const OWNER = signedIn('owner1', 'owner')
const CLIENT = signedIn('client1', 'client', 'p2-core', ['QBS-001'])
const BUILDER = signedIn('builder1', 'builder', 'qbs')

beforeEach(() => {
  probe.reset()
  mocks.auth.currentUser = null
  mocks.authCallback = null
  mocks.getDoc.mockReset().mockResolvedValue({ exists: () => false, data: () => undefined })
  mocks.setDoc.mockReset().mockResolvedValue(undefined)
  mocks.signOut.mockReset().mockImplementation(async () => { mocks.auth.currentUser = null })
})

afterEach(cleanup)

// What Firebase does whenever the signed in user changes: it calls the callback
// the app registered with onAuthStateChanged (null means nobody is signed in).
async function authChanges(user) {
  mocks.auth.currentUser = user
  await act(async () => { await mocks.authCallback(user) })
}

// The app as it starts for a visitor who is not signed in.
async function openSignedOut() {
  render(<App />)
  await authChanges(null)
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
}

// The internal dashboard is on screen once its navigation and its first page are.
const workspaceNav = () => document.querySelector('nav[aria-label="Workspace navigation"]')
const firstPage = () => document.querySelector('.p2-page-enter')
const dashboardShown = () => waitFor(() => {
  expect(workspaceNav()).not.toBeNull()
  expect(firstPage()).not.toBeNull()
}, { timeout: 10000 })
const clientPortalShown = () => screen.findByText('Client Portal', {}, { timeout: 10000 })

describe('data subscriptions and sign in', () => {
  it('starts no subscription while nobody is signed in', async () => {
    await openSignedOut()
    expect(counter.jobs).toBe(0)
    expect(running.jobs).toBe(0)
  })

  it('starts every hook subscription after sign in, whatever started before it', async () => {
    await openSignedOut()
    // Forget anything that subscribed while signed out, so that what is counted
    // from here on is only what signing in starts.
    probe.reset()
    await authChanges(OWNER)
    await dashboardShown()
    for (const name of probe.names) expect(counter[name], name).toBe(1)
    expect(running.jobs).toBe(1)
  })

  it('starts the subscriptions again when a different user signs in without a reload', async () => {
    await openSignedOut()
    await authChanges(OWNER)
    await dashboardShown()
    expect(counter.jobs).toBe(1)

    await authChanges(CLIENT)
    await clientPortalShown()
    expect(counter.jobs).toBe(2)
    expect(running.jobs).toBe(1)
  })

  it.each([
    ['the user chooses Sign out', async () => {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
      expect(mocks.signOut).toHaveBeenCalledTimes(1)
    }],
    ['Firebase reports that nobody is signed in', () => authChanges(null)],
  ])('ends every subscription when %s, and starts new ones at the next sign in', async (_how, signOut) => {
    await openSignedOut()
    await authChanges(OWNER)
    await dashboardShown()
    expect(running.jobs).toBe(1)

    await signOut()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
    for (const name of probe.names) expect(running[name], name).toBe(0)

    await authChanges(OWNER)
    await dashboardShown()
    expect(counter.jobs).toBe(2)
    expect(running.jobs).toBe(1)
  })

  it('starts nothing for a signed in user who has no role', async () => {
    await openSignedOut()
    await authChanges(withClaims('nobody1', {}))
    expect(await screen.findByText('No access yet')).toBeTruthy()
    expect(counter.jobs).toBe(0)
  })

  it('starts the subscriptions after sign in for an account whose role is only in its users document', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'internal', tenantId: 'p2-core', clientJobIds: [] }),
    })
    await openSignedOut()
    probe.reset()
    await authChanges(withClaims('staff1', {}))
    await dashboardShown()
    expect(mocks.getDoc).toHaveBeenCalledTimes(1)
    expect(counter.jobs).toBe(1)
  })
})

describe('data subscriptions and the builder terms gate', () => {
  it('starts nothing while the terms are shown, and subscribes once they are accepted', async () => {
    await openSignedOut()
    await authChanges(BUILDER)
    const accept = await screen.findByRole('button', { name: 'Accept & Enter Portal' })
    expect(counter.jobs).toBe(0)

    fireEvent.click(screen.getByText(/I have read and agree/))
    fireEvent.click(accept)
    expect(await screen.findByRole('button', { name: 'Sign out' }, { timeout: 10000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept & Enter Portal' })).toBeNull()
    expect(counter.jobs).toBe(1)
  })
})

// The provider is keyed by who is signed in, in what role, for which tenant, so
// a change in any of the three starts new subscriptions and no change does not.
describe('what makes the data provider start over', () => {
  it.each([
    ['a different user with the same role and tenant', signedIn('owner1', 'owner'), signedIn('owner2', 'owner'), 2],
    ['the same user in a different role', signedIn('owner1', 'owner'), signedIn('owner1', 'internal'), 2],
    ['the same user and role in a different tenant', signedIn('staff1', 'internal'), signedIn('staff1', 'internal', 'qbs'), 2],
    ['the same user, role and tenant reported again', signedIn('owner1', 'owner'), signedIn('owner1', 'owner'), 1],
  ])('%s', async (_label, first, second, subscriptions) => {
    await openSignedOut()
    await authChanges(first)
    await dashboardShown()
    expect(counter.jobs).toBe(1)

    await authChanges(second)
    await dashboardShown()
    expect(counter.jobs).toBe(subscriptions)
    expect(running.jobs).toBe(1)
  })

  it('starts over for a different client too', async () => {
    await openSignedOut()
    await authChanges(CLIENT)
    await clientPortalShown()
    expect(counter.jobs).toBe(1)

    await authChanges(signedIn('client2', 'client', 'p2-core', ['QBS-002']))
    await clientPortalShown()
    expect(counter.jobs).toBe(2)
    expect(running.jobs).toBe(1)
  })
})
