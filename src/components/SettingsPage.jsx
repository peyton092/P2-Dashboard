import { useState, useEffect } from 'react'
import {
  updatePassword, EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth'
import { doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase'
import { enablePushNotifications } from '../lib/push'
import { useData } from '../DataContext'
import { useToast } from '@/components/ui/toast'
import { useDialog } from '@/components/ui/dialog'
import { PageHeader, DataPanel } from './shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SettingsIcon, ShieldIcon, ServerIcon,
  BellIcon, MailIcon, BrainCircuitIcon, CameraIcon, MapPinIcon,
  ClipboardListIcon, DollarSignIcon, ZapIcon, Building2Icon,
  LogOutIcon, CheckCircleIcon, LinkIcon, KeyboardIcon,
  DownloadCloudIcon,
} from 'lucide-react'
import { useInstallPrompt } from '../lib/installPrompt'

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
  const toast = useToast()
  const { confirm } = useDialog()

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
    const ok = await confirm({
      title: 'Disconnect QuickBooks?',
      description: 'Auto-sync of invoices will stop until you reconnect.',
      confirmLabel: 'Disconnect',
      tone: 'destructive',
    })
    if (!ok) return
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

  const handleConnectCC = async () => {
    setCcConnecting(true)
    setCcError('')
    setCcInfo('')
    const timeout = setTimeout(() => {
      setCcConnecting(false)
      setCcError('Connection timed out — CompanyCam auth did not respond. Try again.')
    }, 10000)
    try {
      const { data } = await httpsCallable(functions, 'ccAuth')()
      clearTimeout(timeout)
      if (!data?.authUrl) {
        setCcConnecting(false)
        setCcError('CompanyCam integration is not configured on the server yet. Contact support.')
        return
      }
      window.location.href = data.authUrl
    } catch (e) {
      clearTimeout(timeout)
      console.error('CompanyCam auth error:', e)
      setCcConnecting(false)
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
    const ok = await confirm({
      title: 'Disconnect CompanyCam?',
      description: 'Photo sync will stop until you reconnect.',
      confirmLabel: 'Disconnect',
      tone: 'destructive',
    })
    if (!ok) return
    setCcDisconnecting(true)
    setCcError('')
    setCcInfo('')
    try {
      try {
        await httpsCallable(functions, 'ccDisconnect')()
      } catch {
        // Fallback: clear the token doc directly so the UI reflects disconnect.
        await deleteDoc(doc(db, 'cc_config', 'tokens'))
      }
      setCcInfo('CompanyCam disconnected.')
    } catch (e) {
      console.error('CompanyCam disconnect error:', e)
      setCcError('Could not disconnect. Try again.')
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

  const getVal = (key, def) =>
    settings && key in settings ? settings[key] : def

  const handleToggle = async (key, value) => {
    await setDoc(doc(db, 'config', 'settings'), { [key]: value }, { merge: true })
  }

  const [backfillBusy, setBackfillBusy] = useState(false)
  const { available: canInstall, install } = useInstallPrompt()
  const handleInstall = async () => {
    const outcome = await install()
    if (outcome === 'accepted')      toast({ tone: 'success', title: 'Installed', description: 'Look for P2 on your home screen.' })
    else if (outcome === 'dismissed') toast({ tone: 'info',    title: 'Install dismissed' })
    else                              toast({ tone: 'info',    title: 'Install not available on this device' })
  }
  const runBackfill = async (dryRun) => {
    setBackfillBusy(true)
    try {
      const { data } = await httpsCallable(functions, 'backfillScoping')({ dryRun })
      const lines = Object.entries(data?.summary || {})
        .map(([col, s]) => `${col}: ${s.touched}/${s.total} ${dryRun ? 'would update' : 'updated'}`)
        .join(' · ')
      toast({
        tone: 'success',
        title: dryRun ? 'Backfill preview' : 'Backfill complete',
        description: lines || 'No documents touched.',
      })
    } catch (e) {
      console.error('backfillScoping error:', e)
      toast({ tone: 'error', title: 'Backfill failed', description: e?.message || 'See console.' })
    } finally {
      setBackfillBusy(false)
    }
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
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        eyebrow="System"
        title="Settings"
        subtitle="Feature configuration, account, and system info"
      />

      {/* ── Feature Toggles ──────────────────────────────────────────── */}
      <DataPanel title="Feature Toggles" Icon={SettingsIcon}>
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
        </DataPanel>

      {/* ── QuickBooks Integration ───────────────────────────────────── */}
      <DataPanel title="QuickBooks Integration" Icon={LinkIcon}>
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
        </DataPanel>

      {/* ── CompanyCam Integration ───────────────────────────────────── */}
      <DataPanel title="CompanyCam Integration" Icon={CameraIcon}>
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
              style={{ backgroundColor: O }}
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
        </DataPanel>

      {/* ── Push Notifications ───────────────────────────────────────── */}
      <DataPanel title="Push Notifications" Icon={BellIcon}>
          <p className="text-xs text-muted-foreground">
            Get alerts on this device for inspection results, change-order approvals, and billing updates.
          </p>
          <Button
            size="sm"
            className="text-xs h-8 text-white"
            style={{ backgroundColor: O }}
            onClick={handleEnablePush}
            disabled={pushBusy}
          >
            {pushBusy ? 'Enabling…' : 'Enable on this device'}
          </Button>
        </DataPanel>

      {/* ── Account ──────────────────────────────────────────────────── */}
      <DataPanel title="Account" Icon={ShieldIcon}>
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
        </DataPanel>

      {/* ── Keyboard shortcuts ───────────────────────────────────────── */}
      <DataPanel
        title="Keyboard shortcuts"
        Icon={KeyboardIcon}
        actions={
          <Button
            variant="outline"
            className="border-white/15 text-zinc-200 text-xs h-8"
            onClick={() => window.dispatchEvent(new CustomEvent('p2:open-shortcuts'))}
          >
            View as dialog
          </Button>
        }
      >
          <ul className="divide-y divide-white/5">
            {[
              { keys: ['⌘', 'K'],    label: 'Open command palette' },
              { keys: ['Ctrl', 'K'], label: 'Open command palette (Windows / Linux)' },
              { keys: ['/'],         label: 'Open command palette (anywhere outside an input)' },
              { keys: ['?'],         label: 'Open the keyboard-shortcuts dialog' },
              { keys: ['↑', '↓'],    label: 'Navigate results in the command palette' },
              { keys: ['↵'],         label: 'Open the selected result' },
              { keys: ['←', '→'],    label: 'Previous / next photo in the lightbox' },
              { keys: ['Esc'],       label: 'Close the palette, lightbox, or dialog' },
            ].map(({ keys, label }) => (
              <li key={label} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-zinc-200">{label}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {keys.map(k => (
                    <kbd
                      key={k}
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-white/15 text-zinc-300 bg-white/[0.04] min-w-[18px] text-center"
                    >{k}</kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DataPanel>

      {/* ── Install this app ─────────────────────────────────────────── */}
      {canInstall && (
        <DataPanel
          title="Install on this device"
          description="Add P2 to your home screen for a native-feeling launch and offline access."
          Icon={DownloadCloudIcon}
        >
          <Button onClick={handleInstall} className="text-white" style={{ backgroundColor: O }}>
            <DownloadCloudIcon size={14} /> Install
          </Button>
        </DataPanel>
      )}

      {/* ── Reset stored preferences ─────────────────────────────────── */}
      <DataPanel
        title="Reset preferences"
        description="Clear remembered filters, saved views, and last-visited tab. Useful when filters get into a stuck state or before handing the device to someone else."
        Icon={KeyboardIcon}
      >
        <Button
          variant="outline"
          className="border-white/15 text-zinc-200"
          onClick={async () => {
            const ok = await confirm({
              title: 'Reset all preferences?',
              description: 'Removes saved filters, sort orders, the last-viewed tab, and saved views. Your account and data are not affected.',
              confirmLabel: 'Reset',
              tone: 'destructive',
            })
            if (!ok) return
            try {
              const prefixes = ['p2_sticky_', 'p2_views_', 'p2_recent_jobs']
              const keys = Object.keys(localStorage)
              keys.forEach(k => {
                if (prefixes.some(p => k.startsWith(p))) localStorage.removeItem(k)
              })
              toast({ tone: 'success', title: 'Preferences reset', description: 'Reload to see the defaults.' })
            } catch (err) {
              toast({ tone: 'error', title: 'Reset failed', description: err.message || 'Try again.' })
            }
          }}
        >
          Reset filters &amp; saved views
        </Button>
      </DataPanel>

      {/* ── Security migration ───────────────────────────────────────── */}
      <DataPanel
        title="Security backfill"
        description="Phase 1 of the operational-data scoping rollout (audit C-1). Adds tenantId / clientUids to legacy docs. Idempotent. Staff only."
        Icon={ShieldIcon}
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            disabled={backfillBusy}
            onClick={() => runBackfill(true)}
            className="border-white/15 text-zinc-200"
          >
            {backfillBusy ? 'Working…' : 'Dry run (count only)'}
          </Button>
          <Button
            disabled={backfillBusy}
            onClick={() => runBackfill(false)}
            className="text-white"
            style={{ backgroundColor: O }}
          >
            {backfillBusy ? 'Working…' : 'Run backfill'}
          </Button>
        </div>
        <p className="text-[11px] text-zinc-400 mt-2.5">
          Run dry-run first to see what would change. See SECURITY_ROLLOUT.md
          for the full staged plan.
        </p>
      </DataPanel>

      {/* ── System Info ──────────────────────────────────────────────── */}
      <DataPanel title="System" Icon={ServerIcon}>
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
        </DataPanel>
    </div>
  )
}
