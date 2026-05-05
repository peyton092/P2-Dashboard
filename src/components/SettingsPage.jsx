import { useState, useEffect } from 'react'
import {
  updatePassword, EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth'
import { doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase'
import { useData } from '../DataContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SettingsIcon, ShieldIcon, ServerIcon,
  BellIcon, MailIcon, BrainCircuitIcon, CameraIcon, MapPinIcon,
  ClipboardListIcon, DollarSignIcon, ZapIcon, Building2Icon,
  LogOutIcon, CheckCircleIcon, LinkIcon,
} from 'lucide-react'

const O = '#F47920'

const TOGGLE_DEFS = [
  { key: 'smsNotifications',      label: 'SMS Notifications',       desc: 'Send text alerts for critical events',             Icon: BellIcon,          def: false },
  { key: 'emailDigests',          label: 'Email Digests',            desc: 'Daily email summary to owner',                    Icon: MailIcon,          def: false },
  { key: 'aiMorningBriefing',     label: 'AI Morning Briefing',      desc: 'Claude-powered daily battle plan',                Icon: BrainCircuitIcon,  def: false },
  { key: 'companyCamSync',        label: 'CompanyCam Sync',          desc: 'Auto-pull photos from CompanyCam',                Icon: CameraIcon,        def: false },
  { key: 'crewGpsTracking',       label: 'Crew GPS Tracking',        desc: 'Verify crew location on check-in',                Icon: MapPinIcon,        def: false },
  { key: 'mandatoryDailyReports', label: 'Mandatory Daily Reports',  desc: 'Block phase advance without report',              Icon: ClipboardListIcon, def: false },
  { key: 'collectionsAutomation', label: 'Collections Automation',   desc: 'Auto-follow-up on aging invoices',                Icon: DollarSignIcon,    def: false },
  { key: 'hvacStartupBlocking',   label: 'HVAC Startup Blocking',    desc: 'Prevent HVAC startup without electrical service', Icon: ZapIcon,           def: true  },
  { key: 'qbsPortalAccess',       label: 'QBS Portal Access',        desc: 'Allow builder coordinators to view jobs',         Icon: Building2Icon,     def: true  },
]

function Toggle({ enabled, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 focus:outline-none"
      style={{ backgroundColor: enabled ? O : '#374151' }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}

export default function SettingsPage({ onLogout }) {
  const { jobs, settings } = useData()
  const user = auth.currentUser

  const [pwMode, setPwMode]   = useState(false)
  const [curPw, setCurPw]     = useState('')
  const [newPw, setNewPw]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [pwMsg, setPwMsg]     = useState(null)

  const [qbConnected, setQbConnected] = useState(false)
  const [qbConnectedAt, setQbConnectedAt] = useState(null)
  const [qbCompanyId, setQbCompanyId] = useState(null)
  const [qbConnecting, setQbConnecting] = useState(false)
  const [qbDisconnecting, setQbDisconnecting] = useState(false)
  const [qbError, setQbError] = useState('')
  const [qbInfo, setQbInfo] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'qb_config', 'tokens'), snap => {
      const d = snap.data()
      setQbConnected(snap.exists() && !!d?.access_token)
      setQbCompanyId(d?.realmId || null)
      const ts = d?.connectedAt?.toDate?.() || (d?.connectedAt ? new Date(d.connectedAt) : null)
      setQbConnectedAt(ts && !isNaN(ts.getTime()) ? ts : null)
    }, () => {})
    return unsub
  }, [])

  const handleConnectQB = async () => {
    setQbConnecting(true)
    setQbError('')
    setQbInfo('')
    const timeout = setTimeout(() => {
      setQbConnecting(false)
      setQbError('Connection timed out — QB auth did not respond. Try again.')
    }, 10000)
    try {
      const { data } = await httpsCallable(functions, 'qbAuth')()
      clearTimeout(timeout)
      if (!data?.authUrl) {
        setQbConnecting(false)
        setQbError('QuickBooks integration is not configured on the server yet. Contact support.')
        return
      }
      window.location.href = data.authUrl
    } catch (e) {
      clearTimeout(timeout)
      console.error('QB auth error:', e)
      setQbConnecting(false)
      const code = e?.code || ''
      if (code === 'functions/unavailable' || code === 'functions/not-found') {
        setQbError('QuickBooks integration is not deployed on the server yet.')
      } else {
        setQbError('Could not connect to QuickBooks. Try again.')
      }
    }
  }

  const handleDisconnectQB = async () => {
    if (!qbConnected) return
    if (!window.confirm('Disconnect QuickBooks? Auto-sync of invoices will stop until you reconnect.')) return
    setQbDisconnecting(true)
    setQbError('')
    setQbInfo('')
    try {
      try {
        await httpsCallable(functions, 'qbDisconnect')()
      } catch {
        // Fallback: clear the token doc directly so the UI reflects disconnect.
        await deleteDoc(doc(db, 'qb_config', 'tokens'))
      }
      setQbInfo('QuickBooks disconnected.')
    } catch (e) {
      console.error('QB disconnect error:', e)
      setQbError('Could not disconnect. Try again.')
    } finally {
      setQbDisconnecting(false)
    }
  }

  const getVal = (key, def) =>
    settings && key in settings ? settings[key] : def

  const handleToggle = async (key, value) => {
    await setDoc(doc(db, 'config', 'settings'), { [key]: value }, { merge: true })
  }

  const handleChangePw = async () => {
    if (!user || !curPw || !newPw) return
    setSaving(true)
    setPwMsg(null)
    try {
      const cred = EmailAuthProvider.credential(user.email, curPw)
      await reauthenticateWithCredential(user, cred)
      await updatePassword(user, newPw)
      setPwMsg({ ok: true, text: 'Password updated successfully.' })
      setCurPw(''); setNewPw(''); setPwMode(false)
    } catch (e) {
      const map = {
        'auth/wrong-password':     'Current password is incorrect.',
        'auth/invalid-credential': 'Current password is incorrect.',
        'auth/too-many-requests':  'Too many attempts — try again later.',
        'auth/weak-password':      'New password must be at least 6 characters.',
      }
      setPwMsg({ ok: false, text: map[e.code] || e.message })
    }
    setSaving(false)
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: O }}>Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Feature configuration, account, and system info</p>
      </div>

      {/* ── Feature Toggles ──────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <SettingsIcon size={15} style={{ color: O }} /> Feature Toggles
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-white/5 px-6">
          {TOGGLE_DEFS.map(({ key, label, desc, Icon, def }) => (
            <div key={key} className="flex items-center justify-between py-3.5 gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 p-1.5 rounded-lg shrink-0" style={{ backgroundColor: O + '1a' }}>
                  <Icon size={13} style={{ color: O }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none mb-1">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
              <Toggle enabled={getVal(key, def)} onChange={v => handleToggle(key, v)} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── QuickBooks Integration ───────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <LinkIcon size={15} style={{ color: O }} /> QuickBooks Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-5 space-y-3">
          <div className="flex items-center gap-2">
            {qbConnected
              ? <CheckCircleIcon size={14} className="text-green-400 shrink-0" />
              : <div className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0" />
            }
            <span className="text-sm">
              {qbConnected ? 'QuickBooks connected' : 'Not connected'}
            </span>
          </div>
          {qbConnected && (
            <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
              {qbCompanyId && <p>Company ID: <span className="">{qbCompanyId}</span></p>}
              {qbConnectedAt && <p>Connected {qbConnectedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="text-xs h-8 text-white"
              style={{ backgroundColor: O }}
              onClick={handleConnectQB}
              disabled={qbConnecting || qbDisconnecting}
            >
              {qbConnecting ? 'Redirecting…' : qbConnected ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}
            </Button>
            {qbConnected && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 border-white/20"
                onClick={handleDisconnectQB}
                disabled={qbConnecting || qbDisconnecting}
              >
                {qbDisconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
          </div>
          {qbError && <p className="text-xs text-red-400 mt-2">{qbError}</p>}
          {qbInfo  && <p className="text-xs text-green-400 mt-2">{qbInfo}</p>}
        </CardContent>
      </Card>

      {/* ── Account ──────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldIcon size={15} style={{ color: O }} /> Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-5">
          <div className="flex items-center gap-2 text-sm">
            <MailIcon size={13} className="text-muted-foreground shrink-0" />
            <span className="font-medium">{user?.email || '—'}</span>
          </div>

          {!pwMode ? (
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-xs h-8"
              onClick={() => { setPwMode(true); setPwMsg(null) }}
            >
              Change Password
            </Button>
          ) : (
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Current password"
                className="h-8 text-sm bg-white/5 border-white/20"
                value={curPw}
                onChange={e => setCurPw(e.target.value)}
              />
              <Input
                type="password"
                placeholder="New password (min 6 characters)"
                className="h-8 text-sm bg-white/5 border-white/20"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
              />
              {pwMsg && (
                <p className="text-xs" style={{ color: pwMsg.ok ? '#22c55e' : '#ef4444' }}>
                  {pwMsg.text}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="text-xs h-7 text-white"
                  style={{ backgroundColor: O }}
                  onClick={handleChangePw}
                  disabled={saving || !curPw || !newPw}
                >
                  {saving ? 'Saving…' : 'Update Password'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => { setPwMode(false); setPwMsg(null); setCurPw(''); setNewPw('') }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-white/10">
            <button
              className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
              onClick={onLogout}
            >
              <LogOutIcon size={13} /> Sign out
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── System Info ──────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ServerIcon size={15} style={{ color: O }} /> System
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'App Version',      value: __APP_VERSION__         },
              { label: 'Firebase Project', value: 'p2-dashboard'           },
              { label: 'Total Jobs',       value: String(jobs?.length ?? '—') },
              { label: 'Active Jobs',      value: String((jobs || []).filter(j => !['complete','completed'].includes(j.status)).length) },
              { label: 'QuickBooks',       value: qbConnected ? 'Connected' : 'Not connected' },
              { label: 'Build Date',       value: __BUILD_DATE__           },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-lg bg-white/5 border border-white/5">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-sm font-bold">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
