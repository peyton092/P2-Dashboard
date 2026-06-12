import { useState, useEffect, useRef } from 'react'
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { secondaryAuth, db } from '../firebase'
import { useFocusTrap } from '../lib/useFocusTrap'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UsersIcon, XIcon } from 'lucide-react'
import { TENANTS } from '../nav/navConfig'

const O = '#F47920'

export default function CreateUserModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('internal')
  const [tenantId, setTenantId] = useState('qbs')
  const dialogRef = useRef(null)
  useFocusTrap(dialogRef, true)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const [displayName, setDisplayName] = useState('')
  const [clientJobs, setClientJobs] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password)
      const parsedClientJobs = clientJobs
        .split(/[\s,]+/)
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: email.trim(),
        displayName: displayName.trim() || email.trim(),
        role,
        tenantId: role === 'builder' ? tenantId : 'p2-core',
        ...(role === 'client' ? {
          clientName: displayName.trim() || email.trim(),
          clientJobIds: parsedClientJobs,
        } : {}),
        createdAt: new Date().toISOString(),
      })
      await signOut(secondaryAuth)
      setSuccess(`Account created for ${email.trim()}.`)
      setEmail(''); setPassword(''); setDisplayName(''); setClientJobs('')
    } catch (err) {
      const msg = {
        'auth/email-already-in-use': 'An account with that email already exists.',
        'auth/invalid-email':        'Enter a valid email address.',
        'auth/weak-password':        'Password must be at least 6 characters.',
      }[err.code] || err.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <Card
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create user account"
        className="w-96 border-white/10 bg-zinc-900"
      >
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <UsersIcon size={14} style={{ color: O }} /> Create User Account
          </CardTitle>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="text-muted-foreground hover:text-foreground"><XIcon size={16} /></button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="Mike Rodriguez" className="bg-white/5 border-white/20" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Email</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="user@p2em.com" className="bg-white/5 border-white/20" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min 6 characters" className="bg-white/5 border-white/20" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Role</label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full bg-white/5 border-white/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="internal">Internal (P2 staff)</SelectItem>
                  <SelectItem value="builder">Builder (portal access)</SelectItem>
                  <SelectItem value="client">Client (project owner)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {role === 'builder' && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Workspace</label>
                <Select value={tenantId} onValueChange={setTenantId}>
                  <SelectTrigger className="w-full bg-white/5 border-white/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TENANTS.filter(t => t.id !== 'p2-core').map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {role === 'client' && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Project IDs (comma-separated)</label>
                <Input
                  value={clientJobs}
                  onChange={e => setClientJobs(e.target.value)}
                  placeholder="QBS-018, QBS-032, QBS-041"
                  className="bg-white/5 border-white/20"
                />
                <p className="text-[11px] text-muted-foreground">
                  The client will only see these projects. The Name above is shown as the client/company name in their portal.
                </p>
              </div>
            )}
            {error   && <p className="text-xs text-red-400 font-medium">{error}</p>}
            {success && <p className="text-xs text-green-400 font-medium">{success}</p>}
            <Button type="submit" className="w-full text-white" style={{ backgroundColor: O }} disabled={loading}>
              {loading ? 'Creating…' : 'Create Account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
