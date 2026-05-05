import { useState, useEffect, lazy, Suspense } from 'react'
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, secondaryAuth, db, functions } from './firebase'
import { httpsCallable } from 'firebase/functions'
import { DataProvider, useData } from './DataContext'
import {
  addExtra, updateNotification, updateJob, updateExtra,
  sendExtraToQBS, approveExtra, rejectExtra,
  passInspection, failInspection, createJob, addSubmit, updatePermit,
  addUrgentItem, resolveUrgentItem,
  addMaterial, updateMaterial, useHistory, addHistory,
} from './hooks/useFirestore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ShieldIcon, AlertTriangleIcon, CheckCircleIcon, Building2Icon,
  WrenchIcon, DollarSignIcon, FileTextIcon, BellIcon,
  UsersIcon, PackageIcon, ClipboardIcon, MapPinIcon,
  ZapIcon, TruckIcon, CalendarIcon, ClockIcon, TrendingUpIcon,
  TargetIcon, StarIcon, LockIcon, LogOutIcon,
  ChevronRightIcon, ChevronLeftIcon, PlusIcon, XIcon, CheckIcon,
  AlertCircleIcon, InfoIcon, SearchIcon,
  DownloadIcon, PencilIcon, Trash2Icon, PhoneIcon, MailIcon,
  BarChart2Icon, ActivityIcon, SendIcon,
  MessageSquareIcon, FolderIcon, HammerIcon,
  ArrowUpIcon, RefreshCwIcon,
  DatabaseIcon, ServerIcon, CloudIcon, CodeIcon, LayersIcon,
  MenuIcon,
  ClipboardListIcon,
  SettingsIcon,
  TrophyIcon,
  BrainCircuitIcon,
  MoreHorizontalIcon,
  ReceiptIcon,
  // Phase 3 QA — standardized nav icons
  GaugeIcon, RadarIcon, UserRoundCogIcon, TriangleAlertIcon,
  FilePenLineIcon, ScanSearchIcon, HardHatIcon, BadgeCheckIcon,
  NotebookPenIcon, CalendarClockIcon, BoxesIcon, ClipboardSignatureIcon,
  UsersRoundIcon, FolderOpenIcon, BarChart3Icon,
} from 'lucide-react'
const CommandCenterComponent  = lazy(() => import('./components/CommandCenter'))
const QBSBuilderPortalComponent = lazy(() => import('./components/QBSBuilderPortal'))
const ProjectFoldersComponent  = lazy(() => import('./components/ProjectFolders'))
const SubmitInboxComponent     = lazy(() => import('./components/SubmitInbox'))
const CrewReportComponent      = lazy(() => import('./components/CrewReport'))
const ChangeOrdersComponent    = lazy(() => import('./components/ChangeOrders'))
const SettingsPageComponent    = lazy(() => import('./components/SettingsPage'))
const AnalyticsComponent       = lazy(() => import('./components/Analytics'))
const TeamLeaderboardComponent = lazy(() => import('./components/TeamLeaderboard'))
const InvoiceAuditorComponent  = lazy(() => import('./components/InvoiceAuditor'))
import WarRoomComponent from './components/WarRoom'
import PMDashboardComponent from './components/PMDashboard'
import AlertsPageComponent from './components/AlertsPage'
import BillingQueueComponent from './components/BillingQueue'
import ErrorBoundary from './components/ErrorBoundary'
import { generateInvoicePdf } from './lib/generateInvoicePdf'
import AppShell from './components/shell/AppShell'
import Sidebar from './components/shell/Sidebar'
import MobileNav from './components/shell/MobileNav'

const O = '#F47920'

const TENANTS = [
  { id: 'p2-core', name: 'P2 Internal',          slug: 'p2'     },
  { id: 'qbs',     name: 'QBS Builder Portal',    slug: 'qbs'    },
  { id: 'vision',  name: 'Vision Building Group', slug: 'vision' },
]

// ── Navigation ────────────────────────────────────────────────────────────────

// NAV_SECTIONS is the source of truth for desktop sidebar grouping.
// Each `id` must match a key in `TAB_COMPONENTS` in MainDashboard.
const NAV_SECTIONS = [
  {
    heading: 'Command',
    items: [
      { id: 'command-center', label: 'Command Center', Icon: GaugeIcon },
      { id: 'war-room',       label: 'War Room',       Icon: RadarIcon },
      { id: 'pm-dashboard',   label: 'PM Dashboard',   Icon: UserRoundCogIcon },
      { id: 'alerts',         label: 'Alerts',         Icon: TriangleAlertIcon },
    ],
  },
  {
    heading: 'Cash Flow',
    items: [
      { id: 'billing-queue',   label: 'Billing Queue',   Icon: DollarSignIcon },
      { id: 'billing',         label: 'Billing',         Icon: ReceiptIcon },
      { id: 'extras',          label: 'Change Orders',   Icon: FilePenLineIcon },
      { id: 'invoice-auditor', label: 'Invoice Auditor', Icon: ScanSearchIcon },
    ],
  },
  {
    heading: 'Field',
    items: [
      { id: 'jobs',         label: 'Job Status',       Icon: HardHatIcon },
      { id: 'inspections',  label: 'Inspections',      Icon: BadgeCheckIcon },
      { id: 'daily-report', label: 'Daily Report',     Icon: NotebookPenIcon },
      { id: 'morning',      label: 'Morning Briefing', Icon: CalendarClockIcon },
      { id: 'materials',    label: 'Materials',        Icon: BoxesIcon },
      { id: 'permits',      label: 'Permits',          Icon: ClipboardSignatureIcon },
      { id: 'subs',         label: 'Subs',             Icon: UsersRoundIcon },
    ],
  },
  {
    heading: 'Workspace',
    items: [
      { id: 'folders',       label: 'Documents',     Icon: FolderOpenIcon },
      { id: 'submit',        label: 'Submit',        Icon: SendIcon },
      { id: 'notifications', label: 'Notifications', Icon: BellIcon },
      { id: 'analytics',     label: 'Reports',       Icon: BarChart3Icon },
      { id: 'team',          label: 'Team',          Icon: TrophyIcon },
    ],
  },
  {
    heading: 'System',
    items: [
      { id: 'architecture', label: 'Architecture', Icon: DatabaseIcon },
      { id: 'settings',     label: 'Settings',     Icon: SettingsIcon },
    ],
  },
]

// Mobile primary nav (4 thumb-reachable items + a "More" drawer).
const MOBILE_PRIMARY = [
  { id: 'command-center', label: 'Command',  Icon: GaugeIcon },
  { id: 'war-room',       label: 'War Room', Icon: RadarIcon },
  { id: 'billing-queue',  label: 'Billing',  Icon: DollarSignIcon },
  { id: 'jobs',           label: 'Jobs',     Icon: HardHatIcon },
]

const MOBILE_MORE = [
  { id: 'pm-dashboard',  label: 'PMs',         Icon: UserRoundCogIcon },
  { id: 'alerts',        label: 'Alerts',      Icon: TriangleAlertIcon },
  { id: 'extras',        label: 'COs',         Icon: FilePenLineIcon },
  { id: 'inspections',   label: 'Inspections', Icon: BadgeCheckIcon },
  { id: 'daily-report',  label: 'Report',      Icon: NotebookPenIcon },
  { id: 'morning',       label: 'Briefing',    Icon: CalendarClockIcon },
  { id: 'submit',        label: 'Submit',      Icon: SendIcon },
  { id: 'notifications', label: 'Notifs',      Icon: BellIcon },
  { id: 'folders',       label: 'Documents',   Icon: FolderOpenIcon },
  { id: 'materials',     label: 'Materials',   Icon: BoxesIcon },
  { id: 'permits',       label: 'Permits',     Icon: ClipboardSignatureIcon },
  { id: 'subs',          label: 'Subs',        Icon: UsersRoundIcon },
  { id: 'analytics',     label: 'Reports',     Icon: BarChart3Icon },
  { id: 'team',          label: 'Team',        Icon: TrophyIcon },
  { id: 'settings',      label: 'Settings',    Icon: SettingsIcon },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (n) => `$${Number(n).toLocaleString()}`

const jobName = (j) => j.name || j.client.split(' ')[0]

const BILLING_STATUSES = ['not-invoiced', 'invoiced', 'partial-pay', 'paid']
const BILLING_STATUS_LABEL = {
  'not-invoiced': 'Not Invoiced',
  'invoiced':     'Invoiced',
  'partial-pay':  'Partial Pay',
  'paid':         'Paid',
}
const BILLING_STATUS_COLOR = {
  'not-invoiced': '#6b7280',
  'invoiced':     '#3b82f6',
  'partial-pay':  '#eab308',
  'paid':         '#22c55e',
}

const inspMeta = {
  passed:    { color: '#22c55e', label: 'PASSED'    },
  failed:    { color: '#ef4444', label: 'FAILED'    },
  scheduled: { color: '#eab308', label: 'SCHEDULED' },
  pending:   { color: '#6b7280', label: 'PENDING'   },
  blocked:   { color: '#3b82f6', label: 'BLOCKED'   },
  'n/a':     { color: '#374151', label: 'N/A'       },
}
const iMeta = (s) => inspMeta[s] || { color: '#6b7280', label: (s || '').toUpperCase() }

const statusMeta = {
  'on-track':     { color: '#22c55e', label: 'ON TRACK'     },
  'needs-action': { color: O,         label: 'NEEDS ACTION' },
  'at-risk':      { color: '#eab308', label: 'AT RISK'      },
  'blocked':      { color: '#ef4444', label: 'BLOCKED'      },
  'complete':     { color: '#22c55e', label: 'COMPLETE'     },
  'completed':    { color: '#22c55e', label: 'COMPLETED'    },
  'active':       { color: O,         label: 'ACTIVE'       },
  'hold':         { color: '#ef4444', label: 'ON HOLD'      },
  'pending':      { color: '#6b7280', label: 'PENDING'      },
}
const sMeta = (s) => statusMeta[s] || { color: '#6b7280', label: s.toUpperCase() }

const tradeColor = { HVAC: '#3b82f6', Plumbing: '#06b6d4', Electrical: O }

const CREW_LIST = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']
const TODAY = new Date()
const _yd = new Date(TODAY); _yd.setDate(_yd.getDate() - 1)
const YESTERDAY_STR = _yd.toISOString().slice(0, 10)

const daysSince = (date) => {
  if (!date) return null
  try {
    const d = date?.toDate ? date.toDate() : new Date(date)
    if (isNaN(d.getTime())) return null
    return Math.floor((TODAY - d) / 86400000)
  } catch { return null }
}

const phaseLabel = (p) => p >= 67 ? 'Final Phase' : p >= 34 ? 'Mid Phase' : 'Rough-In Phase'

// ── Reusable components ───────────────────────────────────────────────────────

function ProgressBar({ value, color = O, className = '' }) {
  return (
    <div className={`h-2 bg-white/10 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
      />
    </div>
  )
}

function StatCard({ label, value, sub, trend, Icon }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{label}</p>
          {Icon && <div className="p-2 rounded-lg" style={{ backgroundColor: O + '22' }}><Icon size={16} style={{ color: O }} /></div>}
        </div>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
        {trend !== undefined && (
          <div className="flex items-center gap-1 mt-2">
            <ArrowUpIcon size={11} style={{ color: trend ? '#22c55e' : '#ef4444', transform: trend ? 'none' : 'rotate(180deg)' }} />
            <span className="text-xs" style={{ color: trend ? '#22c55e' : '#ef4444' }}>
              {trend ? '+8%' : '-3%'} vs last month
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InspBadge({ status }) {
  const { color, label } = iMeta(status)
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full tracking-wider"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  )
}

function JobBadge({ status }) {
  const { color, label } = sMeta(status)
  return (
    <span className="text-xs font-bold px-3 py-1 rounded-full tracking-wider"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
      {label}
    </span>
  )
}

function BillingStatusSelect({ job }) {
  const status = job.billingStatus || 'not-invoiced'
  const color  = BILLING_STATUS_COLOR[status] || '#6b7280'
  const label  = BILLING_STATUS_LABEL[status]  || 'Not Invoiced'
  return (
    <Select
      value={status}
      onValueChange={v => job._docId && updateJob(job._docId, { billingStatus: v })}
    >
      <SelectTrigger className="h-auto py-1 px-3 text-xs font-bold border rounded-full min-w-[7.5rem]"
        style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BILLING_STATUSES.map(s => (
          <SelectItem key={s} value={s}>{BILLING_STATUS_LABEL[s]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const JOB_STATUS_OPTIONS = [
  { value: 'on-track',     label: 'On Track',     color: '#22c55e' },
  { value: 'needs-action', label: 'Needs Action', color: O         },
  { value: 'at-risk',      label: 'At Risk',      color: '#eab308' },
  { value: 'blocked',      label: 'Blocked',      color: '#ef4444' },
  { value: 'complete',     label: 'Complete',     color: '#22c55e' },
  { value: 'active',       label: 'Active',       color: O         },
  { value: 'hold',         label: 'On Hold',      color: '#ef4444' },
  { value: 'completed',    label: 'Completed',    color: '#22c55e' },
  { value: 'pending',      label: 'Pending',      color: '#6b7280' },
]

const PHASE_OPTIONS = ['Precon', 'Rough-In', 'Service Release', 'Trim', 'Final', 'Closeout', 'Complete']

function InlineStatusSelect({ job }) {
  const opt = JOB_STATUS_OPTIONS.find(o => o.value === job.status) || JOB_STATUS_OPTIONS[5]
  const handleChange = (v) => { if (job._docId) updateJob(job._docId, { status: v }) }
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={job.status} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-3 text-xs font-bold border rounded-full w-auto gap-1"
          style={{ backgroundColor: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {JOB_STATUS_OPTIONS.slice(0, 5).map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function InlinePhaseSelect({ job }) {
  const current = job.phase || phaseLabel(job.progress)
  const handleChange = (v) => { if (job._docId) updateJob(job._docId, { phase: v }) }
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={current} onValueChange={handleChange}>
        <SelectTrigger className="h-auto py-0.5 px-3 text-xs border rounded-full w-auto gap-1 bg-white/10 border-white/20 text-muted-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PHASE_OPTIONS.map(p => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SectionHeader({ title, sub, action }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onSignup }) {
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
          <p className="font-black text-2xl leading-none" style={{ color: O }}>P2</p>
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

// ── Create User Modal (owner / internal only) ─────────────────────────────────

function CreateUserModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('internal')
  const [tenantId, setTenantId] = useState('qbs')
  const [displayName, setDisplayName] = useState('')
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
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: email.trim(),
        displayName: displayName.trim() || email.trim(),
        role,
        tenantId: role === 'builder' ? tenantId : 'p2-core',
        createdAt: new Date().toISOString(),
      })
      await signOut(secondaryAuth)
      setSuccess(`Account created for ${email.trim()}.`)
      setEmail(''); setPassword(''); setDisplayName('')
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-96 border-white/10 bg-zinc-900">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <UsersIcon size={14} style={{ color: O }} /> Create User Account
          </CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><XIcon size={16} /></button>
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

// ── Terms Gate ────────────────────────────────────────────────────────────────

function TermsGate({ tenantId, tenantName, onAccept }) {
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const version = 'v2026.04.16'

  const handleAccept = async () => {
    if (!checked) return
    const u = auth.currentUser
    setSaving(true)
    try {
      if (u) {
        await setDoc(
          doc(db, 'users', u.uid, 'termsAcceptances', version),
          {
            acceptedAt: new Date().toISOString(),
            version,
            tenantId,
            email: u.email || null,
          },
          { merge: true },
        )
      }
    } catch (err) {
      // Don't block portal entry if logging fails — but record it.
      console.error('[TermsGate] Could not persist acceptance:', err)
    } finally {
      setSaving(false)
      onAccept()
    }
  }

  return (
    <div className="dark min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: O }}>
          <ShieldIcon size={20} color="#fff" />
        </div>
        <div>
          <p className="font-bold text-lg leading-none">P2 Field Control</p>
          <p className="text-xs text-muted-foreground">{tenantName} · Builder Portal</p>
        </div>
      </div>

      <Card className="w-full max-w-lg border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileTextIcon size={16} style={{ color: O }} /> Terms of Access · {version}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-3 p-4 rounded-xl bg-white/5 max-h-64 overflow-y-auto">
            <p className="font-semibold text-foreground">P2 Field Control — Builder Portal Access Agreement</p>
            <p>By accessing this portal, you agree to the following terms:</p>
            <p><strong>1. Authorized Use.</strong> This portal is provided exclusively for authorized contractors and coordinators. Access credentials must not be shared.</p>
            <p><strong>2. Data Confidentiality.</strong> All project data, financial information, and documents accessed through this portal are confidential to P2 Field Services and its clients.</p>
            <p><strong>3. Scope of Access.</strong> You may only access data pertaining to your assigned projects and workspace ({tenantName}).</p>
            <p><strong>4. Change Order Approval.</strong> Change orders approved through this portal are legally binding and constitute authorization to proceed.</p>
            <p><strong>5. Audit Logging.</strong> All actions taken in this portal are logged with timestamp and user identity.</p>
            <p className="text-xs">Version {version} · P2 Field Services LLC · Middle Tennessee</p>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl border border-white/10 cursor-pointer" onClick={() => setChecked(c => !c)}>
            <div className="w-5 h-5 rounded border flex items-center justify-center shrink-0"
              style={{ borderColor: checked ? O : '#6b7280', backgroundColor: checked ? O : 'transparent' }}>
              {checked && <CheckIcon size={12} color="#fff" />}
            </div>
            <span className="text-sm">I have read and agree to the P2 Field Control Terms of Access ({version})</span>
          </div>

          <Button
            className="w-full text-white"
            style={{ backgroundColor: checked ? O : '#374151' }}
            disabled={!checked || saving}
            onClick={handleAccept}>
            {saving ? 'Recording acceptance…' : 'Accept & Enter Portal'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}


// ── Urgent Items ──────────────────────────────────────────────────────────────

function UrgentItems() {
  const { urgentItems, jobs } = useData()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ jobId: '', priority: 'HIGH', desc: '', flaggedBy: '' })
  const [submitting, setSubmitting] = useState(false)

  const sorted = [...(urgentItems || [])].sort((a, b) => {
    const pa = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    return (pa[a.priority] ?? 3) - (pa[b.priority] ?? 3)
  })
  const activeCount = sorted.filter(i => !i.resolved).length

  const pStyle = {
    CRITICAL: { border: '#ef4444', bg: '#ef444411', lc: '#ef4444' },
    HIGH:     { border: '#f97316', bg: '#f9731611', lc: '#f97316' },
    MEDIUM:   { border: '#eab308', bg: '#eab30811', lc: '#eab308' },
  }

  const handleAdd = async () => {
    if (!form.desc.trim() || !form.flaggedBy.trim()) return
    setSubmitting(true)
    await addUrgentItem({ jobId: form.jobId || null, priority: form.priority, desc: form.desc.trim(), flaggedBy: form.flaggedBy.trim() })
    setForm({ jobId: '', priority: 'HIGH', desc: '', flaggedBy: '' })
    setShowForm(false)
    setSubmitting(false)
  }

  return (
    <Card className="border-red-500/30 mb-0" style={{ borderColor: '#ef444433' }}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircleIcon size={16} color="#ef4444" />
            Urgent Items
            {activeCount > 0 && (
              <span className="text-xs font-black px-2 py-0.5 rounded-full animate-pulse"
                style={{ backgroundColor: '#ef444422', color: '#ef4444' }}>
                {activeCount} ACTIVE
              </span>
            )}
            {activeCount === 0 && sorted.length === 0 && (
              <span className="text-xs text-muted-foreground font-normal">— Priority queue for field flags</span>
            )}
          </CardTitle>
          <Button size="sm" className="gap-1.5 text-xs"
            style={{ backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}
            onClick={() => setShowForm(v => !v)}>
            <PlusIcon size={11} /> Flag Urgent Item
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {showForm && (
          <div className="p-4 rounded-xl border mb-3 space-y-3" style={{ borderColor: '#ef444433', backgroundColor: '#ef444408' }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Job (optional)</label>
                <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full h-8 text-xs">
                    <SelectValue placeholder="General" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">General / No specific job</SelectItem>
                    {(jobs || []).filter(j => !['complete','completed'].includes(j.status)).map(j => (
                      <SelectItem key={j.id} value={j.id}>{j.id} — {j.name || j.client || j.address || j.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Priority *</label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">CRITICAL — Stop everything</SelectItem>
                    <SelectItem value="HIGH">HIGH — Today</SelectItem>
                    <SelectItem value="MEDIUM">MEDIUM — This week</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Flagged By *</label>
                <Input className="bg-white/5 border-white/20 h-8 text-xs" placeholder="Your name"
                  value={form.flaggedBy} onChange={e => setForm(f => ({ ...f, flaggedBy: e.target.value }))} />
              </div>
              <div className="flex items-end">
                <Button className="w-full h-8 text-xs text-white" style={{ backgroundColor: '#ef4444' }}
                  onClick={handleAdd} disabled={submitting || !form.desc.trim() || !form.flaggedBy.trim()}>
                  {submitting ? 'Flagging…' : 'Flag It'}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description *</label>
              <Input className="bg-white/5 border-white/20 text-xs" placeholder="Describe the urgent issue clearly..."
                value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} />
            </div>
          </div>
        )}

        {sorted.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground text-center py-3">No urgent items flagged — all clear.</p>
        )}

        {sorted.map((item, idx) => {
          const ps = pStyle[item.priority] || pStyle.MEDIUM
          const isCritical = item.priority === 'CRITICAL' && !item.resolved
          const ts = item.createdAt?.toDate?.()
            ? item.createdAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'Just now'
          return (
            <div key={item._docId || idx}
              className={`flex items-start justify-between p-3 rounded-xl border transition-all ${item.resolved ? 'opacity-40' : ''}`}
              style={{
                borderColor: item.resolved ? '#ffffff15' : ps.border + (isCritical ? 'aa' : '55'),
                backgroundColor: item.resolved ? 'transparent' : ps.bg,
                borderWidth: isCritical ? '2px' : '1px',
              }}>
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {isCritical && (
                  <span className="animate-pulse w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                    style={{ backgroundColor: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-black px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: ps.border + '22', color: ps.lc, border: `1px solid ${ps.border}44` }}>
                      {item.priority}
                    </span>
                    {item.jobId && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/10">{item.jobId}</span>
                    )}
                    <span className="text-xs text-muted-foreground">by <strong>{item.flaggedBy}</strong></span>
                    <span className="text-xs text-muted-foreground">{ts}</span>
                  </div>
                  <p className={`text-sm leading-snug ${item.resolved ? 'line-through text-muted-foreground' : ''}`}>
                    {item.desc}
                  </p>
                </div>
              </div>
              <button
                className="ml-3 shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-all"
                style={{
                  backgroundColor: item.resolved ? '#22c55e22' : '#ffffff0d',
                  color: item.resolved ? '#22c55e' : '#6b7280',
                  border: item.resolved ? '1px solid #22c55e44' : '1px solid #ffffff15',
                }}
                onClick={() => item._docId && resolveUrgentItem(item._docId, !item.resolved)}>
                {item.resolved
                  ? <><CheckIcon size={10} /> Resolved</>
                  : 'Mark Done'}
              </button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ── Tab: Morning Briefing ─────────────────────────────────────────────────────

function MorningBriefing() {
  const { dailyReports, jobs, subs: SUBS, notifs } = useData()
  const submittedYesterday = new Set(
    (dailyReports || []).filter(r => r.date === YESTERDAY_STR).map(r => r.crewMember)
  )

  const needsActionJobs = [...jobs]
    .filter(j => j.status === 'needs-action')
    .sort((a, b) => jobName(a).localeCompare(jobName(b)))

  const scheduledInspJobs = [...jobs]
    .filter(j => !['complete','completed'].includes(j.status) &&
      ['electrical','plumbing','hvac'].some(t => j.insp?.[t] && Object.values(j.insp[t]).includes('scheduled'))
    )
    .sort((a, b) => jobName(a).localeCompare(jobName(b)))

  const staleActionJobs = [...jobs]
    .filter(j => !['complete','completed'].includes(j.status))
    .map(j => ({ ...j, staleDays: daysSince(j.lastStatusChange || j.start) }))
    .filter(j => j.staleDays !== null && j.staleDays > 7)
    .sort((a, b) => b.staleDays - a.staleDays)
    .slice(0, 3)

  const actionItems = [
    ...needsActionJobs.map(j => ({
      priority: 'urgent',
      job: j.id,
      task: `${j.phase || phaseLabel(j.progress)} — action required`,
      crew: `PM: ${j.pm}${j.lead ? ` · Lead: ${j.lead}` : ''}`,
    })),
    ...scheduledInspJobs.flatMap(j => {
      const trades = ['electrical','plumbing','hvac'].filter(t =>
        j.insp?.[t] && Object.values(j.insp[t]).includes('scheduled')
      )
      return trades.map(t => {
        const phase = Object.entries(j.insp[t]).find(([,v]) => v === 'scheduled')?.[0] || 'phase'
        return {
          priority: 'high',
          job: j.id,
          task: `Inspection scheduled — ${t} ${phase}`,
          crew: `Sub: ${j.subs?.[t] || '—'} · PM: ${j.pm}`,
        }
      })
    }),
    ...staleActionJobs.map(j => ({
      priority: 'normal',
      job: j.id,
      task: `Stale ${j.staleDays} days — check-in needed`,
      crew: `PM: ${j.pm} · ${j.phase || phaseLabel(j.progress)}`,
    })),
  ].slice(0, 10)

  const activeSubNames = new Set()
  jobs.filter(j => !['complete','completed'].includes(j.status)).forEach(j => {
    if (j.subs?.electrical) activeSubNames.add(j.subs.electrical)
    if (j.subs?.plumbing)   activeSubNames.add(j.subs.plumbing)
    if (j.subs?.hvac)       activeSubNames.add(j.subs.hvac)
  })
  const crewOnField = activeSubNames.size

  const scores = [...(SUBS || [])]
    .sort((a, b) => b.score - a.score)
    .map(s => ({
      name: s.name,
      trade: s.trade,
      score: s.score,
      jobs: s.jobs,
    }))

  const openNotifCount = (notifs || []).filter(n => !n.read).length
  const pColor = { urgent: '#ef4444', high: O, normal: '#22c55e' }
  const dateStr = TODAY.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="space-y-6">
      <SectionHeader title="Morning Briefing" sub={`${dateStr} · Middle Tennessee`} />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Scheduled Inspections" value={scheduledInspJobs.length}
          sub={scheduledInspJobs.slice(0,2).map(j => jobName(j)).join(' · ') || 'None scheduled'}
          Icon={CheckCircleIcon} />
        <StatCard label="Crew on Field" value={crewOnField}
          sub={`of ${(SUBS||[]).length} registered subs`}
          Icon={UsersIcon} />
        <StatCard label="Open Action Items" value={openNotifCount}
          sub={`${needsActionJobs.length} job${needsActionJobs.length !== 1 ? 's' : ''} need action`}
          Icon={AlertTriangleIcon} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="border-white/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarIcon size={16} style={{ color: O }} /> Today's Priority Actions
                <span className="text-xs font-normal text-muted-foreground ml-1">derived from live job data</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {actionItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No urgent actions — all jobs on track.</p>
              )}
              {actionItems.map((s, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="w-1 h-10 rounded-full shrink-0" style={{ backgroundColor: pColor[s.priority] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs bg-white/10 px-2 py-0.5 rounded shrink-0">{s.job}</span>
                      <span className="text-sm font-medium truncate">{s.task}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.crew}</p>
                  </div>
                  <span className="text-xs uppercase font-bold px-2 py-0.5 rounded shrink-0"
                    style={{ color: pColor[s.priority], backgroundColor: pColor[s.priority] + '22' }}>
                    {s.priority}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="border-white/10 h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <StarIcon size={16} style={{ color: O }} /> Crew Scoreboard
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {scores.map((s, i) => (
                <div key={s.name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-4">#{i+1}</span>
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs" style={{ color: tradeColor[s.trade] }}>{s.trade}</p>
                      </div>
                    </div>
                    <span className="font-bold text-lg" style={{ color: s.score >= 90 ? '#22c55e' : s.score >= 80 ? O : '#ef4444' }}>
                      {s.score}
                    </span>
                  </div>
                  <ProgressBar value={s.score} color={s.score >= 90 ? '#22c55e' : s.score >= 80 ? O : '#ef4444'} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardIcon size={16} style={{ color: O }} /> Crew Reports — Yesterday ({YESTERDAY_STR})
            <span className="text-xs font-normal text-muted-foreground ml-1">
              {CREW_LIST.filter(n => submittedYesterday.has(n)).length}/{CREW_LIST.length} submitted
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {CREW_LIST.map(name => {
              const submitted = submittedYesterday.has(name)
              return (
                <div key={name} className="flex flex-col items-center gap-2 p-3 rounded-xl border"
                  style={{
                    borderColor: submitted ? '#22c55e44' : '#ef444444',
                    backgroundColor: submitted ? '#22c55e0a' : '#ef44440a',
                  }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: submitted ? '#22c55e22' : '#ef444422' }}>
                    {submitted
                      ? <CheckIcon size={18} color="#22c55e" />
                      : <XIcon size={18} color="#ef4444" />}
                  </div>
                  <p className="text-xs font-semibold text-center">{name}</p>
                  <p className="text-xs font-bold" style={{ color: submitted ? '#22c55e' : '#ef4444' }}>
                    {submitted ? 'Submitted' : 'MISSING'}
                  </p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Tab: Job Status ───────────────────────────────────────────────────────────

function JobStatus() {
  const { jobs, subs } = useData()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [showNewJob, setShowNewJob] = useState(false)
  const [jobForm, setJobForm] = useState({ id: '', address: '', city: '', client: '', type: 'Full MEP Renovation', pm: 'Blake Neblett', target: '', permitNumber: '', subElectrical: '', subPlumbing: '', subHvac: '' })
  const [creating, setCreating] = useState(false)

  const elecSubs = (subs || []).filter(s => s.trade === 'Electrical')
  const plumbSubs = (subs || []).filter(s => s.trade === 'Plumbing')
  const hvacSubs  = (subs || []).filter(s => s.trade === 'HVAC')

  const filtered = jobs
    .filter(j => {
      const q = search.toLowerCase()
      const match = j.id.toLowerCase().includes(q) || j.address.toLowerCase().includes(q) || j.client.toLowerCase().includes(q) || jobName(j).toLowerCase().includes(q)
      const statusMatch = statusFilter === 'all' || j.status === statusFilter
      return match && statusMatch
    })
    .sort((a, b) => jobName(a).localeCompare(jobName(b)))

  const handleCreateJob = async () => {
    if (!jobForm.id || !jobForm.address || !jobForm.client) return
    setCreating(true)
    await createJob({
      id: jobForm.id,
      address: jobForm.address,
      city: jobForm.city,
      client: jobForm.client,
      type: jobForm.type,
      pm: jobForm.pm,
      status: 'active',
      progress: 0,
      extras: 0,
      tenantId: 'qbs',
      lead: '',
      start: new Date().toISOString().slice(0, 10),
      target: jobForm.target || '',
      county: '',
      billingStatus: 'not-invoiced',
      permitNumber: jobForm.permitNumber || '',
      subs: { electrical: jobForm.subElectrical || null, plumbing: jobForm.subPlumbing || null, hvac: jobForm.subHvac || null },
      permits: { electrical: 'pending', plumbing: 'pending', hvac: 'pending' },
      insp: {
        electrical: { roughIn: 'pending', trim: 'blocked', final: 'blocked' },
        plumbing:   { roughIn: 'pending', final: 'blocked' },
        hvac:       { roughIn: 'pending', final: 'blocked' },
      },
    })
    setJobForm({ id: '', address: '', city: '', client: '', type: 'Full MEP Renovation', pm: 'Blake Neblett', target: '', permitNumber: '', subElectrical: '', subPlumbing: '', subHvac: '' })
    setShowNewJob(false)
    setCreating(false)
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Job Status"
        sub={`${jobs.filter(j => !['complete','completed'].includes(j.status)).length} active · ${jobs.length} total — Middle TN`}
        action={
          <Button onClick={() => setShowNewJob(v => !v)} style={{ backgroundColor: O }} className="text-white gap-2">
            <PlusIcon size={14} /> New Job
          </Button>
        }
      />

      {showNewJob && (
        <Card className="border-white/20" style={{ borderColor: O + '55' }}>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><PlusIcon size={14} style={{ color: O }} /> Create New Job</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Job ID *</label>
                <Input className="bg-white/5 border-white/20 font-mono" placeholder="QBS-045" value={jobForm.id} onChange={e => setJobForm(f => ({ ...f, id: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Street Address *</label>
                <Input className="bg-white/5 border-white/20" placeholder="123 Main St" value={jobForm.address} onChange={e => setJobForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">City, State ZIP</label>
                <Input className="bg-white/5 border-white/20" placeholder="Brentwood, TN 37027" value={jobForm.city} onChange={e => setJobForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Client *</label>
                <Input className="bg-white/5 border-white/20" placeholder="Client name" value={jobForm.client} onChange={e => setJobForm(f => ({ ...f, client: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Project Type</label>
                <Input className="bg-white/5 border-white/20" value={jobForm.type} onChange={e => setJobForm(f => ({ ...f, type: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">PM</label>
                <Select value={jobForm.pm} onValueChange={v => setJobForm(f => ({ ...f, pm: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Blake Neblett','Brendan Embry','Jeb Brooks','Taylor Hensley','Tim King','Derek Powers'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Target Date</label>
                <Input className="bg-white/5 border-white/20" type="date" value={jobForm.target} onChange={e => setJobForm(f => ({ ...f, target: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Permit Number</label>
                <Input className="bg-white/5 border-white/20 font-mono" placeholder="2026012345" value={jobForm.permitNumber} onChange={e => setJobForm(f => ({ ...f, permitNumber: e.target.value }))} />
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Electrical Sub</label>
                <Select value={jobForm.subElectrical} onValueChange={v => setJobForm(f => ({ ...f, subElectrical: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {elecSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Plumbing Sub</label>
                <Select value={jobForm.subPlumbing} onValueChange={v => setJobForm(f => ({ ...f, subPlumbing: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {plumbSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">HVAC Sub</label>
                <Select value={jobForm.subHvac} onValueChange={v => setJobForm(f => ({ ...f, subHvac: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {hvacSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button style={{ backgroundColor: O }} className="text-white" onClick={handleCreateJob} disabled={creating}>
                {creating ? 'Creating…' : 'Create Job'}
              </Button>
              <Button variant="outline" onClick={() => setShowNewJob(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 bg-white/5 border-white/20" placeholder="Search jobs, clients, addresses..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-white/5 border-white/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {filtered.map(j => (
          <Card key={j.id} className="border-white/10 overflow-hidden">
            <div
              className="p-5 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => setExpanded(expanded === j.id ? null : j.id)}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-black text-xl" style={{ color: O }}>{jobName(j)}</span>
                    <InlineStatusSelect job={j} />
                    <InlinePhaseSelect job={j} />
                  </div>
                  <p className="text-sm text-muted-foreground font-mono">{j.id} · {j.client}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><UsersIcon size={11} /> PM: {j.pm}</span>
                    {j.qbsPM && <span className="flex items-center gap-1"><UsersIcon size={11} /> QBS: {j.qbsPM}</span>}
                    <span className="flex items-center gap-1"><CalendarIcon size={11} /> Target: {j.target}</span>
                    {j.invoiceNum && <span className="flex items-center gap-1"><FileTextIcon size={11} /> Inv #{j.invoiceNum}</span>}
                  </div>
                </div>
                <div className="text-right w-40">
                  <p className="text-2xl font-black mb-1">{j.progress}%</p>
                  <ProgressBar value={j.progress} className="mb-2" />
                  <p className="text-xs text-muted-foreground">{j.type}</p>
                </div>
              </div>
            </div>

            {expanded === j.id && (
              <div className="border-t border-white/10 p-5 bg-white/3 grid md:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Subcontractors</p>
                  {['electrical','plumbing','hvac'].map(t => j.subs?.[t] && (
                    <div key={t} className="flex items-center justify-between py-1.5 border-b border-white/5">
                      <span className="text-sm capitalize" style={{ color: tradeColor[t.charAt(0).toUpperCase()+t.slice(1)] || '#9ca3af' }}>{t}</span>
                      <span className="text-sm font-medium">{j.subs[t]}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Permits</p>
                  {['electrical','plumbing','hvac'].map(t => j.permits?.[t] && (
                    <div key={t} className="flex items-center justify-between py-1.5 border-b border-white/5">
                      <span className="text-sm capitalize">{t}</span>
                      <InspBadge status={j.permits[t]} />
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Invoice Info</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Invoice #</span><span className="font-mono font-medium">{j.invoiceNum || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Invoice Date</span><span>{j.invoiceDate || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">QBS PM</span><span>{j.qbsPM || '—'}</span></div>
                    <div className="flex justify-between items-center border-t border-white/10 pt-2">
                      <span className="text-muted-foreground">Status</span>
                      <BillingStatusSelect job={j} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Tab: Extras / COs ─────────────────────────────────────────────────────────

function Extras() {
  return <ChangeOrdersComponent />
}

// ── Tab: Billing ──────────────────────────────────────────────────────────────

function parseInvoiceDate(str) {
  if (!str) return null
  const [m, d, y] = str.split('/')
  if (!m || !d || !y) return null
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
}

function getDaysAging(dateStr) {
  const date = parseInvoiceDate(dateStr)
  if (!date) return null
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

const AGING_BUCKETS = [
  { label: '0–30 days',  min: 0,  max: 30,  color: '#22c55e' },
  { label: '31–60 days', min: 31, max: 60,  color: '#eab308' },
  { label: '61–90 days', min: 61, max: 90,  color: '#f97316' },
  { label: '90+ days',   min: 91, max: Infinity, color: '#ef4444' },
]

function Billing() {
  const { jobs } = useData()
  const [billingTab, setBillingTab] = useState('invoices')
  const sorted = [...jobs].sort((a, b) => jobName(a).localeCompare(jobName(b)))

  const counts = {
    'not-invoiced': sorted.filter(j => (j.billingStatus || 'not-invoiced') === 'not-invoiced').length,
    'invoiced':     sorted.filter(j => j.billingStatus === 'invoiced').length,
    'partial-pay':  sorted.filter(j => j.billingStatus === 'partial-pay').length,
    'paid':         sorted.filter(j => j.billingStatus === 'paid').length,
  }

  const outstandingJobs = sorted.filter(j => j.billingStatus === 'invoiced' || j.billingStatus === 'partial-pay')
  const overdue60 = outstandingJobs.filter(j => (getDaysAging(j.invoiceDate) ?? 0) > 60).length

  return (
    <div className="space-y-6">
      <SectionHeader title="Billing" sub="Invoice tracking — QB manages the money" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {BILLING_STATUSES.map(s => (
          <StatCard
            key={s}
            label={BILLING_STATUS_LABEL[s]}
            value={counts[s]}
            sub="jobs"
            Icon={s === 'paid' ? CheckCircleIcon : s === 'invoiced' ? FileTextIcon : s === 'partial-pay' ? ClockIcon : AlertCircleIcon}
          />
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        {[['invoices','All Invoices'],['collections','Collections']].map(([id, label]) => (
          <button key={id} onClick={() => setBillingTab(id)}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-2"
            style={{ backgroundColor: billingTab === id ? O : 'transparent', color: billingTab === id ? '#fff' : '#6b7280', border: '1px solid', borderColor: billingTab === id ? O : '#ffffff22' }}>
            {label}
            {id === 'collections' && overdue60 > 0 && (
              <span className="text-xs font-black px-1.5 py-0.5 rounded-full bg-red-500 text-white">{overdue60}</span>
            )}
          </button>
        ))}
      </div>

      {billingTab === 'invoices' && (
        <Card className="border-white/10">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left p-4 font-medium">Job</th>
                    <th className="text-left p-4 font-medium">Client</th>
                    <th className="text-left p-4 font-medium">Invoice #</th>
                    <th className="text-left p-4 font-medium">Invoice Date</th>
                    <th className="text-left p-4 font-medium">QBS PM</th>
                    <th className="text-left p-4 font-medium">Status</th>
                    <th className="text-left p-4 font-medium">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sorted.map(j => (
                    <tr key={j.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4">
                        <p className="font-black text-base" style={{ color: O }}>{jobName(j)}</p>
                        <p className="text-xs text-muted-foreground font-mono">{j.id}</p>
                      </td>
                      <td className="p-4 text-muted-foreground text-sm">{j.client}</td>
                      <td className="p-4 font-mono text-sm">{j.invoiceNum || <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="p-4 text-muted-foreground text-sm">{j.invoiceDate || <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="p-4 text-sm">{j.qbsPM || <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="p-4"><BillingStatusSelect job={j} /></td>
                      <td className="p-4">
                        {j.invoiceNum && (
                          <Button size="sm" variant="outline"
                            className="h-7 text-xs gap-1.5 border-white/20"
                            onClick={() => generateInvoicePdf(j)}>
                            <DownloadIcon size={11} /> PDF
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {billingTab === 'collections' && (
        <div className="space-y-6">
          {AGING_BUCKETS.map(bucket => {
            const bucketJobs = outstandingJobs.filter(j => {
              const age = getDaysAging(j.invoiceDate) ?? 0
              return age >= bucket.min && age <= bucket.max
            })
            if (bucketJobs.length === 0) return null
            return (
              <div key={bucket.label}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-bold text-sm" style={{ color: bucket.color }}>{bucket.label}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold text-white" style={{ backgroundColor: bucket.color }}>
                    {bucketJobs.length}
                  </span>
                </div>
                <Card className="border-white/10">
                  <CardContent className="p-0">
                    <div className="divide-y divide-white/5">
                      {bucketJobs.map(j => {
                        const age = getDaysAging(j.invoiceDate) ?? 0
                        return (
                          <div key={j.id} className="flex items-center gap-4 p-4">
                            <div className="flex-1">
                              <p className="font-bold text-sm" style={{ color: O }}>{jobName(j)}</p>
                              <p className="text-xs text-muted-foreground">{j.client} · Invoice #{j.invoiceNum || '—'} · {j.invoiceDate || '—'}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-bold" style={{ color: bucket.color }}>{age} days</p>
                              <p className="text-xs text-muted-foreground">{j.qbsPM || '—'}</p>
                            </div>
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs gap-1 border-white/20 shrink-0"
                              style={{ color: bucket.color, borderColor: bucket.color + '55' }}
                              onClick={async () => {
                                if (j._docId) {
                                  const { addDoc, collection, serverTimestamp } = await import('firebase/firestore')
                                  const { db } = await import('./firebase')
                                  await addDoc(collection(db, 'notifications'), {
                                    type: 'warn',
                                    msg: `Collections follow-up: ${jobName(j)} (${j.id}) — Invoice #${j.invoiceNum || '—'} outstanding ${getDaysAging(j.invoiceDate) ?? 0} days. QBS PM: ${j.qbsPM || '—'}`,
                                    read: false,
                                    createdAt: serverTimestamp(),
                                  })
                                }
                              }}>
                              <SendIcon size={11} /> Follow-Up
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          })}
          {outstandingJobs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No outstanding invoices</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab: Inspections ──────────────────────────────────────────────────────────

const INSP_STATUSES = ['pending', 'scheduled', 'passed', 'failed', 'blocked', 'n/a']

function PhaseRow({ label, status, note, docId, field }) {
  const canEdit = !!docId
  const [, trade, phase] = field ? field.split('.') : []
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {note && <span className="text-xs text-red-400 max-w-xs text-right">{note}</span>}
        {canEdit ? (
          <>
            <select
              value={status || 'pending'}
              onChange={e => updateJob(docId, { [field]: e.target.value })}
              className="text-xs font-bold px-2 py-0.5 rounded-full cursor-pointer appearance-none"
              style={{
                color: iMeta(status).color,
                backgroundColor: iMeta(status).color + '22',
                border: `1px solid ${iMeta(status).color}44`,
              }}
            >
              {INSP_STATUSES.map(s => (
                <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            <Button size="sm" className="h-5 w-6 p-0 text-xs"
              style={{ backgroundColor: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}
              onClick={() => passInspection(docId, trade, phase)} title="Pass">✓</Button>
            <Button size="sm" className="h-5 w-6 p-0 text-xs"
              style={{ backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}
              onClick={() => failInspection(docId, trade, phase)} title="Fail">✗</Button>
          </>
        ) : (
          <InspBadge status={status} />
        )}
      </div>
    </div>
  )
}

function Inspections() {
  const { jobs, dailyReports } = useData()

  return (
    <div className="space-y-6">
      <SectionHeader title="Inspections" sub="E: 3-phase · P: 2-phase · H: 2-phase (blocking) · Click status to update" />

      <div className="p-4 rounded-xl border flex items-start gap-3"
        style={{ borderColor: '#eab30855', backgroundColor: '#eab30808' }}>
        <AlertTriangleIcon size={16} color="#eab308" className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-bold" style={{ color: '#eab308' }}>SOP Reminder — Inspection Protocol</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Sequence: <strong className="text-foreground">Rough-In → Trim</strong> (electrical only) <strong className="text-foreground">→ Final</strong>.{' '}
            Call in only after: crew report submitted, min 3 photos uploaded, phase work confirmed complete, CompanyCam updated.{' '}
            <strong className="text-red-400">HVAC rough-in failure blocks the final</strong> — do not schedule final until rough-in passes.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {[...jobs].sort((a,b)=>jobName(a).localeCompare(jobName(b))).map(j => (
          <Card key={j.id} className={`border-white/10 ${j.status === 'hold' ? 'border-red-500/40' : ''}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-3">
                  <span className="font-black" style={{ color: O }}>{jobName(j)}</span>
                  <span className="text-muted-foreground font-normal text-xs font-mono">{j.id}</span>
                  <span className="text-muted-foreground font-normal text-sm">{j.address}</span>
                </CardTitle>
                <JobBadge status={j.status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <ZapIcon size={14} style={{ color: O }} />
                    <p className="text-sm font-semibold">Electrical (3-Phase)</p>
                    <span className="text-xs text-muted-foreground ml-auto">Sub: {j.subs?.electrical || '—'}</span>
                  </div>
                  <PhaseRow label="Rough-In" status={j.insp?.electrical?.roughIn} docId={j._docId} field="insp.electrical.roughIn" />
                  <PhaseRow label="Trim"     status={j.insp?.electrical?.trim}    note={j.insp?.electrical?.note} docId={j._docId} field="insp.electrical.trim" />
                  <PhaseRow label="Final"    status={j.insp?.electrical?.final}   docId={j._docId} field="insp.electrical.final" />
                  <div className="mt-2">
                    <ProgressBar value={
                      (['passed'].includes(j.insp?.electrical?.roughIn) ? 33 : 0) +
                      (['passed'].includes(j.insp?.electrical?.trim)    ? 33 : 0) +
                      (['passed'].includes(j.insp?.electrical?.final)   ? 34 : 0)
                    } color={O} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <WrenchIcon size={14} color="#06b6d4" />
                    <p className="text-sm font-semibold">Plumbing (2-Phase)</p>
                    <span className="text-xs text-muted-foreground ml-auto">Sub: {j.subs?.plumbing || 'N/A'}</span>
                  </div>
                  <PhaseRow label="Rough-In" status={j.insp?.plumbing?.roughIn} docId={j._docId} field="insp.plumbing.roughIn" />
                  <PhaseRow label="Final"    status={j.insp?.plumbing?.final}   docId={j._docId} field="insp.plumbing.final" />
                  <div className="mt-2">
                    <ProgressBar value={
                      (['passed'].includes(j.insp?.plumbing?.roughIn) ? 50 : 0) +
                      (['passed'].includes(j.insp?.plumbing?.final)   ? 50 : 0)
                    } color="#06b6d4" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <HammerIcon size={14} color="#3b82f6" />
                    <p className="text-sm font-semibold">HVAC (2-Phase · Blocking)</p>
                    <span className="text-xs text-muted-foreground ml-auto">Sub: {j.subs?.hvac || '—'}</span>
                  </div>
                  <PhaseRow label="Rough-In" status={j.insp?.hvac?.roughIn} docId={j._docId} field="insp.hvac.roughIn" />
                  <PhaseRow label="Final"    status={j.insp?.hvac?.final}   docId={j._docId} field="insp.hvac.final" />
                  {j.insp?.hvac?.roughIn === 'failed' && (
                    <div className="mt-2 flex items-center gap-2 p-2 rounded bg-blue-500/10 border border-blue-500/30">
                      <AlertCircleIcon size={12} color="#3b82f6" />
                      <span className="text-xs text-blue-400">Final blocked — rough-in must pass first</span>
                    </div>
                  )}
                  <div className="mt-2">
                    <ProgressBar value={
                      (['passed'].includes(j.insp?.hvac?.roughIn) ? 50 : 0) +
                      (['passed'].includes(j.insp?.hvac?.final)   ? 50 : 0)
                    } color="#3b82f6" />
                  </div>
                </div>
              </div>

              {(() => {
                const crewReport = (dailyReports || []).some(r => r.date === YESTERDAY_STR && r.jobId === j.id)
                const photosOk   = (j.photoCount || 0) >= 3
                const phaseOk    = ['passed','finaled'].some(s =>
                  [j.insp?.electrical?.roughIn, j.insp?.plumbing?.roughIn, j.insp?.hvac?.roughIn].includes(s)
                )
                const camOk      = j.companyCamUpdated || false
                const checks = [
                  { label: 'Crew report submitted',       ok: crewReport },
                  { label: 'Photos uploaded (min 3)',      ok: photosOk  },
                  { label: 'Phase work confirmed complete', ok: phaseOk  },
                  { label: 'CompanyCam updated',           ok: camOk    },
                ]
                const allOk = checks.every(c => c.ok)
                return (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Inspection Readiness Gate</p>
                      <span className="text-xs font-black px-3 py-1 rounded-full"
                        style={{
                          backgroundColor: allOk ? '#22c55e22' : '#ef444422',
                          color: allOk ? '#22c55e' : '#ef4444',
                          border: `1px solid ${allOk ? '#22c55e44' : '#ef444444'}`,
                        }}>
                        {allOk ? '✓ READY TO CALL IN' : '✗ NOT READY'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {checks.map(c => (
                        <div key={c.label} className="flex items-center gap-2 p-2 rounded-lg"
                          style={{ backgroundColor: c.ok ? '#22c55e0d' : '#ef44440d', border: `1px solid ${c.ok ? '#22c55e22' : '#ef444422'}` }}>
                          <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                            style={{ backgroundColor: c.ok ? '#22c55e22' : '#ef444422' }}>
                            {c.ok
                              ? <CheckIcon size={10} color="#22c55e" />
                              : <XIcon size={10} color="#ef4444" />}
                          </div>
                          <p className="text-xs leading-tight" style={{ color: c.ok ? '#22c55e' : '#ef4444' }}>
                            {c.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Tab: Subs ─────────────────────────────────────────────────────────────────

const SUB_STATUS_OPTIONS = ['active', 'done', 'issue']
const SUB_STATUS_COLOR   = { active: '#22c55e', done: '#6b7280', issue: '#ef4444' }

function SubsTab() {
  const { subs: SUBS, jobs } = useData()
  const [tradeFilter, setTradeFilter] = useState('all')
  const [expandedSub, setExpandedSub] = useState(null)

  const filtered = tradeFilter === 'all' ? SUBS : SUBS.filter(s => s.trade === tradeFilter)

  const complianceColor = (exp) => {
    const days = (new Date(exp) - new Date()) / 86400000
    if (days < 0)   return '#ef4444'
    if (days < 60)  return '#eab308'
    return '#22c55e'
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Subcontractors" sub="9 subs — compliance tracking, W-9, license, insurance" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Subs"      value={SUBS.length}                                    Icon={UsersIcon} />
        <StatCard label="W-9 Missing"     value={SUBS.filter(s=>!s.w9).length}                   sub="cannot issue 1099" Icon={AlertTriangleIcon} />
        <StatCard label="Expiring Soon"   value={SUBS.filter(s => (new Date(s.insExp)-new Date())/86400000 < 60 && (new Date(s.insExp)-new Date())/86400000 > 0).length} sub="within 60 days" Icon={ClockIcon} />
        <StatCard label="Update Flags"    value={SUBS.filter(s => { const d = daysSince(s.lastUpdate); return d === null || d > 2 }).length} sub="subs overdue > 48h" Icon={AlertCircleIcon} />
      </div>

      <div className="flex gap-3">
        <Select value={tradeFilter} onValueChange={setTradeFilter}>
          <SelectTrigger className="w-40 bg-white/5 border-white/20"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Trades</SelectItem>
            <SelectItem value="HVAC">HVAC</SelectItem>
            <SelectItem value="Plumbing">Plumbing</SelectItem>
            <SelectItem value="Electrical">Electrical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        {filtered.map(s => {
          const insColor = complianceColor(s.insExp)
          const licColor = complianceColor(s.licExp)
          const subJobKey = s.id === 'p2' ? 'P2 In-House' : s.name.split(' ')[0]
          const subJobs = jobs
            .filter(j => j.subs?.electrical === subJobKey || j.subs?.plumbing === subJobKey || j.subs?.hvac === subJobKey)
            .map(j => ({
              ...j,
              trade: j.subs?.electrical === subJobKey ? 'electrical' : j.subs?.plumbing === subJobKey ? 'plumbing' : 'hvac',
            }))
            .sort((a, b) => jobName(a).localeCompare(jobName(b)))
          const isExpanded = expandedSub === s.id
          return (
            <Card key={s.id} className={`border-white/10 ${!s.w9 ? 'border-red-500/30' : ''}`}>
              <CardContent className="p-4">
                <div
                  className="flex items-start justify-between gap-4 cursor-pointer"
                  onClick={() => setExpandedSub(isExpanded ? null : s.id)}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                      style={{ backgroundColor: tradeColor[s.trade] + '33', color: tradeColor[s.trade] }}>
                      {s.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{s.name}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: tradeColor[s.trade] + '22', color: tradeColor[s.trade] }}>
                          {s.trade}
                        </span>
                        {!s.w9 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-400">
                            W-9 MISSING
                          </span>
                        )}
                        {subJobs.length > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-white/10 text-muted-foreground">
                            {subJobs.length} job{subJobs.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{s.co}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.lic}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-xs">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-1">Insurance</p>
                      <p className="font-medium" style={{ color: insColor }}>{s.insExp}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground mb-1">License</p>
                      <p className="font-medium" style={{ color: licColor }}>{s.licExp}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground mb-1">Score</p>
                      <p className="font-black text-xl" style={{ color: s.score >= 90 ? '#22c55e' : s.score >= 80 ? O : '#ef4444' }}>
                        {s.score}
                      </p>
                    </div>
                    <div className="text-center">
                      <PhoneIcon size={12} className="text-muted-foreground mb-1 mx-auto" />
                      <p className="font-medium">{s.phone}</p>
                    </div>
                    {(() => {
                      const days = daysSince(s.lastUpdate)
                      const color = days === null || days > 5 ? '#ef4444' : days > 2 ? '#eab308' : '#22c55e'
                      const Icon = days === null || days > 5 ? AlertCircleIcon : days > 2 ? AlertTriangleIcon : CheckCircleIcon
                      const label = days === null ? 'No Data' : days === 0 ? 'Today' : `${days}d ago`
                      return (
                        <div className="text-center border-l border-white/10 pl-4">
                          <p className="text-muted-foreground mb-1 text-xs">Last Update</p>
                          <div className="flex items-center gap-1 justify-center">
                            <Icon size={11} style={{ color }} />
                            <p className="font-bold text-xs" style={{ color }}>{label}</p>
                          </div>
                          {(days === null || days > 5) && (
                            <p className="text-xs mt-0.5 font-bold" style={{ color: '#ef4444' }}>RED FLAG</p>
                          )}
                          {days !== null && days > 2 && days <= 5 && (
                            <p className="text-xs mt-0.5 font-bold" style={{ color: '#eab308' }}>WARNING</p>
                          )}
                        </div>
                      )
                    })()}
                    <ChevronRightIcon size={14} className="text-muted-foreground transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }} />
                  </div>
                </div>

                {isExpanded && subJobs.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Job Assignments</p>
                    {subJobs.map(j => {
                      const subStatus = (j.subsStatus || {})[j.trade] || 'active'
                      const looseEnds = (j.subsLooseEnds || {})[j.trade] || ''
                      const sc = SUB_STATUS_COLOR[subStatus] || '#6b7280'
                      return (
                        <div key={j.id} className="p-3 rounded-lg bg-white/5 border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold" style={{ color: O }}>{jobName(j)}</span>
                              <span className="text-xs text-muted-foreground font-mono">{j.id}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded capitalize"
                                style={{ backgroundColor: tradeColor[j.trade.charAt(0).toUpperCase()+j.trade.slice(1)] + '22', color: tradeColor[j.trade.charAt(0).toUpperCase()+j.trade.slice(1)] || '#9ca3af' }}>
                                {j.trade}
                              </span>
                            </div>
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <Select value={subStatus} onValueChange={v => j._docId && updateJob(j._docId, { [`subsStatus.${j.trade}`]: v })}>
                                <SelectTrigger className="h-auto py-0.5 px-2 text-xs font-bold border rounded-full w-24"
                                  style={{ backgroundColor: sc + '22', color: sc, borderColor: sc + '55' }}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {SUB_STATUS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <JobBadge status={j.status} />
                            </div>
                          </div>
                          <div onClick={e => e.stopPropagation()}>
                            <Textarea
                              className="bg-white/5 border-white/10 text-xs resize-none h-14 placeholder:text-muted-foreground/40"
                              placeholder="Loose ends — incomplete work, punch list items, notes..."
                              value={looseEnds}
                              onChange={e => j._docId && updateJob(j._docId, { [`subsLooseEnds.${j.trade}`]: e.target.value })}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {isExpanded && subJobs.length === 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-xs text-muted-foreground text-center">No active job assignments found.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: Materials ────────────────────────────────────────────────────────────

const MAT_STATUS_OPTIONS = ['Ordered', 'In Transit', 'Delivered', 'At Job Site', 'Used', 'Cancelled']
const MAT_STATUS_COLOR = {
  'Ordered':    '#3b82f6',
  'In Transit': '#eab308',
  'Delivered':  '#22c55e',
  'At Job Site':'#22c55e',
  'Used':       '#6b7280',
  'Cancelled':  '#6b7280',
  // legacy
  'delivered':  '#22c55e',
  'in-transit': '#eab308',
  'ordered':    '#3b82f6',
  'pending':    '#6b7280',
}

function MatStatusBadge({ status, docId, onUpdate }) {
  const color = MAT_STATUS_COLOR[status] || '#6b7280'
  return (
    <div onClick={e => e.stopPropagation()}>
      <Select value={status || 'Ordered'} onValueChange={v => onUpdate(docId, v)}>
        <SelectTrigger className="h-auto py-0.5 px-2 text-xs font-bold border rounded-full min-w-[7rem]"
          style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function Materials() {
  const { jobs, materials: MATERIALS } = useData()
  const { history: HISTORY } = useHistory()
  const [filterJob, setFilterJob] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [form, setForm] = useState({ name: '', qty: 1, unit: 'ea', jobId: '', status: 'Ordered', vendor: '', dateOrdered: '', dateNeeded: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const today = new Date()

  const normalizeStatus = (s) => {
    if (!s) return 'Ordered'
    const map = { 'delivered': 'Delivered', 'in-transit': 'In Transit', 'ordered': 'Ordered', 'pending': 'Ordered' }
    return map[s] || s
  }

  const isOverdue = (m) => {
    const s = normalizeStatus(m.status)
    if (!m.dateNeeded) return false
    if (['Delivered', 'At Job Site', 'Used', 'Cancelled'].includes(s)) return false
    return new Date(m.dateNeeded) < today
  }

  const filtered = MATERIALS.filter(m => {
    const jobMatch = filterJob === 'all' || (m.jobId || m.job) === filterJob
    const s = normalizeStatus(m.status)
    const statusMatch = filterStatus === 'all' || s === filterStatus
    return jobMatch && statusMatch
  })

  const total     = MATERIALS.length
  const pending   = MATERIALS.filter(m => ['Ordered', 'In Transit'].includes(normalizeStatus(m.status))).length
  const delivered = MATERIALS.filter(m => ['Delivered', 'At Job Site'].includes(normalizeStatus(m.status))).length
  const overdue   = MATERIALS.filter(m => isOverdue(m)).length

  const handleStatusChange = async (docId, newStatus) => {
    const m = MATERIALS.find(x => x._docId === docId)
    if (!m) return
    const oldStatus = normalizeStatus(m.status)
    await updateMaterial(docId, { status: newStatus })
    await addHistory({
      materialDocId: docId,
      materialName: m.name || m.item || '',
      jobId: m.jobId || m.job || '',
      fromStatus: oldStatus,
      toStatus: newStatus,
      type: 'status_change',
    })
  }

  const handleAdd = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const job = jobs.find(j => j.id === form.jobId)
    const data = {
      name: form.name.trim(),
      item: form.name.trim(),
      qty: Number(form.qty) || 1,
      unit: form.unit,
      jobId: form.jobId,
      job: form.jobId,
      jobName: job?.client || '',
      status: form.status,
      vendor: form.vendor.trim(),
      dateOrdered: form.dateOrdered,
      dateNeeded: form.dateNeeded,
      notes: form.notes.trim(),
      cost: 0,
    }
    if (editId) {
      await updateMaterial(editId, data)
      await addHistory({ materialDocId: editId, materialName: data.name, jobId: data.jobId, type: 'edited' })
    } else {
      await addMaterial(data)
    }
    setForm({ name: '', qty: 1, unit: 'ea', jobId: '', status: 'Ordered', vendor: '', dateOrdered: '', dateNeeded: '', notes: '' })
    setShowForm(false)
    setEditId(null)
    setSaving(false)
  }

  const openEdit = (m) => {
    setForm({
      name: m.name || m.item || '',
      qty: m.qty || 1,
      unit: m.unit || 'ea',
      jobId: m.jobId || m.job || '',
      status: normalizeStatus(m.status),
      vendor: m.vendor || '',
      dateOrdered: m.dateOrdered || m.eta || '',
      dateNeeded: m.dateNeeded || '',
      notes: m.notes || '',
    })
    setEditId(m._docId)
    setShowForm(true)
  }

  const rowBg = (m) => {
    if (isOverdue(m)) return '#ef444411'
    const s = normalizeStatus(m.status)
    if (s === 'In Transit') return '#eab30808'
    if (['Delivered', 'At Job Site'].includes(s)) return '#22c55e08'
    return ''
  }

  const matHistory = (docId) => HISTORY.filter(h => h.materialDocId === docId)

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Materials"
        sub={`${total} items · ${pending} pending · ${delivered} delivered${overdue > 0 ? ` · ${overdue} overdue` : ''}`}
        action={
          <Button onClick={() => { setShowForm(v => !v); setEditId(null); setForm({ name: '', qty: 1, unit: 'ea', jobId: '', status: 'Ordered', vendor: '', dateOrdered: '', dateNeeded: '', notes: '' }) }}
            style={{ backgroundColor: O }} className="text-white gap-2">
            <PlusIcon size={14} /> Add Material
          </Button>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Items"   value={total}     Icon={PackageIcon} />
        <StatCard label="Pending"       value={pending}   sub="ordered or in transit" Icon={TruckIcon} />
        <StatCard label="Delivered"     value={delivered} sub="on site or delivered"  Icon={CheckCircleIcon} />
        <StatCard label="Overdue"       value={overdue}   sub={overdue > 0 ? 'needs attention' : 'all on time'} Icon={AlertCircleIcon} />
      </div>

      {showForm && (
        <Card className="border-white/20" style={{ borderColor: O + '55' }}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PlusIcon size={14} style={{ color: O }} />
              {editId ? 'Edit Material' : 'Log New Material'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Item Name *</label>
                <Input className="bg-white/5 border-white/20" placeholder="e.g. 200A Main Panel Square D" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                <Input className="bg-white/5 border-white/20" type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Unit</label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['ea','roll','stick','box','bag','pallet','ft','lf'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Job</label>
                <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue placeholder="Select job" /></SelectTrigger>
                  <SelectContent>
                    {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.id} — {j.client}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                <Input className="bg-white/5 border-white/20" placeholder="Graybar, Ferguson…" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Date Ordered</label>
                <Input className="bg-white/5 border-white/20" type="date" value={form.dateOrdered} onChange={e => setForm(f => ({ ...f, dateOrdered: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Date Needed</label>
                <Input className="bg-white/5 border-white/20" type="date" value={form.dateNeeded} onChange={e => setForm(f => ({ ...f, dateNeeded: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                <Input className="bg-white/5 border-white/20" placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button style={{ backgroundColor: O }} className="text-white" onClick={handleAdd} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Material'}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 flex-wrap">
        <Select value={filterJob} onValueChange={setFilterJob}>
          <SelectTrigger className="w-60 bg-white/5 border-white/20"><SelectValue placeholder="All Jobs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Jobs</SelectItem>
            {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.id} — {j.client}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 bg-white/5 border-white/20"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <Card className="border-white/10">
            <CardContent className="p-10 text-center text-muted-foreground">No materials match your filters.</CardContent>
          </Card>
        )}
        {filtered.map(m => {
          const s = normalizeStatus(m.status)
          const color = MAT_STATUS_COLOR[s] || '#6b7280'
          const od = isOverdue(m)
          const hist = matHistory(m._docId)
          const showHist = expandedHistory === (m._docId || m.id)
          return (
            <Card key={m._docId || m.id} className="border-white/10 overflow-hidden"
              style={{ borderLeftWidth: 3, borderLeftColor: od ? '#ef4444' : color }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="font-semibold text-base truncate">{m.name || m.item}</span>
                      <span className="font-mono text-xs font-bold shrink-0" style={{ color: O }}>{m.jobId || m.job || '—'}</span>
                      {od && <span className="text-xs font-bold text-red-400">⚠ OVERDUE</span>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>{m.qty} {m.unit}</span>
                      {m.vendor && <span>{m.vendor}</span>}
                      {(m.dateOrdered || m.eta) && <span>Ordered: {m.dateOrdered || m.eta}</span>}
                      {m.dateNeeded && <span style={{ color: od ? '#ef4444' : 'inherit' }}>Needed: {m.dateNeeded}</span>}
                      {m.notes && <span className="italic">{m.notes}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <MatStatusBadge status={s} docId={m._docId} onUpdate={handleStatusChange} />
                    <button className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" onClick={() => openEdit(m)}>
                      <PencilIcon size={13} className="text-muted-foreground" />
                    </button>
                    {hist.length > 0 && (
                      <button className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-xs text-muted-foreground"
                        onClick={() => setExpandedHistory(showHist ? null : (m._docId || m.id))}>
                        <ActivityIcon size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {showHist && hist.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">History</p>
                    {hist.slice(0, 8).map(h => (
                      <div key={h._docId} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="w-32 shrink-0">
                          {h.createdAt?.toDate ? h.createdAt.toDate().toLocaleDateString() : '—'}
                        </span>
                        {h.type === 'status_change' ? (
                          <span><span style={{ color: MAT_STATUS_COLOR[h.fromStatus] || '#6b7280' }}>{h.fromStatus}</span> → <span style={{ color: MAT_STATUS_COLOR[h.toStatus] || '#6b7280' }}>{h.toStatus}</span></span>
                        ) : (
                          <span className="capitalize">{h.type?.replace('_', ' ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: Permits ──────────────────────────────────────────────────────────────

function Permits() {
  const { jobs } = useData()
  const allPermits = jobs.flatMap(j =>
    ['electrical', 'plumbing', 'hvac'].filter(t => j.permits[t]).map(t => ({
      job: j.id, address: j.address, trade: t, status: j.permits[t],
    }))
  )
  const approved = allPermits.filter(p => ['approved','finaled'].includes(p.status)).length
  const pending  = allPermits.filter(p => p.status === 'pending').length
  const applied  = allPermits.filter(p => p.status === 'applied').length

  return (
    <div className="space-y-6">
      <SectionHeader title="Permits" sub="Permit status across all active jobs and trades" />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Approved / Finaled" value={approved} Icon={CheckCircleIcon} />
        <StatCard label="Applied / Pending"  value={applied + pending} sub="awaiting approval" Icon={ClockIcon} />
        <StatCard label="Total Permits"      value={allPermits.length} Icon={FileTextIcon} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {jobs.map(j => (
          <Card key={j.id} className="border-white/10">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between">
                <span><span className="font-mono" style={{ color: O }}>{j.id}</span> — {j.address}</span>
                <JobBadge status={j.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {['electrical','plumbing','hvac'].map(t => {
                if (!j.permits[t]) return null
                const pStatus = j.permits[t]
                const PERMIT_STATUSES = ['pending','applied','approved','finaled','denied']
                return (
                  <div key={t} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      {t === 'electrical' ? <ZapIcon size={14} style={{ color: O }} /> :
                       t === 'plumbing'   ? <WrenchIcon size={14} color="#06b6d4" /> :
                                            <HammerIcon size={14} color="#3b82f6" />}
                      <span className="text-sm capitalize font-medium">{t}</span>
                    </div>
                    {j._docId ? (
                      <select
                        value={pStatus}
                        onChange={e => updatePermit(j._docId, t, e.target.value)}
                        className="text-xs font-bold px-2 py-0.5 rounded-full cursor-pointer appearance-none"
                        style={{ color: iMeta(pStatus).color, backgroundColor: iMeta(pStatus).color + '22', border: `1px solid ${iMeta(pStatus).color}44` }}
                      >
                        {PERMIT_STATUSES.map(s => (
                          <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>{s.toUpperCase()}</option>
                        ))}
                      </select>
                    ) : (
                      <InspBadge status={pStatus} />
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Tab: Project Folders ──────────────────────────────────────────────────────

function ProjectFolders() {
  return <ProjectFoldersComponent />
}


// ── Tab: Notifications ────────────────────────────────────────────────────────

function Notifications() {
  const { notifs } = useData()
  const [notifTab, setNotifTab] = useState('live')

  const live     = notifs.filter(n => !n.dismissed)
  const archived = notifs.filter(n => n.dismissed)
  const shown    = notifTab === 'live' ? live : archived
  const unread   = live.filter(n => !n.read).length

  const markRead = (n) => {
    if (n.read || !n._docId) return
    updateNotification(n._docId, { read: true })
  }

  const dismiss = (e, n) => {
    e.stopPropagation()
    if (!n._docId) return
    updateNotification(n._docId, { dismissed: true, read: true })
  }

  const markAll = () => {
    live.filter(n => !n.read && n._docId).forEach(n => updateNotification(n._docId, { read: true }))
  }

  const typeIcon = { error: AlertCircleIcon, warn: AlertTriangleIcon, info: InfoIcon, success: CheckCircleIcon }
  const typeColor = { error: '#ef4444', warn: '#eab308', info: '#3b82f6', success: '#22c55e' }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Notifications"
        sub={`${unread} unread · ${live.length} live · ${archived.length} archived`}
        action={notifTab === 'live' && unread > 0 && (
          <Button variant="outline" onClick={markAll} className="gap-2 border-white/20">
            <CheckIcon size={14} /> Mark All Read
          </Button>
        )}
      />

      <div className="flex gap-1 p-1 rounded-lg bg-white/5 w-fit">
        {[['live', 'Live'], ['archived', 'Archived']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setNotifTab(id)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={notifTab === id ? { backgroundColor: O, color: '#fff' } : { color: '#9ca3af' }}
          >
            {label}
            {id === 'live' && unread > 0 && (
              <span className="ml-1.5 text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5">{unread}</span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {notifTab === 'live' ? 'No live notifications' : 'No archived notifications'}
          </p>
        )}
        {shown.map((n, i) => {
          const Icon = typeIcon[n.type] || InfoIcon
          const color = typeColor[n.type] || '#6b7280'
          return (
            <div
              key={n._docId || n.id || i}
              className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${n.read ? 'border-white/5 bg-white/2 opacity-70' : 'border-white/15 bg-white/8'}`}
              onClick={() => markRead(n)}>
              <div className="mt-0.5 p-2 rounded-lg" style={{ backgroundColor: color + '22' }}>
                <Icon size={14} style={{ color }} />
              </div>
              <div className="flex-1">
                <p className={`text-sm ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.msg}</p>
                <p className="text-xs text-muted-foreground mt-1">{n.time || n.createdAt?.toDate?.()?.toLocaleDateString?.() || ''}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!n.read && <div className="w-2 h-2 rounded-full mt-2" style={{ backgroundColor: O }} />}
                {notifTab === 'live' && (
                  <button
                    onClick={(e) => dismiss(e, n)}
                    className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    title="Dismiss"
                  >
                    <XIcon size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: Submit (Lead Intake) ─────────────────────────────────────────────────

function Submit() {
  return <SubmitInboxComponent />
}

// ── Tab: Crew Daily Report ────────────────────────────────────────────────────

function CrewReport() {
  return <CrewReportComponent />
}


// ── Tab: Architecture ─────────────────────────────────────────────────────────

function Architecture() {
  const collections = [
    { name: 'jobs', desc: 'Top-level job records', fields: ['id', 'address', 'client', 'status', 'progress', 'pm', 'billing', 'permits', 'inspections'] },
    { name: 'jobs/{jobId}/extras', desc: 'Change orders per job', fields: ['id', 'desc', 'amount', 'status', 'qbsSync', 'createdAt', 'approvedBy'] },
    { name: 'jobs/{jobId}/materials', desc: 'Material orders per job', fields: ['item', 'qty', 'cost', 'status', 'vendor', 'eta', 'orderedAt'] },
    { name: 'subs', desc: 'Subcontractor master list', fields: ['name', 'company', 'trade', 'license', 'licenseExp', 'insurance', 'w9', 'score'] },
    { name: 'inspections', desc: 'Inspection records with photos', fields: ['jobId', 'trade', 'phase', 'status', 'inspector', 'date', 'notes', 'photos'] },
    { name: 'notifications', desc: 'System alerts + user notifications', fields: ['type', 'msg', 'jobId', 'userId', 'read', 'createdAt'] },
    { name: 'leads', desc: 'Incoming lead intake', fields: ['name', 'phone', 'email', 'address', 'type', 'budget', 'status', 'assignedPm'] },
  ]

  const functions = [
    { name: 'onJobStatusChange', trigger: 'Firestore write — jobs/{jobId}', desc: 'Push notifications to PM when job status changes' },
    { name: 'onInspectionFail', trigger: 'Firestore write — inspections/', desc: 'Block next phase, alert PM + sub, log to Slack' },
    { name: 'syncExtraToQBS', trigger: 'Firestore write — extras/', desc: 'Mirror approved COs to QuickBooks via API' },
    { name: 'subComplianceCheck', trigger: 'Scheduled — daily 06:00 CT', desc: 'Check license/insurance expiry, create alerts' },
    { name: 'billingMilestone', trigger: 'Firestore write — jobs/{jobId}/billing', desc: 'Trigger invoice generation at 70%/100% thresholds' },
    { name: 'leadNotification', trigger: 'Firestore write — leads/', desc: 'Email PM assignment + create morning briefing entry' },
  ]

  const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Jobs — P2 internal only
    match /jobs/{jobId} {
      allow read:  if isP2Internal() || isQBS();
      allow write: if isP2Internal();

      match /extras/{coId} {
        allow read:  if isP2Internal() || isQBS();
        allow create: if isP2Internal();
        allow update: if isP2Internal() || (isQBS() && onlyUpdates(['status','approvedBy','approvedAt']));
      }
      match /materials/{matId} {
        allow read, write: if isP2Internal();
      }
    }

    // Subs — P2 internal admin only
    match /subs/{subId} {
      allow read:  if isP2Internal();
      allow write: if isP2Admin();
    }

    // Inspections
    match /inspections/{inspId} {
      allow read:  if isP2Internal() || isQBS();
      allow write: if isP2Internal();
    }

    // Leads — internal only
    match /leads/{leadId} {
      allow create: if true;  // public form
      allow read, update: if isP2Internal();
    }

    function isP2Internal() {
      return request.auth != null
          && request.auth.token.role == 'p2_internal';
    }
    function isP2Admin() {
      return request.auth != null
          && request.auth.token.role == 'p2_admin';
    }
    function isQBS() {
      return request.auth != null
          && request.auth.token.role == 'qbs_coordinator';
    }
    function onlyUpdates(fields) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(fields);
    }
  }
}`

  return (
    <div className="space-y-6">
      <SectionHeader title="Architecture" sub="Firestore blueprint · Cloud Functions · Security rules" />

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <StatCard label="Collections"    value={collections.length}  Icon={DatabaseIcon} />
        <StatCard label="Cloud Functions" value={functions.length}   Icon={ServerIcon} />
        <StatCard label="Auth Roles"      value="3"                  sub="p2_internal · qbs · p2_admin" Icon={ShieldIcon} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-white/10">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DatabaseIcon size={16} style={{ color: O }} /> Firestore Collections
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {collections.map(c => (
              <div key={c.name} className="p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-sm font-mono font-bold" style={{ color: O }}>{c.name}</code>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{c.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {c.fields.map(f => (
                    <code key={f} className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">{f}</code>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ServerIcon size={16} style={{ color: O }} /> Cloud Functions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {functions.map(f => (
                <div key={f.name} className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <code className="text-sm font-mono font-bold" style={{ color: O }}>{f.name}</code>
                  <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CloudIcon size={10} className="text-muted-foreground" />
                    <code className="text-xs text-muted-foreground">{f.trigger}</code>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldIcon size={16} style={{ color: O }} /> Firestore Security Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs text-muted-foreground font-mono overflow-x-auto p-4 rounded-xl bg-black/40 border border-white/5 whitespace-pre leading-relaxed">
            {rules}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

function MainDashboard({ role = 'internal', tenantId = 'p2-core', onTenantChange, onLogout, onCreateUser, initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'command-center')
  const [collapsed, setCollapsed] = useState(false)
  const { loading, jobs, extras, notifs, subs, submits, agentAlerts } = useData()

  // Cross-component navigation. Command Center's "View All" links and Quick
  // Modules dispatch `p2:navigate` with a tab id; the shell listens here.
  // Keeping this in MainDashboard means screens stay route-agnostic — they
  // never import `setActiveTab`.
  useEffect(() => {
    const handler = (e) => {
      const id = e?.detail?.id
      if (typeof id === 'string') setActiveTab(id)
    }
    window.addEventListener('p2:navigate', handler)
    return () => window.removeEventListener('p2:navigate', handler)
  }, [])

  const navCounts = {
    'command-center': (jobs || []).filter(j => {
      if (['complete','completed'].includes(j.status)) return false
      const insp = j.insp || {}
      const failed = Object.values(insp).some(t => Object.values(t || {}).some(s => s === 'failed'))
      const stale  = ((new Date() - new Date(j.lastStatusChange || j.start)) / 86400000) >= 2
      return failed || (stale && j.status !== 'pending')
    }).length,
    jobs:          (jobs    || []).filter(j => j.status === 'needs-action').length,
    extras:        (extras  || []).filter(e => e.status === 'pending' && !e.qbs).length,
    notifications: (notifs  || []).filter(n => !n.read).length,
    subs:          (subs    || []).filter(s => !s.w9 || (new Date(s.insExp) - new Date()) / 86400000 < 60).length,
    submit:        (submits || []).filter(s => !s.status || s.status === 'new').length,
    alerts:        (agentAlerts || []).filter(a => a.status === 'open' && a.severity === 'critical').length,
    inspections:   (jobs    || []).filter(j => {
      const insp = j.insp || {}
      return Object.values(insp).some(trade =>
        Object.values(trade || {}).some(s => s === 'scheduled' || s === 'failed')
      )
    }).length,
  }

  if (loading) {
    return (
      <div className="dark flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: O + '33', borderTopColor: O }} />
          <p className="text-sm text-muted-foreground">Loading field data…</p>
        </div>
      </div>
    )
  }

  const wrap = (el) => <ErrorBoundary>{el}</ErrorBoundary>
  const TAB_COMPONENTS = {
    'command-center': wrap(<CommandCenterComponent />),
    'war-room':       wrap(<WarRoomComponent />),
    'pm-dashboard':   wrap(<PMDashboardComponent />),
    'alerts':         wrap(<AlertsPageComponent />),
    'billing-queue':  wrap(<BillingQueueComponent />),
    'morning':       wrap(<MorningBriefing />),
    'jobs':          wrap(<JobStatus />),
    'extras':        wrap(<Extras />),
    'billing':       wrap(<Billing />),
    'inspections':   wrap(<Inspections />),
    'subs':          wrap(<SubsTab />),
    'materials':     wrap(<Materials />),
    'permits':       wrap(<Permits />),
    'folders':       wrap(<ProjectFolders />),
    'notifications': wrap(<Notifications />),
    'submit':        wrap(<Submit />),
    'architecture':  wrap(<Architecture />),
    'daily-report':  wrap(<CrewReport />),
    'analytics':     wrap(<AnalyticsComponent />),
    'team':           wrap(<TeamLeaderboardComponent />),
    'invoice-auditor': wrap(<Suspense fallback={<div className="p-8 text-muted-foreground text-sm">Loading…</div>}><InvoiceAuditorComponent /></Suspense>),
    'settings':       wrap(<SettingsPageComponent onLogout={onLogout} />),
  }

  // Decorate nav items with live counts so the sidebar can render badges
  // without re-deriving them.
  const decoratedSections = NAV_SECTIONS.map(section => ({
    ...section,
    items: section.items.map(it => ({ ...it, count: navCounts[it.id] ?? 0 })),
  }))
  const decoratedMobilePrimary = MOBILE_PRIMARY.map(it => ({ ...it, count: navCounts[it.id] ?? 0 }))
  const decoratedMobileMore    = MOBILE_MORE.map(it => ({ ...it, count: navCounts[it.id] ?? 0 }))

  const tenantOptions = role === 'internal' ? TENANTS : null
  const userLabel = role === 'internal'
    ? 'P2 Field Services'
    : (TENANTS.find(t => t.id === tenantId)?.name || tenantId)
  const roleLabel = role === 'internal'
    ? 'Internal'
    : role === 'owner'
      ? 'Owner'
      : 'Builder'

  const sidebar = (
    <Sidebar
      sections={decoratedSections}
      activeId={activeTab}
      onSelect={setActiveTab}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(c => !c)}
      tenants={tenantOptions}
      tenantId={tenantId}
      onTenantChange={onTenantChange}
      role={role}
      userLabel={userLabel}
      roleLabel={roleLabel}
      onLogout={onLogout}
      onCreateUser={onCreateUser}
    />
  )

  const mobileNav = (
    <MobileNav
      primary={decoratedMobilePrimary}
      more={decoratedMobileMore}
      activeId={activeTab}
      onSelect={setActiveTab}
    />
  )

  return (
    <AppShell sidebar={sidebar} mobileNav={mobileNav}>
      <Suspense
        fallback={(
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Loading…
          </div>
        )}
      >
        {TAB_COMPONENTS[activeTab]}
      </Suspense>
    </AppShell>
  )
}

// ── Root Export ───────────────────────────────────────────────────────────────

export default function P2DashboardV4() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser]               = useState(null)
  const [userName, setUserName]       = useState('')
  const [role, setRole]               = useState(null)
  const [tenantId, setTenantId]       = useState('p2-core')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showSignup, setShowSignup]   = useState(false)
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [qbCallbackState, setQbCallbackState] = useState(null) // null | 'loading' | 'success' | { error: string }
  const [initialTab, setInitialTab]   = useState(null)

  // Capture QB OAuth callback params from URL on mount
  const [qbParams] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    const code = p.get('code'), state = p.get('state'), realmId = p.get('realmId')
    return code && state && realmId ? { code, state, realmId } : null
  })

  // ?portal=qbs forces builder QBS portal view (bypasses auth/terms — for demos/links)
  const [forcedPortal] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('portal')
  })

  // Process QB callback once user is authenticated
  useEffect(() => {
    if (!qbParams || !user) return
    const run = async () => {
      setQbCallbackState('loading')
      try {
        await httpsCallable(functions, 'qbCallback')(qbParams)
        window.history.replaceState({}, '', window.location.pathname)
        setQbCallbackState('success')
        setTimeout(() => { setQbCallbackState(null); setInitialTab('settings') }, 2000)
      } catch (e) {
        window.history.replaceState({}, '', window.location.pathname)
        setQbCallbackState({ error: e.message || 'Connection failed.' })
      }
    }
    run()
  }, [user, qbParams])

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

      if (!r) {
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
          if (snap.exists()) {
            r   = snap.data().role     || 'internal'
            tid = snap.data().tenantId || 'p2-core'
            dn  = snap.data().displayName || dn
          } else {
            r = 'internal'
          }
        } catch {
          r = 'internal'
        }
      }

      setUser(firebaseUser)
      setUserName(dn)
      setRole(r)
      setTenantId(tid)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  const handleLogout = async () => {
    await signOut(auth)
    setUser(null); setRole(null); setTenantId('p2-core'); setTermsAccepted(false)
  }

  if (authLoading || qbCallbackState === 'loading') {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse" style={{ backgroundColor: O }}>
            <ZapIcon size={18} color="#fff" />
          </div>
          <p className="text-muted-foreground text-sm">
            {qbCallbackState === 'loading' ? 'Connecting QuickBooks…' : 'Loading…'}
          </p>
        </div>
      </div>
    )
  }

  if (qbCallbackState === 'success' || (qbCallbackState && qbCallbackState.error)) {
    const ok = qbCallbackState === 'success'
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
            {ok ? 'QuickBooks connected successfully!' : qbCallbackState.error}
          </p>
          {!ok && (
            <button
              className="text-xs text-muted-foreground underline hover:text-white"
              onClick={() => { setQbCallbackState(null); setInitialTab('settings') }}
            >
              Back to Settings
            </button>
          )}
        </div>
      </div>
    )
  }

  // ?portal=qbs URL bypass — ALWAYS forces builder portal, even if logged in as internal.
  // This is what gets shared with QBS coordinators — they should never see internal P2 data.
  if (forcedPortal === 'qbs') {
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

function PortalLoading() {
  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse" style={{ backgroundColor: O }}>
          <ZapIcon size={18} color="#fff" />
        </div>
        <p className="text-muted-foreground text-sm">Loading portal…</p>
      </div>
    </div>
  )
}
