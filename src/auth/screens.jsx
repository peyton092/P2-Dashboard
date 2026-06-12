// Small auth/OAuth fullscreen states pulled out of the root component so
// App.jsx stays readable. None of these carry interactive state of their
// own beyond the supplied callback.

import { ZapIcon, ShieldIcon, CheckCircleIcon, AlertCircleIcon } from 'lucide-react'

const O = '#F47920'

// Centered "P2 zap" splash. Used during auth bootstrap and during the OAuth
// callback exchange (`oauthState === 'loading'`).
export function AuthLoadingScreen({ label }) {
  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse" style={{ backgroundColor: O }}>
          <ZapIcon size={18} color="#fff" />
        </div>
        <p className="text-muted-foreground text-sm">{label}</p>
      </div>
    </div>
  )
}

// Suspense fallback for the portal lazy-loads. Same shell as AuthLoadingScreen
// but with the portal copy.
export function PortalLoading() {
  return <AuthLoadingScreen label="Loading portal…" />
}

// Final state of the OAuth dance — success pulse or error with a back-link.
export function OAuthResultScreen({ ok, provider, error, onBack }) {
  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ backgroundColor: ok ? '#22c55e22' : '#ef444422' }}>
          {ok
            ? <CheckCircleIcon size={24} color="#22c55e" />
            : <AlertCircleIcon size={24} color="#ef4444" />}
        </div>
        <p className="text-sm font-medium" style={{ color: ok ? '#22c55e' : '#ef4444' }}>
          {ok ? `${provider} connected successfully!` : error}
        </p>
        {!ok && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline hover:text-white"
            onClick={onBack}
          >
            Back to Settings
          </button>
        )}
      </div>
    </div>
  )
}

// Authenticated, but no role assigned to the users/{uid} doc — instead of
// optimistically dropping into the staff dashboard, surface a clear "ask an
// admin" screen with a sign-out escape hatch. (Audit C-10.)
export function NoAccessScreen({ onLogout }) {
  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center rounded-2xl border border-white/10 bg-white/[0.025] p-6">
        <div className="mx-auto mb-3 flex items-center justify-center rounded-2xl"
             style={{ width: 44, height: 44, backgroundColor: O + '22' }}>
          <ShieldIcon size={20} style={{ color: O }} />
        </div>
        <h2 className="text-base font-semibold text-white">Account not provisioned</h2>
        <p className="text-xs text-zinc-400 mt-1.5">
          You're signed in, but no role has been assigned to your account yet. Ask a P2
          administrator to grant access.
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/15 text-zinc-200 hover:text-white hover:border-white/30 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
