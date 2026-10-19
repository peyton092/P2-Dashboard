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
// subscriptions each has started in this test, how many are running now, and the
// scope each was last called with.
const probe = vi.hoisted(() => {
  const names = ['jobs', 'extras', 'notifs', 'subs', 'materials', 'submits', 'dailyReports', 'urgentItems', 'settings', 'agentAlerts']
  const zeros = () => Object.fromEntries(names.map((name) => [name, 0]))
  return {
    names,
    counter: zeros(),
    running: zeros(),
    scopes: {},
    reset() {
      Object.assign(this.counter, zeros())
      Object.assign(this.running, zeros())
      this.scopes = {}
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
  // one subscription, and its cleanup as the end of that subscription. The
  // collection hooks take the signed in user's scope; it is kept for the tests.
  const subscribing = (name, data) => {
    const result = { ...data, loading: false, error: null }
    return function useSubscription(scope) {
      probe.scopes[name] = scope
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
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

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

// The data hooks subscribe in an effect, and React runs that effect after the commit
// that put the screen on screen, which on a busy runner is a task later. A count that
// a test reads the moment the screen shows up can be a render behind, so a count is
// waited for and not read once. The same goes for subscriptions that end: a cleanup
// runs after the unmount. The wait has the timeout the screens' own waits have, and
// every expectation inside it is the one the test always made.
const settled = (check) => waitFor(check, { timeout: 10000 })

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
    await settled(() => {
      for (const name of probe.names) expect(counter[name], name).toBe(1)
      expect(running.jobs).toBe(1)
    })
  })

  it('starts the subscriptions again when a different user signs in without a reload', async () => {
    await openSignedOut()
    await authChanges(OWNER)
    await dashboardShown()
    await settled(() => expect(counter.jobs).toBe(1))

    await authChanges(CLIENT)
    await clientPortalShown()
    await settled(() => {
      expect(counter.jobs).toBe(2)
      expect(running.jobs).toBe(1)
    })
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
    await settled(() => expect(running.jobs).toBe(1))

    await signOut()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
    await settled(() => {
      for (const name of probe.names) expect(running[name], name).toBe(0)
    })

    await authChanges(OWNER)
    await dashboardShown()
    await settled(() => {
      expect(counter.jobs).toBe(2)
      expect(running.jobs).toBe(1)
    })
  })

  it('starts nothing for a signed in user who has no role', async () => {
    await openSignedOut()
    await authChanges(withClaims('nobody1', {}))
    expect(await screen.findByText('No access yet')).toBeTruthy()
    expect(counter.jobs).toBe(0)
  })

  it('shows the No access screen to a user whose users document exists but names no role, and starts nothing', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ displayName: 'Pat Lee', email: 'nobody2@p2.test', tenantId: 'p2-core' }),
    })
    await openSignedOut()
    await authChanges(withClaims('nobody2', {}))
    expect(await screen.findByText('No access yet')).toBeTruthy()
    expect(mocks.getDoc).toHaveBeenCalledTimes(1)
    expect(counter.jobs).toBe(0)
  })

  // The rules give a builder only the documents of their tenant, so one with no
  // tenant has nothing to see, and is told so instead of shown an empty portal.
  it('shows a builder with no tenant the No access screen and starts nothing', async () => {
    await openSignedOut()
    await authChanges(withClaims('builder9', { role: 'builder', tenantId: null, clientJobIds: [] }))
    expect(await screen.findByText('No access yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept & Enter Portal' })).toBeNull()
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
    await settled(() => expect(counter.jobs).toBe(1))
  })
})

// Ticks the box and accepts; the builder portal is on screen once its Sign out button is.
async function acceptTerms() {
  fireEvent.click(await screen.findByText(/I have read and agree/))
  fireEvent.click(screen.getByRole('button', { name: 'Accept & Enter Portal' }))
  await screen.findByRole('button', { name: 'Sign out' }, { timeout: 10000 })
}
const termsGate = () => screen.findByRole('button', { name: 'Accept & Enter Portal' })

describe('data subscriptions and the builder terms gate', () => {
  it('starts nothing while the terms are shown, and subscribes once they are accepted', async () => {
    await openSignedOut()
    await authChanges(BUILDER)
    await termsGate()
    expect(counter.jobs).toBe(0)

    await acceptTerms()
    expect(screen.queryByRole('button', { name: 'Accept & Enter Portal' })).toBeNull()
    await settled(() => expect(counter.jobs).toBe(1))
  })

  it('shows the terms to a builder who signs in after an owner session ended', async () => {
    await openSignedOut()
    await authChanges(OWNER)
    await dashboardShown()

    await authChanges(null)
    await authChanges(BUILDER)
    await termsGate()
    await settled(() => expect(running.jobs).toBe(0))
  })

  // The Sign out button clears the accepted flag itself. A session can also end
  // without it (signed out in another tab, access revoked), and then Firebase
  // only reports that nobody is signed in.
  it.each([
    ['the same builder', BUILDER],
    ['another builder', signedIn('builder2', 'builder', 'qbs')],
  ])('shows the terms again to %s who signs in after a session that ended without Sign out', async (_who, next) => {
    await openSignedOut()
    await authChanges(BUILDER)
    await termsGate()
    await acceptTerms()
    await settled(() => expect(counter.jobs).toBe(1))

    await authChanges(null)
    await authChanges(next)
    await termsGate()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    await settled(() => expect(running.jobs).toBe(0))
  })
})

// Every hook the provider calls queries with the signed in user's scope, and the
// rules check the same fields, so each provider must hand its hooks the right one.
describe('the scope the data provider hands its hooks', () => {
  const COLLECTION_HOOKS = probe.names

  it.each([
    ['an owner', OWNER, dashboardShown, { role: 'owner', tenantId: 'p2-core', uid: 'owner1' }],
    ['internal staff', signedIn('staff1', 'internal'), dashboardShown, { role: 'internal', tenantId: 'p2-core', uid: 'staff1' }],
    ['a client, with no tenant', CLIENT, clientPortalShown, { role: 'client', tenantId: null, uid: 'client1' }],
  ])('is the role, tenant and uid of %s', async (_who, user, shown, scope) => {
    await openSignedOut()
    await authChanges(user)
    await shown()
    for (const name of COLLECTION_HOOKS) expect(probe.scopes[name], name).toEqual(scope)
  })

  it('is the role, tenant and uid of a builder once the terms are accepted', async () => {
    await openSignedOut()
    await authChanges(BUILDER)
    await termsGate()
    await acceptTerms()
    for (const name of COLLECTION_HOOKS) {
      expect(probe.scopes[name], name).toEqual({ role: 'builder', tenantId: 'qbs', uid: 'builder1' })
    }
  })
})

// A session can end without the Sign out button (signed out in another tab, access
// revoked). The next person to sign in on that page must not find what the last
// one left open.
describe('what the next person to sign in does not inherit', () => {
  it.each([
    ['a client', CLIENT, clientPortalShown],
    ['the same owner', OWNER, dashboardShown],
  ])('an open Create User dialog is not shown to %s', async (_who, next, shown) => {
    await openSignedOut()
    await authChanges(OWNER)
    await dashboardShown()
    fireEvent.click(screen.getByRole('button', { name: /Manage users/ }))
    expect(await screen.findByRole('dialog', { name: 'Create User Account' })).toBeTruthy()

    await authChanges(null)
    await authChanges(next)
    await shown()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// The provider is keyed by who is signed in and in what role, so a different user
// or role starts new subscriptions. The tenant is not part of the key (see below).
describe('what makes the data provider start over', () => {
  it.each([
    ['a different user with the same role', signedIn('owner1', 'owner'), signedIn('owner2', 'owner')],
    ['the same user in a different role', signedIn('owner1', 'owner'), signedIn('owner1', 'internal')],
  ])('%s', async (_label, first, second) => {
    await openSignedOut()
    await authChanges(first)
    await dashboardShown()
    await settled(() => expect(counter.jobs).toBe(1))

    await authChanges(second)
    await dashboardShown()
    await settled(() => {
      expect(counter.jobs).toBe(2)
      expect(running.jobs).toBe(1)
    })
  })

  it('starts over for a different client too', async () => {
    await openSignedOut()
    await authChanges(CLIENT)
    await clientPortalShown()
    await settled(() => expect(counter.jobs).toBe(1))

    await authChanges(signedIn('client2', 'client', 'p2-core', ['QBS-002']))
    await clientPortalShown()
    await settled(() => {
      expect(counter.jobs).toBe(2)
      expect(running.jobs).toBe(1)
    })
  })
})

// The provider takes the tenant as a prop and scopes what it shows by it in
// JavaScript, so a new tenant needs no new subscriptions, and starting over for
// it would throw away the page the person has open.
describe('what leaves the data provider as it is', () => {
  it.each([
    ['the same user, role and tenant reported again', signedIn('owner1', 'owner'), signedIn('owner1', 'owner')],
    ['the same user and role with another tenant', signedIn('staff1', 'internal'), signedIn('staff1', 'internal', 'qbs')],
  ])('%s', async (_label, first, second) => {
    await openSignedOut()
    await authChanges(first)
    await dashboardShown()
    await settled(() => expect(counter.jobs).toBe(1))

    await authChanges(second)
    await dashboardShown()
    expect(counter.jobs).toBe(1)
    expect(running.jobs).toBe(1)
  })

  it('keeps the open page and its subscriptions when internal staff switch workspace in the sidebar', async () => {
    await openSignedOut()
    await authChanges(signedIn('staff1', 'internal'))
    await dashboardShown()
    await settled(() => expect(counter.jobs).toBe(1))
    await act(async () => { window.dispatchEvent(new CustomEvent('p2:navigate', { detail: { id: 'jobs' } })) })
    await waitFor(() => expect(firstPage().textContent).toMatch(/^Job Status/))

    // The Workspace selector is only shown to internal staff. A real pointer
    // moves over an option before it clicks, and the option ignores a click until then.
    const workspace = () => document.querySelector('aside[aria-label="Primary"] [role="combobox"]')
    expect(workspace().textContent).toContain('p2-core')
    await act(async () => { fireEvent.mouseDown(workspace()) })
    const option = await screen.findByRole('option', { name: 'QBS Builder Portal' })
    await act(async () => { fireEvent.mouseMove(option) })
    await act(async () => { fireEvent.click(option) })

    await waitFor(() => expect(workspace().textContent).toContain('qbs'))
    expect(firstPage().textContent).toMatch(/^Job Status/)
    expect(counter.jobs).toBe(1)
    expect(running.jobs).toBe(1)
  })
})

// The Settings page gets its role from the dashboard, so only the owner is offered
// the Backfill access scopes button. SettingsPage.test.jsx covers the button itself;
// this covers the one line that hands the page the signed in role.
describe('the Settings page reached from the dashboard', () => {
  // The page shows two build constants that vite defines at build time.
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', 'test')
    vi.stubGlobal('__BUILD_DATE__', 'test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const openSettings = async (user) => {
    await openSignedOut()
    await authChanges(user)
    await dashboardShown()
    await act(async () => { window.dispatchEvent(new CustomEvent('p2:navigate', { detail: { id: 'settings' } })) })
    // Sign out is on the Settings page as well as in the sidebar, so wait for something only the page has.
    await screen.findByText('Feature Toggles', {}, { timeout: 10000 })
  }

  it('offers the owner the Backfill access scopes button', async () => {
    await openSettings(OWNER)
    expect(screen.getByRole('button', { name: 'Backfill access scopes' })).toBeTruthy()
  })

  it('does not offer it to internal staff', async () => {
    await openSettings(signedIn('staff1', 'internal'))
    expect(screen.queryByRole('button', { name: 'Backfill access scopes' })).toBeNull()
    expect(screen.queryByText('Access Scopes')).toBeNull()
  })
})
