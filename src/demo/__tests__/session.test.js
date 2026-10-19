import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDemoSession, DEMO_ROLE_KEY, DEMO_ROLES } from '../demoSession'
import { DEMO_USERS } from '../users'
import { initializeApp } from '../shims/app'
import {
  getAuth, onAuthStateChanged, signOut, switchDemoRole, signInWithEmailAndPassword,
  sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from '../shims/auth'
import { resolveSession } from '../../lib/session'

// The demo has no sign in. The owner is signed in when it opens, the banner switches
// between the four demo accounts, the last one chosen is kept on the device, and
// signing out signs the owner back in. These tests pin that, through the same calls
// App.jsx makes.

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

const refusingStorage = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('blocked') },
  removeItem() { throw new Error('blocked') },
}

// An app with its own session, so each test starts from what it is given.
function appWith(storage) {
  const session = createDemoSession({ storage })
  return { app: initializeApp({ demo: { session } }), session }
}

// Lets the promise jobs that are waiting run, the way the browser does between tasks.
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('who is signed in', () => {
  it('is the owner first, on a device that has chosen nothing', async () => {
    const { app } = appWith(memoryStorage())
    const auth = getAuth(app)
    expect(auth.currentUser.uid).toBe(DEMO_USERS.owner.uid)

    const seen = vi.fn()
    onAuthStateChanged(auth, seen)
    expect(seen).not.toHaveBeenCalled()
    await settle()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.lastCall[0].uid).toBe(DEMO_USERS.owner.uid)
  })

  it('has claims the app resolves to the session each demo account stands for', async () => {
    const { app, session } = appWith(memoryStorage())
    const auth = getAuth(app)
    const expected = {
      owner: { role: 'owner', tenantId: 'p2-core', clientJobIds: [] },
      internal: { role: 'internal', tenantId: 'p2-core', clientJobIds: [] },
      builder: { role: 'builder', tenantId: 'qbs', clientJobIds: [] },
      client: { role: 'client', tenantId: 'p2-core', clientJobIds: DEMO_USERS.client.claims.clientJobIds },
    }
    for (const role of DEMO_ROLES) {
      session.switchRole(role)
      const user = auth.currentUser
      const { claims } = await user.getIdTokenResult()
      expect(claims).toEqual(expected[role])
      // App.jsx reads the users document only when the claims lack a role or job ids.
      expect(Boolean(claims.role) && Array.isArray(claims.clientJobIds)).toBe(true)
      const resolved = resolveSession(claims, null, user)
      expect(resolved).toMatchObject({ ...expected[role], displayName: DEMO_USERS[role].displayName })
      expect(user.email).toBe(DEMO_USERS[role].email)
    }
    expect(DEMO_USERS.client.claims.clientJobIds.length).toBeGreaterThan(0)
  })

  it('gives the same user object for the same account, as Firebase does', () => {
    const { app } = appWith(memoryStorage())
    const auth = getAuth(app)
    expect(auth.currentUser).toBe(auth.currentUser)
  })
})

describe('switching the role', () => {
  it('tells the auth listeners and the session subscribers', async () => {
    const { app, session } = appWith(memoryStorage())
    const auth = getAuth(app)
    const seen = vi.fn()
    const roles = vi.fn()
    onAuthStateChanged(auth, seen)
    session.subscribe(roles)
    await settle()
    seen.mockClear()

    session.switchRole('builder')
    expect(roles).toHaveBeenCalledWith({ role: 'builder', reason: 'switch' })
    await settle()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.lastCall[0].uid).toBe(DEMO_USERS.builder.uid)
    expect(auth.currentUser.uid).toBe(DEMO_USERS.builder.uid)
  })

  it('stops telling a listener that unsubscribed, also before its first call', async () => {
    const { app, session } = appWith(memoryStorage())
    const auth = getAuth(app)
    const early = vi.fn()
    const late = vi.fn()
    onAuthStateChanged(auth, early)()
    const stop = onAuthStateChanged(auth, late)
    await settle()
    stop()
    session.switchRole('client')
    await settle()
    expect(early).not.toHaveBeenCalled()
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('refuses a role the demo does not have', () => {
    const { session } = appWith(memoryStorage())
    expect(() => session.switchRole('admin')).toThrow(/admin/)
    expect(session.role()).toBe('owner')
  })

  it('switches the default session through switchDemoRole, the call the banner makes', async () => {
    const auth = getAuth(initializeApp({}))
    const before = auth.currentUser.uid
    switchDemoRole('client')
    expect(auth.currentUser.uid).toBe(DEMO_USERS.client.uid)
    switchDemoRole('owner')
    expect(auth.currentUser.uid).toBe(DEMO_USERS.owner.uid)
    expect(typeof before).toBe('string')
  })
})

describe('the remembered role', () => {
  it('is kept on the device and is the role a later visit starts with', () => {
    const storage = memoryStorage()
    appWith(storage).session.switchRole('builder')
    expect(storage.map.get(DEMO_ROLE_KEY)).toBe('builder')
    const later = appWith(storage)
    expect(later.session.role()).toBe('builder')
    expect(getAuth(later.app).currentUser.uid).toBe(DEMO_USERS.builder.uid)
  })

  it('is the owner when what is stored is not a demo role', () => {
    const { session } = appWith(memoryStorage({ [DEMO_ROLE_KEY]: 'admin' }))
    expect(session.role()).toBe('owner')
  })

  it('still switches when the storage refuses every call', () => {
    const { session } = appWith(refusingStorage)
    expect(session.role()).toBe('owner')
    expect(() => session.switchRole('client')).not.toThrow()
    expect(session.role()).toBe('client')
  })
})

describe('signing out', () => {
  it('signs the owner back in, after the caller has done what follows its await', async () => {
    const storage = memoryStorage()
    const { app, session } = appWith(storage)
    const auth = getAuth(app)
    session.switchRole('builder')
    const events = []
    onAuthStateChanged(auth, (user) => events.push(user?.uid ?? null))
    await settle()
    events.length = 0
    const reasons = []
    session.subscribe(({ reason }) => reasons.push(reason))

    // What App.jsx does: await the sign out, then clear who was signed in.
    const handleLogout = async () => {
      await signOut(auth)
      events.push('cleared by the app')
    }
    await handleLogout()
    await settle()
    expect(events).toEqual(['cleared by the app', DEMO_USERS.owner.uid])
    expect(auth.currentUser.uid).toBe(DEMO_USERS.owner.uid)
    expect(storage.map.get(DEMO_ROLE_KEY)).toBe('owner')
    expect(reasons).toEqual(['sign-out'])

    // And once more after a macrotask, so the owner is signed in whatever the caller does.
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['cleared by the app', DEMO_USERS.owner.uid, DEMO_USERS.owner.uid])
  })

  it('signs the owner back in when the owner signs out, too', async () => {
    const { app } = appWith(memoryStorage())
    const auth = getAuth(app)
    const seen = vi.fn()
    onAuthStateChanged(auth, seen)
    await settle()
    seen.mockClear()
    await signOut(auth)
    await settle()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.lastCall[0].uid).toBe(DEMO_USERS.owner.uid)
  })
})

describe('the rest of the sign in calls', () => {
  it('resolve and change nothing', async () => {
    const { app, session } = appWith(memoryStorage())
    const auth = getAuth(app)
    session.switchRole('client')
    const user = auth.currentUser
    await expect(signInWithEmailAndPassword(auth, 'someone@example.com', 'secret')).resolves.toBeDefined()
    await expect(sendPasswordResetEmail(auth, 'someone@example.com')).resolves.toBeUndefined()
    const credential = EmailAuthProvider.credential('someone@example.com', 'secret')
    expect(JSON.stringify(credential)).not.toContain('secret')
    await expect(reauthenticateWithCredential(user, credential)).resolves.toBeDefined()
    await expect(updatePassword(user, 'another')).resolves.toBeUndefined()
    expect(auth.currentUser.uid).toBe(DEMO_USERS.client.uid)
  })
})
