import { demoSession, switchDemoRole as switchSharedRole } from '../demoSession'

// firebase/auth for the demo build. Someone is always signed in: the account of the
// session's role (see demoSession.js), the owner on a device that has chosen nothing.
//
//   onAuthStateChanged   reports the account soon after it is called, and again each
//                        time the role changes.
//   signOut              signs the owner back in, since the demo has no signed out
//                        state. App.jsx clears who is signed in once the promise it
//                        returns has settled, so the owner is reported after that:
//                        two promise jobs later, which is before the browser draws,
//                        so the sign in screen never shows, and once more after a
//                        macrotask, so the owner is signed in whatever the caller did.
//   switchDemoRole       what the banner calls to change the account.
//   The rest             (sign in, password reset, reauthentication, a new password)
//                        resolve and do nothing. Nothing is sent anywhere.
//
// An account's ID token result carries the claims the createUser function gives that
// role, so App.jsx resolves the session from them and does not read the users document.

class DemoUser {
  constructor(account) {
    this.uid = account.uid
    this.email = account.email
    this.displayName = account.displayName
    this.emailVerified = true
    this.isAnonymous = false
    this.phoneNumber = null
    this.photoURL = null
    this.providerId = 'firebase'
    this.providerData = []
    this._claims = account.claims
  }

  async getIdTokenResult() {
    const { role, tenantId, clientJobIds } = this._claims
    return { claims: { role, tenantId, clientJobIds: [...clientJobIds] }, signInProvider: 'password' }
  }
}

// One user object for each account, as Firebase keeps one for whoever is signed in.
const usersByAccount = new WeakMap()

function userFor(account) {
  let user = usersByAccount.get(account)
  if (!user) {
    user = new DemoUser(account)
    usersByAccount.set(account, user)
  }
  return user
}

class Auth {
  constructor(app) {
    this.app = app
    this.name = app?.name ?? '[DEFAULT]'
    this.languageCode = null
    this._watchers = new Set()
    this._stopSession = null
  }

  get _session() {
    return this.app?.demoSession?.() ?? demoSession()
  }

  get currentUser() {
    return userFor(this._session.user())
  }

  _announce() {
    for (const watcher of [...this._watchers]) watcher()
  }

  // Two promise jobs from now: after the code that follows an await of a call made now.
  _announceSoon() {
    queueMicrotask(() => queueMicrotask(() => this._announce()))
  }

  _watch(watcher) {
    if (this._watchers.size === 0) this._stopSession = this._session.subscribe(() => this._announceSoon())
    this._watchers.add(watcher)
    return () => {
      this._watchers.delete(watcher)
      if (this._watchers.size === 0 && this._stopSession) {
        this._stopSession()
        this._stopSession = null
      }
    }
  }
}

const auths = new Map()

export function getAuth(app) {
  const key = app ?? 'default'
  if (!auths.has(key)) auths.set(key, new Auth(app))
  return auths.get(key)
}

export function onAuthStateChanged(auth, nextOrObserver) {
  const next = typeof nextOrObserver === 'function' ? nextOrObserver : nextOrObserver?.next?.bind(nextOrObserver)
  let active = true
  const watcher = () => {
    if (active) next?.(auth.currentUser)
  }
  const stop = auth._watch(watcher)
  queueMicrotask(() => queueMicrotask(watcher))
  return () => {
    active = false
    stop()
  }
}

export async function signOut(auth) {
  auth._session.switchRole('owner', { reason: 'sign-out' })
  setTimeout(() => auth._announce(), 0)
}

export const switchDemoRole = (role) => switchSharedRole(role)

export async function signInWithEmailAndPassword(auth) {
  return { user: auth.currentUser, providerId: 'password', operationType: 'signIn' }
}

export async function sendPasswordResetEmail() {}

export async function updatePassword() {}

export async function reauthenticateWithCredential(user) {
  return { user, providerId: 'password', operationType: 'reauthenticate' }
}

// A credential that keeps neither the email nor the password it was made from.
export const EmailAuthProvider = Object.freeze({
  PROVIDER_ID: 'password',
  EMAIL_PASSWORD_SIGN_IN_METHOD: 'password',
  credential: () => ({ providerId: 'password', signInMethod: 'password' }),
})
