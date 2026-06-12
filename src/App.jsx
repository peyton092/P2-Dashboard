import { useState, useEffect, lazy, Suspense } from 'react'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from './firebase'
import { DataProvider } from './DataContext'
import { TENANTS } from './nav/navConfig'
import LoginScreen from './auth/LoginScreen'
import CreateUserModal from './auth/CreateUserModal'
import TermsGate from './auth/TermsGate'
import { AuthLoadingScreen, PortalLoading, OAuthResultScreen, NoAccessScreen } from './auth/screens'
import MainDashboard from './MainDashboard'

const QBSBuilderPortalComponent = lazy(() => import('./components/QBSBuilderPortal'))
const ClientPortalComponent     = lazy(() => import('./components/ClientPortal'))

// ── Root component ────────────────────────────────────────────────────────────
// Pure auth/role state machine. Owns the OAuth callback exchange, the auth
// listener, and the portal/dashboard fan-out. All UI surfaces (login, terms,
// dashboard, portals) live in their own modules — see src/auth/* and
// src/MainDashboard.jsx.

export default function P2DashboardV4() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser]               = useState(null)
  const [userName, setUserName]       = useState('')
  const [role, setRole]               = useState(null)
  const [tenantId, setTenantId]       = useState('p2-core')
  const [clientName, setClientName]   = useState('')
  const [clientJobIds, setClientJobIds] = useState([])
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showSignup, setShowSignup]   = useState(false)
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [oauthState, setOauthState]   = useState(null) // null | 'loading' | 'success' | { error: string }
  const [oauthProvider, setOauthProvider] = useState(null) // 'QuickBooks' | 'CompanyCam'
  const [initialTab, setInitialTab]   = useState(null)

  // Capture OAuth callback params from URL on mount. QuickBooks (Intuit) and
  // CompanyCam both redirect back with ?code=…&state=…, but only Intuit appends
  // a realmId — that's how we route the callback to the right Cloud Function.
  const [oauthParams] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    const code = p.get('code'), state = p.get('state'), realmId = p.get('realmId')
    if (!code || !state) return null
    return realmId
      ? { provider: 'QuickBooks', fn: 'qbCallback', data: { code, state, realmId } }
      : { provider: 'CompanyCam', fn: 'ccCallback', data: { code, state } }
  })

  // ?portal=qbs forces builder QBS portal view (bypasses auth/terms — for demos/links)
  const [forcedPortal] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('portal')
  })

  // Process the OAuth callback once user is authenticated
  useEffect(() => {
    if (!oauthParams || !user) return
    const run = async () => {
      setOauthProvider(oauthParams.provider)
      setOauthState('loading')
      try {
        await httpsCallable(functions, oauthParams.fn)(oauthParams.data)
        window.history.replaceState({}, '', window.location.pathname)
        setOauthState('success')
        setTimeout(() => { setOauthState(null); setInitialTab('settings') }, 2000)
      } catch (e) {
        window.history.replaceState({}, '', window.location.pathname)
        setOauthState({ error: e.message || 'Connection failed.' })
      }
    }
    run()
  }, [user, oauthParams])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null); setRole(null); setAuthLoading(false)
        return
      }
      // Check custom claims first, fall back to Firestore users doc
      const tokenResult = await firebaseUser.getIdTokenResult()
      let r  = tokenResult.claims.role     || null
      let tid = tokenResult.claims.tenantId || 'p2-core'
      let dn = firebaseUser.displayName || ''
      let cName = tokenResult.claims.clientName || ''
      let cJobs = Array.isArray(tokenResult.claims.clientJobIds) ? tokenResult.claims.clientJobIds : null

      // Always consult the users doc when claims are incomplete (client scoping
      // and tenant/role are commonly stored there rather than as custom claims).
      // Audit C-10: do NOT default unknown users to 'internal' — that would
      // optimistically render the staff dashboard. Rules block staff-only
      // reads either way, but the UI should match reality. null role flows
      // through to the "no access" branch below.
      if (!r || cJobs === null) {
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
          if (snap.exists()) {
            const u = snap.data()
            r   = r   || u.role     || null
            tid = u.tenantId || tid
            dn  = u.displayName || dn
            cName = cName || u.clientName || u.displayName || ''
            if (cJobs === null) cJobs = Array.isArray(u.clientJobIds) ? u.clientJobIds : []
          }
        } catch {
          // Network/permissions error — leave role unresolved rather than
          // assuming staff access.
        }
      }

      setUser(firebaseUser)
      setUserName(dn)
      setRole(r)
      setTenantId(tid)
      setClientName(cName)
      setClientJobIds(cJobs || [])
      setAuthLoading(false)
    })
    return unsub
  }, [])

  const handleLogout = async () => {
    await signOut(auth)
    setUser(null); setRole(null); setTenantId('p2-core'); setTermsAccepted(false)
  }

  if (authLoading || oauthState === 'loading') {
    return (
      <AuthLoadingScreen
        label={oauthState === 'loading' ? `Connecting ${oauthProvider}…` : 'Loading…'}
      />
    )
  }

  if (oauthState === 'success' || (oauthState && oauthState.error)) {
    const ok = oauthState === 'success'
    return (
      <OAuthResultScreen
        ok={ok}
        provider={oauthProvider}
        error={ok ? null : oauthState.error}
        onBack={() => { setOauthState(null); setInitialTab('settings') }}
      />
    )
  }

  // ?portal=qbs URL bypass — honors the flag only when (a) there's no signed-in
  // user (anonymous demo / shared link), or (b) the signed-in user actually
  // has the builder role. Otherwise an internal staff member opening the link
  // while logged in would have their mutations recorded as 'QBS Coordinator'
  // (hardcoded actor in QBSBuilderPortal) — breaks audit-trail integrity.
  if (forcedPortal === 'qbs' && (!user || role === 'builder')) {
    return (
      <DataProvider tenantId="qbs" role="builder">
        <Suspense fallback={<PortalLoading />}>
          <QBSBuilderPortalComponent
            tenantName="QBS Builder Portal"
            userName={userName}
            onLogout={user ? handleLogout : null}
          />
        </Suspense>
      </DataProvider>
    )
  }

  if (!user) {
    if (showSignup) {
      return (
        <div className="dark min-h-screen bg-background">
          <CreateUserModal onClose={() => setShowSignup(false)} />
          <LoginScreen onSignup={() => setShowSignup(false)} />
        </div>
      )
    }
    return (
      <DataProvider>
        <LoginScreen onSignup={() => setShowSignup(true)} />
      </DataProvider>
    )
  }

  const tenant = TENANTS.find(t => t.id === tenantId)

  if (role === 'builder' && !termsAccepted) {
    return (
      <DataProvider>
        <TermsGate tenantId={tenantId} tenantName={tenant?.name} onAccept={() => setTermsAccepted(true)} />
      </DataProvider>
    )
  }

  if (role === 'client') {
    return (
      <DataProvider role="client" clientJobIds={clientJobIds}>
        {showCreateUser && <CreateUserModal onClose={() => setShowCreateUser(false)} />}
        <Suspense fallback={<PortalLoading />}>
          <ClientPortalComponent
            clientName={clientName || 'Client'}
            userName={userName || clientName}
            onLogout={handleLogout}
          />
        </Suspense>
      </DataProvider>
    )
  }

  // Authenticated but no role resolved — render a clear no-access screen
  // rather than optimistically dropping into the staff dashboard.
  if (user && !role) {
    return <NoAccessScreen onLogout={handleLogout} />
  }

  return (
    <DataProvider tenantId={tenantId} role={role}>
      {showCreateUser && <CreateUserModal onClose={() => setShowCreateUser(false)} />}
      {role === 'builder'
        ? (
            <Suspense fallback={<PortalLoading />}>
              <QBSBuilderPortalComponent
                tenantName={tenant?.name || 'QBS Builder Portal'}
                userName={userName}
                onLogout={handleLogout}
              />
            </Suspense>
          )
        : <MainDashboard
            role={role}
            tenantId={tenantId}
            onTenantChange={setTenantId}
            onLogout={handleLogout}
            onCreateUser={() => setShowCreateUser(true)}
            initialTab={initialTab}
          />
      }
    </DataProvider>
  )
}
