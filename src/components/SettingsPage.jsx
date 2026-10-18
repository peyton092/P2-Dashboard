import { useState, useEffect } from 'react'
import {
  updatePassword, EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase'
import { enablePushNotifications } from '../lib/push'
import { withTimeout } from '../lib/withTimeout'
import { callableMessage } from '../lib/callableError'
import { useData } from '../use-data'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SettingsIcon, ShieldIcon, ServerIcon,
  BellIcon, MailIcon, BrainCircuitIcon, CameraIcon, MapPinIcon,
  ClipboardListIcon, DollarSignIcon, ZapIcon, Building2Icon,
  LogOutIcon, CheckCircleIcon, LinkIcon,
} from 'lucide-react'
import { BRAND, withAlpha } from '@/lib/tokens'

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

// "1 job", "2 jobs": a count with its noun, in the plural unless the count is one.
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What the access scopes backfill did, as the sentence the toast shows. A count the
// result leaves out is shown as zero. Documents left alone, and drafts that stay staff
// only until they are sent, are only mentioned when there were some.
function backfillSummary(result) {
  const n = key => (Number.isFinite(result?.[key]) ? result[key] : 0)
  const skipped = n('skipped')
  const drafts = n('drafts')
  const left = skipped === 1
    ? '1 document has no matching job and was left alone.'
    : `${skipped} documents have no matching job and were left alone.`
  const staffOnly = drafts === 1
    ? '1 draft stays staff only until it is sent.'
    : `${drafts} drafts stay staff only until they are sent.`
  return [
    `Stamped ${count(n('jobs'), 'job')}, ${count(n('extras'), 'change order')}, ${count(n('submits'), 'submission')} and ${count(n('notifications'), 'notification')}.`,
    `Claims set for ${count(n('users'), 'user')}.`,
    skipped > 0 ? left : '',
    drafts > 0 ? staffOnly : '',
  ].filter(Boolean).join(' ')
}

function Toggle({ enabled, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 focus:outline-none"
      style={{ backgroundColor: enabled ? BRAND : '#374151' }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}

export default function SettingsPage({ onLogout, role }) {
  const { jobs, settings } = useData()
  const user = auth.currentUser
  const toast = useToast()

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

  const [ccConnected, setCcConnected] = useState(false)
  const [ccConnectedAt, setCcConnectedAt] = useState(null)
  const [ccScope, setCcScope] = useState(null)
  const [ccConnecting, setCcConnecting] = useState(false)
  const [ccDisconnecting, setCcDisconnecting] = useState(false)
  const [ccError, setCcError] = useState('')
  const [ccInfo, setCcInfo] = useState('')
  const [ccSyncing, setCcSyncing] = useState(false)
  const [ccSync, setCcSync] = useState(null)

  const [pushBusy, setPushBusy] = useState(false)
  const [backfilling, setBackfilling] = useState(false)

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

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'cc_config', 'tokens'), snap => {
      const d = snap.data()
      setCcConnected(snap.exists() && !!d?.access_token)
      setCcScope(d?.scope || null)
      const ts = d?.connectedAt?.toDate?.() || (d?.connectedAt ? new Date(d.connectedAt) : null)
      setCcConnectedAt(ts && !isNaN(ts.getTime()) ? ts : null)
    }, () => {})
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'cc_config', 'sync'), snap => {
      setCcSync(snap.exists() ? snap.data() : null)
    }, () => {})
    return unsub
  }, [])

  const handleConnectQB = async () => {
    setQbConnecting(true)
    setQbError('')
    setQbInfo('')
    try {
      const { data } = await withTimeout(httpsCallable(functions, 'qbAuth')(), 10000)
      if (!data?.authUrl) {
        setQbConnecting(false)
        setQbError('QuickBooks integration is not configured on the server yet. Contact support.')
        return
      }
      window.location.href = data.authUrl
    } catch (e) {
      setQbConnecting(false)
      if (e?.code === 'timeout') {
        setQbError('Connection timed out. QuickBooks did not respond. Try again.')
        return
      }
      console.error('QB auth error:', e)
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
      await httpsCallable(functions, 'qbDisconnect')()
      setQbInfo('QuickBooks disconnected.')
    } catch (e) {
      console.error('QB disconnect error:', e)
      setQbError('Could not disconnect. The connection is unchanged. Try again.')
    } finally {
      setQbDisconnecting(false)
    }
  }

  const handleConnectCC = async () => {
    setCcConnecting(true)
    setCcError('')
    setCcInfo('')
    try {
      const { data } = await withTimeout(httpsCallable(functions, 'ccAuth')(), 10000)
      if (!data?.authUrl) {
        setCcConnecting(false)
        setCcError('CompanyCam integration is not configured on the server yet. Contact support.')
        return
      }
      window.location.href = data.authUrl
    } catch (e) {
      setCcConnecting(false)
      if (e?.code === 'timeout') {
        setCcError('Connection timed out. CompanyCam did not respond. Try again.')
        return
      }
      console.error('CompanyCam auth error:', e)
      const code = e?.code || ''
      if (code === 'functions/unavailable' || code === 'functions/not-found') {
        setCcError('CompanyCam integration is not deployed on the server yet.')
      } else {
        setCcError('Could not connect to CompanyCam. Try again.')
      }
    }
  }

  const handleDisconnectCC = async () => {
    if (!ccConnected) return
    if (!window.confirm('Disconnect CompanyCam? Photo sync will stop until you reconnect.')) return
    setCcDisconnecting(true)
    setCcError('')
    setCcInfo('')
    try {
      await httpsCallable(functions, 'ccDisconnect')()
      setCcInfo('CompanyCam disconnected.')
    } catch (e) {
      console.error('CompanyCam disconnect error:', e)
      setCcError('Could not disconnect. The connection is unchanged. Try again.')
    } finally {
      setCcDisconnecting(false)
    }
  }

  const handleSyncCC = async () => {
    setCcSyncing(true)
    setCcError('')
    setCcInfo('')
    try {
      const { data } = await httpsCallable(functions, 'ccSyncPhotos')()
      const n = data?.photosWritten ?? 0
      const m = data?.matchedProjects ?? 0
      toast({ tone: 'success', title: 'CompanyCam sync complete', description: `${n} photo${n === 1 ? '' : 's'} across ${m} matched project${m === 1 ? '' : 's'}.` })
    } catch (e) {
      console.error('CompanyCam sync error:', e)
      const code = e?.code || ''
      const msg = (code === 'functions/unavailable' || code === 'functions/not-found')
        ? 'Photo sync is not deployed on the server yet.'
        : 'Could not sync photos. Try again.'
      toast({ tone: 'error', title: 'CompanyCam sync failed', description: msg })
    } finally {
      setCcSyncing(false)
    }
  }

  const handleEnablePush = async () => {
    setPushBusy(true)
    try {
      await enablePushNotifications()
      toast({ tone: 'success', title: 'Notifications enabled', description: 'This device will receive P2 alerts.' })
    } catch (e) {
      console.error('Push enable error:', e)
      toast({ tone: 'error', title: 'Could not enable notifications', description: e?.message || 'Try again.' })
    } finally {
      setPushBusy(false)
    }
  }

  // Owner only. The function checks the role again; this button is only a way to run it.
  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      // It reads whole collections, so it is given longer than the 70 seconds a call gets by default.
      const { data } = await httpsCallable(functions, 'backfillScopes', { timeout: 540000 })()
      toast({ tone: 'success', title: 'Access scopes backfilled', description: backfillSummary(data) })
    } catch (e) {
      console.error('Backfill error:', e)
      toast({ tone: 'error', title: 'Backfill failed', description: callableMessage(e, 'Could not run the backfill. Try again.') })
    } finally {
      setBackfilling(false)
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
        <h1 className="text-2xl font-semibold" style={{ color: BRAND }}>Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Feature configuration, account, and system info</p>
      </div>

      {/* ── Feature Toggles ──────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <SettingsIcon size={15} style={{ color: BRAND }} /> Feature Toggles
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-white/5 px-6">
          {TOGGLE_DEFS.map(({ key, label, desc, Icon, def }) => (
            <div key={key} className="flex items-center justify-between py-3.5 gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 p-1.5 rounded-lg shrink-0" style={{ backgroundColor: withAlpha(BRAND, 0.1) }}>
                  <Icon size={13} style={{ color: BRAND }} />
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
            <LinkIcon size={15} style={{ color: BRAND }} /> QuickBooks Integration
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
              style={{ backgroundColor: BRAND }}
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

      {/* ── CompanyCam Integration ───────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CameraIcon size={15} style={{ color: BRAND }} /> CompanyCam Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-5 space-y-3">
          <div className="flex items-center gap-2">
            {ccConnected
              ? <CheckCircleIcon size={14} className="text-green-400 shrink-0" />
              : <div className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0" />
            }
            <span className="text-sm">
              {ccConnected ? 'CompanyCam connected' : 'Not connected'}
            </span>
          </div>
          {ccConnected && (
            <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
              {ccScope && <p>Access: <span className="">{ccScope}</span></p>}
              {ccConnectedAt && <p>Connected {ccConnectedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            </div>
          )}
          {!ccConnected && (
            <p className="text-xs text-muted-foreground pl-1">
              Connect to auto-pull jobsite photos. Once connected, enable <span className="text-zinc-300">CompanyCam Sync</span> above to turn on auto-pull.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="text-xs h-8 text-white"
              style={{ backgroundColor: BRAND }}
              onClick={handleConnectCC}
              disabled={ccConnecting || ccDisconnecting}
            >
              {ccConnecting ? 'Redirecting…' : ccConnected ? 'Reconnect CompanyCam' : 'Connect CompanyCam'}
            </Button>
            {ccConnected && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-white/20"
                  onClick={handleSyncCC}
                  disabled={ccSyncing || ccConnecting || ccDisconnecting}
                >
                  {ccSyncing ? 'Syncing…' : 'Sync photos now'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-white/20"
                  onClick={handleDisconnectCC}
                  disabled={ccConnecting || ccDisconnecting || ccSyncing}
                >
                  {ccDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </>
            )}
          </div>
          {ccConnected && ccSync?.syncedAt && (
            <p className="text-[11px] text-muted-foreground pl-1">
              Last sync {new Date(ccSync.syncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {typeof ccSync.photosWritten === 'number' ? ` · ${ccSync.photosWritten} photos` : ''}
              {typeof ccSync.matchedProjects === 'number' ? ` · ${ccSync.matchedProjects} projects matched` : ''}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground pl-1">
            Photos auto-sync every 6 hours and land on jobs matched by address — visible in the client portal and project documents.
          </p>
          {ccError && <p className="text-xs text-red-400 mt-2">{ccError}</p>}
          {ccInfo  && <p className="text-xs text-green-400 mt-2">{ccInfo}</p>}
        </CardContent>
      </Card>

      {/* ── Push Notifications ───────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BellIcon size={15} style={{ color: BRAND }} /> Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            Get alerts on this device for inspection results, change-order approvals, and billing updates.
          </p>
          <Button
            size="sm"
            className="text-xs h-8 text-white"
            style={{ backgroundColor: BRAND }}
            onClick={handleEnablePush}
            disabled={pushBusy}
          >
            {pushBusy ? 'Enabling…' : 'Enable on this device'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Access Scopes (owner only) ───────────────────────────────── */}
      {role === 'owner' && (
        <Card className="border-white/10 bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldIcon size={15} style={{ color: BRAND }} /> Access Scopes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-5 space-y-3">
            <Button
              size="sm"
              className="text-xs h-8 text-white"
              style={{ backgroundColor: BRAND }}
              onClick={handleBackfill}
              disabled={backfilling}
            >
              {backfilling ? 'Running…' : 'Backfill access scopes'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Writes tenant and client access fields onto every job, change order, submission and notification, and refreshes everyone's sign in claims. Safe to run more than once.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Account ──────────────────────────────────────────────────── */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldIcon size={15} style={{ color: BRAND }} /> Account
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
                  style={{ backgroundColor: BRAND }}
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
            <ServerIcon size={15} style={{ color: BRAND }} /> System
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
              { label: 'CompanyCam',       value: ccConnected ? 'Connected' : 'Not connected' },
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
