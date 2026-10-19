import { DEMO_USERS } from './users'
import { deviceStorage } from './device'

// Who the demo is signed in as: one of the four demo accounts, chosen with the role
// switcher in the banner. There is no sign in and no signed out state. A device that
// has chosen nothing starts as the owner, and the last role chosen is kept on the
// device under DEMO_ROLE_KEY, so a reload opens on it again.
//
//   const session = createDemoSession({ storage })
//   session.role()          'owner', 'internal', 'builder' or 'client'
//   session.user()          that role's account, from users.js
//   session.switchRole(r)   tells every subscriber { role, reason }
//   session.subscribe(fn)   gives back the function that stops it
//
// The auth shim (shims/auth.js) is built on a session and turns its changes into what
// onAuthStateChanged reports. reason is 'switch' for a choice in the banner and
// 'sign-out' when the app signed out and the owner was signed back in.

export const DEMO_ROLE_KEY = 'p2-demo-role'
export const DEMO_ROLES = Object.freeze(['owner', 'internal', 'builder', 'client'])

const isRole = (value) => DEMO_ROLES.includes(value)

const guarded = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}

export function createDemoSession({ users = DEMO_USERS, storage = null } = {}) {
  let role = null
  const subscribers = new Set()

  // Read from storage the first time it is asked, not when the session is made.
  const current = () => {
    if (role === null) {
      const stored = guarded(() => storage?.getItem(DEMO_ROLE_KEY))
      role = isRole(stored) ? stored : 'owner'
    }
    return role
  }

  function switchRole(next, { reason = 'switch' } = {}) {
    if (!isRole(next)) throw new Error(`The demo has no ${next} account. It has ${DEMO_ROLES.join(', ')}.`)
    role = next
    guarded(() => storage?.setItem(DEMO_ROLE_KEY, next))
    for (const subscriber of [...subscribers]) subscriber({ role: next, reason })
  }

  function subscribe(subscriber) {
    subscribers.add(subscriber)
    return () => { subscribers.delete(subscriber) }
  }

  return {
    role: current,
    user: () => users[current()],
    users,
    switchRole,
    subscribe,
  }
}

// The session of the demo itself, over this browser's storage, made when it is first
// needed. The auth shim and the banner both use it.
let shared = null

export function demoSession() {
  if (shared === null) shared = createDemoSession({ storage: deviceStorage() })
  return shared
}

export const currentDemoRole = () => demoSession().role()

export const switchDemoRole = (role) => demoSession().switchRole(role)

export const onDemoRoleChange = (subscriber) => demoSession().subscribe(subscriber)
