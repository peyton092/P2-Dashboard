import { useState } from 'react'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ZapIcon, LockIcon } from 'lucide-react'

const O = '#F47920'

export default function LoginScreen({ onSignup }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetMsg, setResetMsg] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const handleForgotPassword = async () => {
    setResetMsg('')
    const target = email.trim()
    if (!target) {
      setResetMsg('Enter your email above first, then tap Forgot Password.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setResetMsg('That email address looks invalid.')
      return
    }
    setResetLoading(true)
    try {
      await sendPasswordResetEmail(auth, target)
      setResetMsg(`Reset link sent to ${target} — check your inbox.`)
    } catch (err) {
      const map = {
        'auth/user-not-found':    'No account found for that email.',
        'auth/invalid-email':     'That email address looks invalid.',
        'auth/too-many-requests': 'Too many attempts — wait a few minutes and try again.',
      }
      setResetMsg(map[err?.code] || 'Could not send reset email. Try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const handleSignIn = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      // onAuthStateChanged in root will handle the rest
    } catch (err) {
      const msg = {
        'auth/invalid-credential':   'Incorrect email or password.',
        'auth/user-not-found':       'No account found for that email.',
        'auth/wrong-password':       'Incorrect password.',
        'auth/too-many-requests':    'Too many attempts — try again later.',
        'auth/invalid-email':        'Enter a valid email address.',
      }[err.code] || 'Sign-in failed. Check your credentials.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dark min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: O }}>
          <ZapIcon size={22} color="#fff" />
        </div>
        <div>
          <p className="font-semibold text-2xl leading-none" style={{ color: O }}>P2</p>
          <p className="text-xs text-zinc-400 leading-tight">Electrical &amp; Mechanical</p>
        </div>
      </div>

      <Card className="w-80 border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <LockIcon size={14} style={{ color: O }} /> Sign In
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Email</label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@p2em.com"
                className="bg-white/5 border-white/20"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-white/5 border-white/20"
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
            <Button
              type="submit"
              className="w-full text-white"
              style={{ backgroundColor: O }}
              disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs transition-colors"
              style={{ color: O, opacity: resetLoading ? 0.5 : 1 }}
              disabled={resetLoading}
              onClick={handleForgotPassword}>
              Forgot Password?
            </button>
            {resetMsg && (
              <p className={`text-xs text-center font-medium ${resetMsg.includes('sent to') ? 'text-green-400' : 'text-red-400'}`}>
                {resetMsg}
              </p>
            )}
          </form>
          <button
            className="mt-4 text-xs text-muted-foreground hover:text-foreground w-full text-center transition-colors"
            onClick={onSignup}>
            Create account (owner setup)
          </button>
        </CardContent>
      </Card>
    </div>
  )
}
