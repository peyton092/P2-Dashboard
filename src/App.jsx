import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
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
import {
  PageHeader, MetricTile, DataPanel, Pill,
  EmptyState, AllClearState, FilterBar,
} from './components/shared'
// daysSince is defined locally in this file with identical semantics, so we
// don't re-import it from agent/scoring (would be a duplicate declaration).
import { classifyRisk, hasFailedInspection, isBillingReady } from './agent/scoring'
import { ZONES, getZoneId } from './agent/zones'
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
                      <span className="text-xs bg-white/10 px-2 py-0.5 rounded shrink-0">{s.job}</span>
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

const JOB_FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'active',       label: 'Active' },
  { id: 'complete',     label: 'Complete' },
  { id: 'at-risk',      label: 'At risk' },
  { id: 'needs-action', label: 'Needs action' },
  { id: 'blocked',      label: 'Blocked' },
  { id: 'stale',        label: 'Stale' },
]

const JOB_FORM_INITIAL = {
  id: '', address: '', city: '', client: '', type: 'Full MEP Renovation',
  pm: 'Blake Neblett', target: '', permitNumber: '',
  subElectrical: '', subPlumbing: '', subHvac: '',
}

function isJobComplete(j) {
  return ['complete', 'completed'].includes(j.status)
}

function jobStaleness(j) {
  return daysSince(j.lastStatusChange || j.start)
}

function jobMatchesFilter(j, filter) {
  if (filter === 'all')      return true
  if (filter === 'active')   return !isJobComplete(j)
  if (filter === 'complete') return isJobComplete(j)
  if (filter === 'blocked')  return !isJobComplete(j) && (j.status === 'blocked' || j.status === 'hold' || hasFailedInspection(j))
  if (filter === 'needs-action') return !isJobComplete(j) && (j.status === 'needs-action' || hasFailedInspection(j))
  if (filter === 'stale') {
    if (isJobComplete(j)) return false
    const s = jobStaleness(j)
    return s !== null && s >= 7
  }
  if (filter === 'at-risk') {
    if (isJobComplete(j)) return false
    const r = classifyRisk(j)
    return r?.level === 'critical'
        || r?.level === 'warning'
        || j.status === 'at-risk'
        || j.status === 'needs-action'
        || j.status === 'blocked'
        || j.status === 'hold'
        || hasFailedInspection(j)
  }
  return true
}

// Job-level next-action microcopy. Operational language only.
function jobNextAction(j) {
  if (isJobComplete(j))            return 'Closeout'
  if (hasFailedInspection(j))      return 'Coordinate rework — inspection failed'
  if (j.status === 'blocked')      return 'Unblock job'
  if (j.status === 'hold')         return 'Release hold'
  if (j.status === 'needs-action') return 'Resolve open item'
  const risk = classifyRisk(j)
  if (risk?.level === 'critical')  return 'Triage — high risk'
  const stale = jobStaleness(j)
  if (stale !== null && stale >= 7) return 'Field update needed'
  if (stale !== null && stale >= 3) return 'Daily status check-in'
  if (isBillingReady(j))           return 'Submit invoice — milestone earned'
  return 'Continue scheduled work'
}

// Job-level risk pill metadata
function jobRiskMeta(j) {
  if (isJobComplete(j)) return null
  const r = classifyRisk(j)
  if (!r) return null
  if (r.level === 'critical') return { tone: 'critical', label: 'High risk' }
  if (r.level === 'warning')  return { tone: 'warning',  label: 'Medium risk' }
  if (r.level === 'info')     return { tone: 'info',     label: 'Watch' }
  return null
}

function fmtJobDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function JobStatus() {
  const { jobs = [], subs = [] } = useData()
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState('all')
  const [pmFilter, setPmFilter]     = useState('all')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [expanded, setExpanded]     = useState(null)
  const [showNewJob, setShowNewJob] = useState(false)
  const [jobForm, setJobForm]       = useState(JOB_FORM_INITIAL)
  const [creating, setCreating]     = useState(false)

  // ── Derived ────────────────────────────────────────────────────────────────

  const enriched = useMemo(() => jobs.map(j => ({
    j,
    complete: isJobComplete(j),
    risk:     classifyRisk(j),
    stale:    jobStaleness(j),
    failed:   hasFailedInspection(j),
    billRdy:  isBillingReady(j),
    zoneId:   getZoneId(j),
  })), [jobs])

  const kpis = useMemo(() => {
    const active        = enriched.filter(e => !e.complete).length
    const completed     = enriched.filter(e => e.complete).length
    const atRisk        = enriched.filter(e => !e.complete && (
      e.risk?.level === 'critical' || e.risk?.level === 'warning' ||
      ['at-risk', 'needs-action', 'blocked', 'hold'].includes(e.j.status) ||
      e.failed
    )).length
    const needsAction   = enriched.filter(e => !e.complete && (e.j.status === 'needs-action' || e.failed)).length
    const blockedStale  = enriched.filter(e => !e.complete && (
      e.j.status === 'blocked' || e.j.status === 'hold' || e.failed ||
      (e.stale !== null && e.stale >= 7)
    )).length
    return { active, completed, atRisk, needsAction, blockedStale, total: enriched.length }
  }, [enriched])

  // Chip counts (computed against the unfiltered set so users see real depth).
  const chipCounts = useMemo(() => {
    const out = {}
    JOB_FILTERS.forEach(f => { out[f.id] = enriched.filter(e => jobMatchesFilter(e.j, f.id)).length })
    return out
  }, [enriched])

  // Apply chip + PM + zone + search; sort: at-risk first, then stale, then alpha.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched
      .filter(e => jobMatchesFilter(e.j, filter))
      .filter(e => pmFilter === 'all' || e.j.pm === pmFilter)
      .filter(e => zoneFilter === 'all' || e.zoneId === zoneFilter)
      .filter(e => {
        if (!q) return true
        return (e.j.id || '').toLowerCase().includes(q)
            || (e.j.address || '').toLowerCase().includes(q)
            || (e.j.client || '').toLowerCase().includes(q)
            || (e.j.name || '').toLowerCase().includes(q)
            || (e.j.pm || '').toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => {
        // Active before complete, then risk severity, then stale, then alpha.
        if (a.complete !== b.complete) return a.complete ? 1 : -1
        const rankRisk = e =>
          e.risk?.level === 'critical' ? 0 :
          e.risk?.level === 'warning'  ? 1 :
          e.failed                     ? 1 :
          e.j.status === 'blocked'     ? 1 :
          e.j.status === 'hold'        ? 2 : 3
        const r = rankRisk(a) - rankRisk(b)
        if (r !== 0) return r
        const aStale = a.stale ?? -1
        const bStale = b.stale ?? -1
        if (aStale !== bStale) return bStale - aStale
        return jobName(a.j).localeCompare(jobName(b.j))
      })
  }, [enriched, filter, pmFilter, zoneFilter, search])

  // PM list (only PMs that own at least one job in the data, sorted).
  const pmOptions = useMemo(() => {
    const set = new Set()
    jobs.forEach(j => { if (j.pm) set.add(j.pm) })
    return Array.from(set).sort()
  }, [jobs])

  const filterChips = JOB_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || pmFilter !== 'all' || zoneFilter !== 'all' || search.trim() !== ''

  // ── New-job mutation (preserved verbatim — same createJob payload shape) ──
  const elecSubs  = (subs || []).filter(s => s.trade === 'Electrical')
  const plumbSubs = (subs || []).filter(s => s.trade === 'Plumbing')
  const hvacSubs  = (subs || []).filter(s => s.trade === 'HVAC')

  const handleCreateJob = async () => {
    if (!jobForm.id || !jobForm.address || !jobForm.client) return
    setCreating(true)
    await createJob({
      id:           jobForm.id,
      address:      jobForm.address,
      city:         jobForm.city,
      client:       jobForm.client,
      type:         jobForm.type,
      pm:           jobForm.pm,
      status:       'active',
      progress:     0,
      extras:       0,
      tenantId:     'qbs',
      lead:         '',
      start:        new Date().toISOString().slice(0, 10),
      target:       jobForm.target || '',
      county:       '',
      billingStatus:'not-invoiced',
      permitNumber: jobForm.permitNumber || '',
      subs:    { electrical: jobForm.subElectrical || null, plumbing: jobForm.subPlumbing || null, hvac: jobForm.subHvac || null },
      permits: { electrical: 'pending', plumbing: 'pending', hvac: 'pending' },
      insp: {
        electrical: { roughIn: 'pending', trim: 'blocked', final: 'blocked' },
        plumbing:   { roughIn: 'pending', final: 'blocked' },
        hvac:       { roughIn: 'pending', final: 'blocked' },
      },
    })
    setJobForm(JOB_FORM_INITIAL)
    setShowNewJob(false)
    setCreating(false)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Job Status"
        title="Portfolio status"
        subtitle="Active and completed jobs across the portfolio — risk, phase, ownership, next action."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.active} active · {kpis.completed} complete</span>
            {kpis.atRisk > 0 && (
              <span className="text-amber-300">{kpis.atRisk} at risk</span>
            )}
            <span>Middle Tennessee</span>
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => { setShowNewJob(v => !v); if (!showNewJob) setJobForm(JOB_FORM_INITIAL) }}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
            style={{ backgroundColor: O }}
          >
            <PlusIcon size={13} /> New job
          </button>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Portfolio status"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Active Jobs"
          value={kpis.active}
          Icon={ActivityIcon}
          sub={`${kpis.total} on roster`}
        />
        <MetricTile
          label="Completed"
          value={kpis.completed}
          Icon={CheckCircleIcon}
          emphasis={kpis.completed > 0 ? 'success' : 'mute'}
          sub={kpis.completed > 0 ? 'Lifetime closeouts' : 'No closeouts yet'}
        />
        <MetricTile
          label="At-Risk Jobs"
          value={kpis.atRisk}
          Icon={TriangleAlertIcon}
          emphasis={kpis.atRisk > 0 ? 'critical' : 'success'}
          sub={kpis.atRisk > 0 ? 'Warning + critical' : 'All active jobs are on track'}
        />
        <MetricTile
          label="Needs Action"
          value={kpis.needsAction}
          Icon={AlertCircleIcon}
          emphasis={kpis.needsAction > 0 ? 'warning' : 'success'}
          sub={kpis.needsAction > 0 ? 'Failed inspection or open' : 'Nothing pending'}
        />
        <MetricTile
          label="Blocked / Stale"
          value={kpis.blockedStale}
          Icon={BanIcon}
          emphasis={kpis.blockedStale > 0 ? 'critical' : 'success'}
          sub={kpis.blockedStale > 0 ? 'Blocked, on hold, or 7+ days stale' : 'No blockers'}
        />
      </section>

      {/* New-job form */}
      {showNewJob && (
        <DataPanel
          title="Create new job"
          description="Captures the job record, default permits, and inspection skeleton."
          Icon={PlusIcon}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <JobFormField label="Job ID *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500" placeholder="QBS-045" value={jobForm.id} onChange={e => setJobForm(f => ({ ...f, id: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Street address *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500" placeholder="123 Main St" value={jobForm.address} onChange={e => setJobForm(f => ({ ...f, address: e.target.value }))} />
            </JobFormField>
            <JobFormField label="City, state ZIP">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500" placeholder="Brentwood, TN 37027" value={jobForm.city} onChange={e => setJobForm(f => ({ ...f, city: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Client *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500" placeholder="Client name" value={jobForm.client} onChange={e => setJobForm(f => ({ ...f, client: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Project type">
              <Input className="bg-white/[0.04] border-white/10 text-white" value={jobForm.type} onChange={e => setJobForm(f => ({ ...f, type: e.target.value }))} />
            </JobFormField>
            <JobFormField label="PM">
              <Select value={jobForm.pm} onValueChange={v => setJobForm(f => ({ ...f, pm: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Blake Neblett','Brendan Embry','Jeb Brooks','Taylor Hensley','Tim King','Derek Powers'].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </JobFormField>
            <JobFormField label="Target date">
              <Input className="bg-white/[0.04] border-white/10 text-white" type="date" value={jobForm.target} onChange={e => setJobForm(f => ({ ...f, target: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Permit number">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500" placeholder="2026012345" value={jobForm.permitNumber} onChange={e => setJobForm(f => ({ ...f, permitNumber: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Electrical sub">
              <Select value={jobForm.subElectrical} onValueChange={v => setJobForm(f => ({ ...f, subElectrical: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {elecSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </JobFormField>
            <JobFormField label="Plumbing sub">
              <Select value={jobForm.subPlumbing} onValueChange={v => setJobForm(f => ({ ...f, subPlumbing: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {plumbSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </JobFormField>
            <JobFormField label="HVAC sub">
              <Select value={jobForm.subHvac} onValueChange={v => setJobForm(f => ({ ...f, subHvac: v }))}>
                <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {hvacSubs.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </JobFormField>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              onClick={handleCreateJob}
              disabled={creating || !jobForm.id || !jobForm.address || !jobForm.client}
              className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: O }}
            >
              {creating ? 'Creating…' : 'Create job'}
            </button>
            <button
              type="button"
              onClick={() => { setShowNewJob(false); setJobForm(JOB_FORM_INITIAL) }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              Cancel
            </button>
          </div>
        </DataPanel>
      )}

      {/* Filters — chips + PM + zone + search + clear */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, client, address, PM…"
        chips={filterChips}
        trailing={
          <>
            <select
              value={pmFilter}
              onChange={e => setPmFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Filter by PM"
            >
              <option value="all">All PMs</option>
              {pmOptions.map(pm => <option key={pm} value={pm}>{pm}</option>)}
            </select>
            <select
              value={zoneFilter}
              onChange={e => setZoneFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Filter by zone"
            >
              <option value="all">All zones</option>
              {Object.values(ZONES).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setPmFilter('all'); setZoneFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Portfolio queue */}
      <DataPanel
        title="Portfolio"
        description={
          visible.length === 0
            ? 'No jobs match the current filters.'
            : `${visible.length} of ${enriched.length} job${enriched.length === 1 ? '' : 's'}`
        }
        Icon={HardHatIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <JobStatusEmptyState filter={filter} hasOtherFilters={pmFilter !== 'all' || zoneFilter !== 'all' || search.trim() !== ''} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(({ j, complete, risk, stale, failed, billRdy, zoneId }) => (
              <li key={j._docId || j.id}>
                <JobStatusRow
                  job={j}
                  complete={complete}
                  risk={risk}
                  stale={stale}
                  failed={failed}
                  billRdy={billRdy}
                  zone={ZONES[zoneId] || null}
                  expanded={expanded === j.id}
                  onToggle={() => setExpanded(expanded === j.id ? null : j.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function JobStatusEmptyState({ filter, hasOtherFilters }) {
  if (hasOtherFilters)            return <EmptyState   Icon={HardHatIcon} title="No jobs match" description="Try clearing the search, PM, or zone filter." />
  if (filter === 'at-risk')       return <AllClearState title="All active jobs are on track" description="No critical or warning-level risk on any active job." />
  if (filter === 'needs-action')  return <AllClearState title="No jobs need action" description="No failed inspections or jobs flagged 'needs action'." />
  if (filter === 'blocked')       return <AllClearState title="Nothing blocked" description="No jobs are blocked, on hold, or have failed inspections." />
  if (filter === 'stale')         return <AllClearState title="No stale jobs" description="No active jobs without a status update in 7+ days." />
  if (filter === 'complete')      return <EmptyState   title="No completed jobs yet" description="Closeouts will appear here." />
  return <EmptyState Icon={HardHatIcon} title="No jobs yet" description="Create the first job to populate the portfolio." />
}

function JobStatusRow({
  job, complete, risk, stale, failed, billRdy, zone,
  expanded, onToggle,
}) {
  const riskMeta    = jobRiskMeta(job)
  const next        = jobNextAction(job)
  const railColor   = failed ? '#ef4444'
                    : (risk?.level === 'critical' ? '#ef4444'
                    : risk?.level === 'warning'  ? '#eab308'
                    : complete                   ? '#22c55e'
                    : '#3b82f6')
  const nextColor   = failed ? '#ef4444'
                    : (risk?.level === 'critical' ? '#ef4444'
                    : risk?.level === 'warning'  ? '#eab308'
                    : billRdy                    ? '#22c55e'
                    : O)
  const progress    = Math.max(0, Math.min(100, Number(job.progress) || 0))
  const progressMuted = complete || (risk?.level === 'critical')
  const handleKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button') && !e.target.closest('select') && !e.target.closest('[role="combobox"]')) {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('select')) return
          onToggle()
        }}
        onKeyDown={handleKey}
        className="px-4 py-4 sm:px-5 cursor-pointer transition-colors hover:bg-white/[0.025] focus:outline-none focus:bg-white/[0.04]"
        style={{ borderLeft: `3px solid ${railColor}` }}
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          {/* Body */}
          <div className="flex-1 min-w-0">
            {/* Header row — id pill, name, status select, phase select */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
                {job.id}
              </span>
              <span className="text-base font-bold text-white truncate min-w-0">
                {jobName(job)}
              </span>
              <InlineStatusSelect job={job} />
              <InlinePhaseSelect job={job} />
            </div>

            {/* Customer + address */}
            <p className="text-[11px] text-zinc-400 truncate">
              {job.client || '—'}{job.address ? ` · ${job.address}` : ''}
              {zone?.name ? ` · ${zone.name}` : ''}
            </p>

            {/* Meta row — PM, target, optional flags */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <UsersIcon size={11} /> PM <span className="text-zinc-200 font-semibold">{job.pm || '—'}</span>
              </span>
              {job.qbsPM && (
                <span className="inline-flex items-center gap-1">
                  <UsersIcon size={11} /> QBS {job.qbsPM}
                </span>
              )}
              {job.target && (
                <span className="inline-flex items-center gap-1">
                  <CalendarIcon size={11} /> Due {fmtJobDate(job.target)}
                </span>
              )}
              {stale !== null && stale >= 3 && !complete && (
                <span
                  className="font-semibold"
                  style={{ color: stale >= 7 ? '#ef4444' : '#eab308' }}
                >
                  {stale === 1 ? '1d since update' : `${stale}d since update`}
                </span>
              )}
              {riskMeta && <Pill tone={riskMeta.tone} size="xs">{riskMeta.label}</Pill>}
              {failed && <Pill tone="critical" size="xs" Icon={AlertCircleIcon}>Inspection issue</Pill>}
              {billRdy && !complete && <Pill tone="success" size="xs" Icon={DollarSignIcon}>Billing ready</Pill>}
            </div>

            {/* Next action */}
            <div className="flex items-start gap-1.5 mt-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-px">Next</span>
              <p
                className="text-[12px] font-semibold leading-snug min-w-0 truncate"
                style={{ color: nextColor }}
                title={next}
              >
                {next}
              </p>
            </div>

            {/* Mobile-only progress bar (the desktop block on the right hides at < sm) */}
            <div className="sm:hidden mt-3">
              <div className="flex items-center justify-between mb-1 text-[11px] text-zinc-400">
                <span className="truncate">{job.type || 'Project'}</span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: progressMuted ? '#9ca3af' : O }}
                >
                  {progress}%
                </span>
              </div>
              <ProgressBar value={progress} color={progressMuted ? '#9ca3af' : O} />
            </div>
          </div>

          {/* Desktop progress block */}
          <div className="hidden sm:flex flex-col items-end shrink-0 w-40">
            <p
              className="text-2xl font-semibold tabular-nums leading-none"
              style={{ color: progressMuted ? '#9ca3af' : O }}
            >
              {progress}%
            </p>
            <div className="w-full mt-1.5">
              <ProgressBar value={progress} color={progressMuted ? '#9ca3af' : O} />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5 truncate max-w-full" title={job.type}>
              {job.type || 'Project'}
            </p>
          </div>

          {/* Expand chevron */}
          <ChevronRightIcon
            size={16}
            className="hidden md:block shrink-0 text-zinc-400 mt-1 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        </div>
      </div>

      {expanded && <JobStatusDetail job={job} />}
    </div>
  )
}

function JobStatusDetail({ job }) {
  return (
    <div className="border-t border-white/5 px-4 py-4 sm:px-5 sm:py-5 grid grid-cols-1 md:grid-cols-3 gap-5 bg-white/[0.015]">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Subcontractors</p>
        {['electrical','plumbing','hvac'].some(t => job.subs?.[t]) ? (
          <ul className="space-y-1.5">
            {['electrical','plumbing','hvac'].map(t => job.subs?.[t] && (
              <li key={t} className="flex items-center justify-between text-[12px]">
                <span className="capitalize text-zinc-400">{t}</span>
                <span className="text-zinc-100 font-semibold truncate ml-2 max-w-[60%]">{job.subs[t]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-zinc-500">No subs assigned</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Permits</p>
        {['electrical','plumbing','hvac'].some(t => job.permits?.[t]) ? (
          <ul className="space-y-1.5">
            {['electrical','plumbing','hvac'].map(t => job.permits?.[t] && (
              <li key={t} className="flex items-center justify-between text-[12px]">
                <span className="capitalize text-zinc-400">{t}</span>
                <InspBadge status={job.permits[t]} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-zinc-500">No permits on file</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Invoice</p>
        <ul className="space-y-1.5 text-[12px]">
          <li className="flex justify-between gap-2">
            <span className="text-zinc-400">Invoice #</span>
            <span className="text-zinc-100 font-semibold truncate">{job.invoiceNum || '—'}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-zinc-400">Invoice date</span>
            <span className="text-zinc-100">{job.invoiceDate || '—'}</span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-zinc-400">QBS PM</span>
            <span className="text-zinc-100">{job.qbsPM || '—'}</span>
          </li>
          <li className="flex justify-between items-center gap-2 pt-2 border-t border-white/5 mt-1">
            <span className="text-zinc-400">Status</span>
            <BillingStatusSelect job={job} />
          </li>
        </ul>
      </div>
    </div>
  )
}

// Form-field wrapper used by the new-job panel — renders an uppercase label
// above the input control. Sibling to the Materials FormFieldLabel; kept
// separate so each phase's form helper stays self-contained.
function JobFormField({ label, children }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 block mb-1.5">
        {label}
      </span>
      {children}
    </div>
  )
}

// ── Tab: Extras / COs ─────────────────────────────────────────────────────────

function Extras() {
  return <ChangeOrdersComponent />
}

// ── Tab: Inspections ──────────────────────────────────────────────────────────

const INSP_STATUSES = ['pending', 'scheduled', 'passed', 'failed', 'blocked', 'n/a']

const TRADE_META = {
  electrical: { label: 'Electrical (3-Phase)',          color: O,         Icon: ZapIcon,    phases: ['roughIn', 'trim', 'final'] },
  plumbing:   { label: 'Plumbing (2-Phase)',            color: '#06b6d4', Icon: WrenchIcon, phases: ['roughIn', 'final'] },
  hvac:       { label: 'HVAC (2-Phase · Blocking)',     color: '#3b82f6', Icon: HammerIcon, phases: ['roughIn', 'final'] },
}

const PHASE_LABEL = { roughIn: 'Rough-In', trim: 'Trim', final: 'Final' }

// Inspection status → Pill tone in the Phase 1 palette.
function inspectionStatusTone(status) {
  if (status === 'passed')                                            return 'success'
  if (status === 'failed')                                            return 'critical'
  if (status === 'scheduled')                                         return 'warning'
  if (status === 'blocked')                                           return 'info'
  if (status === 'pending' || status === 'pending-verification')      return 'mute'
  if (status === 'n/a')                                               return 'neutral'
  return 'neutral'
}

function inspectionStatusLabel(status) {
  if (status === 'passed')                return 'Passed'
  if (status === 'failed')                return 'Failed'
  if (status === 'scheduled')             return 'Scheduled'
  if (status === 'blocked')               return 'Blocked'
  if (status === 'pending')               return 'Pending'
  if (status === 'pending-verification')  return 'Verify'
  if (status === 'n/a')                   return 'N/A'
  return (status || 'Pending').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Job status → Pill tone
function inspJobStatusTone(status) {
  if (status === 'on-track' || status === 'complete' || status === 'completed') return 'success'
  if (status === 'needs-action' || status === 'active') return 'brand'
  if (status === 'at-risk') return 'warning'
  if (status === 'blocked' || status === 'hold') return 'critical'
  if (status === 'pending') return 'mute'
  return 'neutral'
}

function PhaseRow({ label, status, note, docId, field }) {
  const canEdit = !!docId
  const [, trade, phase] = field ? field.split('.') : []
  const meta = iMeta(status)
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 gap-2">
      <span className="text-sm text-zinc-300 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {note && (
          <span className="text-[11px] text-red-400 max-w-[160px] truncate" title={note}>
            {note}
          </span>
        )}
        {canEdit ? (
          <>
            <select
              value={status || 'pending'}
              onChange={e => updateJob(docId, { [field]: e.target.value })}
              className="text-[11px] font-bold px-2 py-0.5 rounded-full cursor-pointer appearance-none"
              style={{
                color: meta.color,
                backgroundColor: meta.color + '22',
                border: `1px solid ${meta.color}44`,
              }}
              aria-label={`Update ${label} status`}
            >
              {INSP_STATUSES.map(s => (
                <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>
                  {inspectionStatusLabel(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => passInspection(docId, trade, phase)}
              title="Mark passed"
              aria-label={`Mark ${label} passed`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}
            >
              <CheckIcon size={13} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => failInspection(docId, trade, phase)}
              title="Mark failed"
              aria-label={`Mark ${label} failed`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}
            >
              <XIcon size={13} strokeWidth={2.5} />
            </button>
          </>
        ) : (
          <Pill tone={inspectionStatusTone(status)} size="xs">
            {inspectionStatusLabel(status)}
          </Pill>
        )}
      </div>
    </div>
  )
}

function Inspections() {
  const { jobs = [], dailyReports = [] } = useData()
  const [filter, setFilter] = useState('all')
  const [tradeFilter, setTradeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const activeJobs = useMemo(
    () => jobs.filter(j => !['complete', 'completed'].includes(j.status)),
    [jobs],
  )

  // Per-job inspection signal — phase rollups + readiness gate.
  const enriched = useMemo(() => activeJobs.map(j => {
    const insp = j.insp || {}
    const phases = []
    Object.entries(TRADE_META).forEach(([trade, meta]) => {
      meta.phases.forEach(phase => {
        const status = insp[trade]?.[phase]
        if (status === 'n/a') return
        phases.push({ trade, phase, status: status || 'pending' })
      })
    })

    const failed    = phases.some(p => p.status === 'failed')
    const blocked   = phases.some(p => p.status === 'blocked')
    const scheduled = phases.some(p => p.status === 'scheduled')
    const allPassed = phases.length > 0 && phases.every(p => p.status === 'passed')

    // Readiness gate — mirrors the original 4-check logic.
    const crewReport = (dailyReports || []).some(r => r.date === YESTERDAY_STR && r.jobId === j.id)
    const photosOk   = (j.photoCount || 0) >= 3
    const phaseOk    = ['passed', 'finaled'].some(s =>
      [j.insp?.electrical?.roughIn, j.insp?.plumbing?.roughIn, j.insp?.hvac?.roughIn].includes(s),
    )
    const camOk      = j.companyCamUpdated || false
    const ready      = crewReport && photosOk && phaseOk && camOk

    return {
      job: j,
      phases,
      failed,
      blocked,
      scheduled,
      allPassed,
      ready,
      gate: { crewReport, photosOk, phaseOk, camOk },
    }
  }), [activeJobs, dailyReports])

  // KPI counts — aggregated across active jobs.
  const kpis = useMemo(() => {
    let phasesPassed = 0, phasesFailed = 0, phasesScheduled = 0
    enriched.forEach(e => {
      e.phases.forEach(p => {
        if      (p.status === 'passed')    phasesPassed    += 1
        else if (p.status === 'failed')    phasesFailed    += 1
        else if (p.status === 'scheduled') phasesScheduled += 1
      })
    })
    return {
      ready:     enriched.filter(e => e.ready).length,
      scheduled: phasesScheduled,
      passed:    phasesPassed,
      failed:    phasesFailed,
      rework:    enriched.filter(e => e.failed || e.blocked).length,
    }
  }, [enriched])

  // Filter chip counts (computed against unfiltered list).
  const chipCounts = useMemo(() => ({
    all:       enriched.length,
    ready:     enriched.filter(e => e.ready).length,
    scheduled: enriched.filter(e => e.scheduled).length,
    passed:    enriched.filter(e => e.allPassed).length,
    failed:    enriched.filter(e => e.failed).length,
    rework:    enriched.filter(e => e.failed || e.blocked).length,
  }), [enriched])

  // Apply filter + trade + search; sort: failed → blocked → scheduled → ready → other.
  const filtered = useMemo(() => {
    let list = enriched
    if      (filter === 'ready')     list = list.filter(e => e.ready)
    else if (filter === 'scheduled') list = list.filter(e => e.scheduled)
    else if (filter === 'passed')    list = list.filter(e => e.allPassed)
    else if (filter === 'failed')    list = list.filter(e => e.failed)
    else if (filter === 'rework')    list = list.filter(e => e.failed || e.blocked)

    if (tradeFilter !== 'all') {
      list = list.filter(e => e.phases.some(p => p.trade === tradeFilter))
    }

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(({ job: j }) =>
        (j.id || '').toLowerCase().includes(q) ||
        (j.name || '').toLowerCase().includes(q) ||
        (j.client || '').toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q) ||
        (j.pm || '').toLowerCase().includes(q),
      )
    }

    return list.slice().sort((a, b) => {
      const order = e => e.failed ? 0 : e.blocked ? 1 : e.scheduled ? 2 : e.ready ? 3 : 4
      const o = order(a) - order(b)
      if (o !== 0) return o
      return jobName(a.job).localeCompare(jobName(b.job))
    })
  }, [enriched, filter, tradeFilter, search])

  const FILTERS = [
    { id: 'all',       label: 'All' },
    { id: 'ready',     label: 'Ready' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'passed',    label: 'Passed' },
    { id: 'failed',    label: 'Failed' },
    { id: 'rework',    label: 'Rework' },
  ]
  const filterChips = FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))
  const hasActiveFilters = filter !== 'all' || tradeFilter !== 'all' || search.trim() !== ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inspections"
        title="Inspection readiness & resolution"
        subtitle="Across active jobs. Surface ready-to-call, scheduled, and rework needed."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{activeJobs.length} active jobs</span>
            {kpis.failed > 0 && (
              <span className="text-red-300">
                {kpis.failed} failed phase{kpis.failed === 1 ? '' : 's'}
              </span>
            )}
          </>
        }
      />

      {/* SOP reminder */}
      <DataPanel
        title="Inspection protocol"
        Icon={AlertTriangleIcon}
        badge={<Pill tone="warning" size="xs">SOP</Pill>}
      >
        <p className="text-xs text-zinc-300 leading-relaxed">
          Sequence: <span className="font-semibold text-white">Rough-In → Trim</span> (electrical only) <span className="font-semibold text-white">→ Final</span>. Call inspection only after the readiness gate is green: crew report submitted, min 3 photos uploaded, phase work confirmed, CompanyCam updated. <span className="font-semibold text-red-300">HVAC rough-in failure blocks the final</span> — do not schedule final until rough-in passes.
        </p>
      </DataPanel>

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Inspection pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Ready for Inspection"
          value={kpis.ready}
          Icon={BadgeCheckIcon}
          emphasis={kpis.ready > 0 ? 'success' : 'mute'}
          sub={kpis.ready > 0 ? 'Gate passed — call in' : 'No jobs cleared yet'}
        />
        <MetricTile
          label="Scheduled"
          value={kpis.scheduled}
          Icon={ClockIcon}
          emphasis={kpis.scheduled > 0 ? 'warning' : 'mute'}
          sub={kpis.scheduled > 0 ? 'Inspector booked' : 'Nothing on the books'}
        />
        <MetricTile
          label="Passed"
          value={kpis.passed}
          Icon={CheckCircleIcon}
          emphasis={kpis.passed > 0 ? 'success' : 'mute'}
          sub={kpis.passed > 0 ? 'Phases cleared' : 'No passes yet'}
        />
        <MetricTile
          label="Failed"
          value={kpis.failed}
          Icon={AlertCircleIcon}
          emphasis={kpis.failed > 0 ? 'critical' : 'success'}
          sub={kpis.failed > 0 ? 'Rework required' : 'No failures'}
        />
        <MetricTile
          label="Rework Needed"
          value={kpis.rework}
          Icon={TriangleAlertIcon}
          emphasis={kpis.rework > 0 ? 'critical' : 'success'}
          sub={kpis.rework > 0 ? 'Failed or blocked jobs' : 'No rework on the board'}
        />
      </section>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, builder, address, PM…"
        chips={filterChips}
        trailing={
          <>
            <select
              value={tradeFilter}
              onChange={e => setTradeFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30"
              aria-label="Filter by trade"
            >
              <option value="all">All trades</option>
              <option value="electrical">Electrical</option>
              <option value="plumbing">Plumbing</option>
              <option value="hvac">HVAC</option>
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setTradeFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Inspection queue */}
      {filtered.length === 0 ? (
        <DataPanel
          title="Inspection Queue"
          Icon={BadgeCheckIcon}
          description="No jobs match the current filters."
        >
          <InspectionsEmptyState filter={filter} hasSearch={Boolean(search.trim() || tradeFilter !== 'all')} />
        </DataPanel>
      ) : (
        <div className="space-y-4">
          {filtered.map(({ job: j, gate }) => (
            <InspectionJobCard
              key={j._docId || j.id}
              job={j}
              gate={gate}
              tradeFilter={tradeFilter}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function InspectionsEmptyState({ filter, hasSearch }) {
  if (hasSearch) {
    return <EmptyState Icon={BadgeCheckIcon} title="No jobs match" description="Adjust the search or clear filters to see the full queue." />
  }
  if (filter === 'ready')     return <AllClearState title="Nothing ready to call in" description="The readiness gate hasn't cleared on any active job yet." />
  if (filter === 'scheduled') return <EmptyState   title="No inspections scheduled" description="Mark a phase 'Scheduled' once an inspector is booked." />
  if (filter === 'passed')    return <EmptyState   title="No fully-passed jobs" description="Jobs with every phase passed will show here." />
  if (filter === 'failed')    return <AllClearState title="No failed inspections" description="No phases are currently in 'Failed' status." />
  if (filter === 'rework')    return <AllClearState title="No rework on the board" description="No failed or blocked phases on any active job." />
  return <AllClearState title="All inspections clear" description="No active inspection work to surface." />
}

function InspectionJobCard({ job: j, gate, tradeFilter }) {
  const visibleTrades = tradeFilter === 'all'
    ? ['electrical', 'plumbing', 'hvac']
    : [tradeFilter]
  const gridCls = visibleTrades.length === 1 ? '' : 'md:grid-cols-3'
  const checks = [
    { label: 'Crew report submitted',         ok: gate.crewReport },
    { label: 'Photos uploaded (min 3)',       ok: gate.photosOk   },
    { label: 'Phase work confirmed complete', ok: gate.phaseOk    },
    { label: 'CompanyCam updated',            ok: gate.camOk      },
  ]
  const allOk = checks.every(c => c.ok)
  const statusTone = inspJobStatusTone(j.status)
  const statusLabel = (j.status || 'active').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.025] overflow-hidden">
      {/* Header */}
      <header className="px-4 sm:px-5 py-3 border-b border-white/5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
                {j.id}
              </span>
              <span className="text-base font-bold text-white truncate">{jobName(j)}</span>
              <Pill tone={statusTone} size="xs">{statusLabel}</Pill>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1 truncate">
              {j.address || '—'}{j.pm ? ` · PM ${j.pm}` : ''}{j.lead ? ` · Lead ${j.lead}` : ''}
            </p>
          </div>
        </div>
      </header>

      {/* Trade columns */}
      <div className="p-4 sm:p-5">
        <div className={`grid gap-5 ${gridCls}`}>
          {visibleTrades.map(trade => {
            const meta = TRADE_META[trade]
            const subName = j.subs?.[trade] || (trade === 'plumbing' ? 'N/A' : '—')
            const phaseValues = meta.phases.map(p => j.insp?.[trade]?.[p])
            const passedCount = phaseValues.filter(s => s === 'passed').length
            const progressPct = meta.phases.length > 0
              ? Math.round((passedCount / meta.phases.length) * 100)
              : 0
            return (
              <div key={trade} className="min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <meta.Icon size={14} style={{ color: meta.color }} className="shrink-0" />
                  <p className="text-sm font-semibold text-white truncate">{meta.label}</p>
                  <span className="text-[10px] text-zinc-400 ml-auto shrink-0 truncate max-w-[140px]">
                    Sub: {subName}
                  </span>
                </div>
                {meta.phases.map(phase => (
                  <PhaseRow
                    key={phase}
                    label={PHASE_LABEL[phase]}
                    status={j.insp?.[trade]?.[phase]}
                    note={trade === 'electrical' && phase === 'trim' ? j.insp?.[trade]?.note : undefined}
                    docId={j._docId}
                    field={`insp.${trade}.${phase}`}
                  />
                ))}
                {trade === 'hvac' && j.insp?.hvac?.roughIn === 'failed' && (
                  <div
                    className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-md"
                    style={{ backgroundColor: '#3b82f60d', border: '1px solid #3b82f655' }}
                  >
                    <AlertCircleIcon size={12} color="#3b82f6" className="shrink-0" />
                    <span className="text-[11px] text-blue-300 leading-snug">
                      Final blocked — rough-in must pass first
                    </span>
                  </div>
                )}
                <div className="mt-2.5">
                  <ProgressBar value={progressPct} color={meta.color} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Readiness gate */}
        <div className="mt-5 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
              Inspection readiness gate
            </p>
            <Pill
              tone={allOk ? 'success' : 'critical'}
              size="xs"
              Icon={allOk ? CheckCircleIcon : AlertCircleIcon}
            >
              {allOk ? 'Ready to call in' : 'Not ready'}
            </Pill>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {checks.map(c => (
              <div
                key={c.label}
                className="flex items-center gap-2 px-2 py-2 rounded-lg"
                style={{
                  backgroundColor: c.ok ? '#22c55e0d' : '#ef44440d',
                  border: `1px solid ${c.ok ? '#22c55e22' : '#ef444422'}`,
                }}
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                  style={{ backgroundColor: c.ok ? '#22c55e22' : '#ef444422' }}
                >
                  {c.ok
                    ? <CheckIcon size={10} color="#22c55e" />
                    : <XIcon size={10} color="#ef4444" />}
                </div>
                <p className="text-[11px] leading-tight" style={{ color: c.ok ? '#22c55e' : '#ef4444' }}>
                  {c.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Tab: Subs ─────────────────────────────────────────────────────────────────

const SUB_STATUS_OPTIONS = ['active', 'done', 'issue']
const SUB_STATUS_COLOR   = { active: '#22c55e', done: '#6b7280', issue: '#ef4444' }

const SUB_FILTERS = [
  { id: 'all',            label: 'All' },
  { id: 'approved',       label: 'Approved' },
  { id: 'pending',        label: 'Pending' },
  { id: 'blocked',        label: 'Blocked' },
  { id: 'missing-docs',   label: 'Missing docs' },
  { id: 'expired',        label: 'Expired insurance' },
  { id: 'expiring-soon',  label: 'Expiring soon' },
]

// Date utility — null when missing/invalid; integer days otherwise (negative = expired).
function daysUntilDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((d.getTime() - today.getTime()) / 86400000)
}

function subInsuranceState(s) {
  const days = daysUntilDate(s.insExp)
  if (days === null) return 'unknown'
  if (days < 0)      return 'expired'
  if (days < 30)     return 'expiring-30'
  if (days < 60)     return 'expiring-60'
  return 'valid'
}
function subLicenseState(s) {
  const days = daysUntilDate(s.licExp)
  if (days === null) return 'unknown'
  if (days < 0)      return 'expired'
  if (days < 60)     return 'expiring-60'
  return 'valid'
}

function subHasMissingDocs(s) {
  return !s.w9
}
function subInsuranceExpired(s) {
  return subInsuranceState(s) === 'expired'
}
function subInsuranceExpiringSoon(s) {
  const st = subInsuranceState(s)
  return st === 'expiring-30' || st === 'expiring-60'
}
function subLicenseExpired(s) {
  return subLicenseState(s) === 'expired'
}

// Compliance verdict for the sub. Order matters: blocked > pending > approved.
function subComplianceVerdict(s) {
  if (subHasMissingDocs(s) || subInsuranceExpired(s) || subLicenseExpired(s)) {
    return { tone: 'critical', label: 'Do not assign' }
  }
  if (subInsuranceExpiringSoon(s) || subLicenseState(s) === 'expiring-60') {
    return { tone: 'warning', label: 'Compliance review needed' }
  }
  if ((s.score ?? 100) < 80) {
    return { tone: 'warning', label: 'Compliance review needed' }
  }
  return { tone: 'success', label: 'Approved for work' }
}

function subMatchesFilter(s, filter) {
  if (filter === 'all')           return true
  const v = subComplianceVerdict(s)
  if (filter === 'approved')      return v.label === 'Approved for work'
  if (filter === 'pending')       return v.label === 'Compliance review needed'
  if (filter === 'blocked')       return v.label === 'Do not assign'
  if (filter === 'missing-docs')  return subHasMissingDocs(s)
  if (filter === 'expired')       return subInsuranceExpired(s) || subLicenseExpired(s)
  if (filter === 'expiring-soon') return subInsuranceExpiringSoon(s)
  return true
}

// Single most important next action per sub.
function subNextAction(s) {
  if (subHasMissingDocs(s))            return 'Collect W-9 — cannot assign'
  if (subInsuranceExpired(s))          return 'Insurance expired — do not assign'
  if (subLicenseExpired(s))            return 'License expired — do not assign'
  if (subInsuranceState(s) === 'expiring-30') return 'Insurance expiring within 30 days — request renewal'
  if (subInsuranceState(s) === 'expiring-60') return 'Insurance expiring soon — flag for follow-up'
  if (subLicenseState(s) === 'expiring-60')   return 'License expiring soon — flag for follow-up'
  const days = daysSince(s.lastUpdate)
  if (days !== null && days > 5)       return 'Field update needed'
  if ((s.score ?? 100) < 80)           return 'Compliance review needed'
  return 'Ready to assign — no compliance issues'
}

function fmtSubDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Map a sub to the trade-key form found on job documents (e.g. "P2 In-House"
// for the in-house sub vs. first-name slug for outside subs).
function subJobKey(s) {
  return s.id === 'p2' ? 'P2 In-House' : (s.name || '').split(' ')[0]
}

const TRADE_FILTERS = [
  { id: 'all',        label: 'All trades' },
  { id: 'Electrical', label: 'Electrical' },
  { id: 'Plumbing',   label: 'Plumbing' },
  { id: 'HVAC',       label: 'HVAC' },
]

function SubsTab() {
  const { subs: SUBS = [], jobs = [] } = useData()
  const [filter, setFilter]           = useState('all')
  const [tradeFilter, setTradeFilter] = useState('all')
  const [search, setSearch]           = useState('')
  const [expandedSub, setExpandedSub] = useState(null)

  // ── Derived ────────────────────────────────────────────────────────────────

  const enriched = useMemo(() => SUBS.map(s => {
    const key = subJobKey(s)
    const subJobs = jobs
      .filter(j => j.subs?.electrical === key || j.subs?.plumbing === key || j.subs?.hvac === key)
      .map(j => ({
        ...j,
        trade: j.subs?.electrical === key ? 'electrical'
             : j.subs?.plumbing === key   ? 'plumbing'
             : 'hvac',
      }))
      .sort((a, b) => jobName(a).localeCompare(jobName(b)))
    const activeJobs = subJobs.filter(j => !['complete', 'completed'].includes(j.status))
    return {
      s,
      verdict:        subComplianceVerdict(s),
      insState:       subInsuranceState(s),
      licState:       subLicenseState(s),
      insDays:        daysUntilDate(s.insExp),
      licDays:        daysUntilDate(s.licExp),
      lastUpdateDays: daysSince(s.lastUpdate),
      subJobs,
      activeJobCount: activeJobs.length,
    }
  }), [SUBS, jobs])

  // KPI counts — derived from full set, not the filtered list.
  const kpis = useMemo(() => {
    const active     = enriched.length
    const approved   = enriched.filter(e => e.verdict.label === 'Approved for work').length
    const missing    = enriched.filter(e => subHasMissingDocs(e.s)).length
    const expired    = enriched.filter(e => subInsuranceExpired(e.s) || subLicenseExpired(e.s)).length
    const expSoon    = enriched.filter(e => subInsuranceExpiringSoon(e.s) || e.licState === 'expiring-60').length
    const tiedToJobs = enriched.filter(e => e.activeJobCount > 0).length
    return { active, approved, missing, expired, expSoon, tiedToJobs }
  }, [enriched])

  // Chip counts (against the unfiltered set so users see real depth).
  const chipCounts = useMemo(() => {
    const out = {}
    SUB_FILTERS.forEach(f => { out[f.id] = enriched.filter(e => subMatchesFilter(e.s, f.id)).length })
    return out
  }, [enriched])

  // Apply chip + trade + search; sort: blocked → pending → approved, then alpha.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched
      .filter(e => subMatchesFilter(e.s, filter))
      .filter(e => tradeFilter === 'all' || e.s.trade === tradeFilter)
      .filter(e => {
        if (!q) return true
        return (e.s.name || '').toLowerCase().includes(q)
            || (e.s.co || '').toLowerCase().includes(q)
            || (e.s.phone || '').toLowerCase().includes(q)
            || (e.s.lic || '').toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => {
        const verdictRank = v =>
          v === 'Do not assign'             ? 0 :
          v === 'Compliance review needed'  ? 1 : 2
        const r = verdictRank(a.verdict.label) - verdictRank(b.verdict.label)
        if (r !== 0) return r
        return (a.s.name || '').localeCompare(b.s.name || '')
      })
  }, [enriched, filter, tradeFilter, search])

  const filterChips = SUB_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || tradeFilter !== 'all' || search.trim() !== ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Subs"
        title="Compliance & assignments"
        subtitle="Active subcontractors, compliance status, and live job assignments — protect against insurance lapse."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.active} subs · {kpis.approved} approved</span>
            {kpis.expired > 0 && (
              <span className="text-red-300">{kpis.expired} expired</span>
            )}
            {kpis.missing > 0 && (
              <span className="text-amber-300">{kpis.missing} missing docs</span>
            )}
          </>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Subcontractor compliance"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Active Subs"
          value={kpis.active}
          Icon={UsersRoundIcon}
          sub={kpis.tiedToJobs > 0 ? `${kpis.tiedToJobs} tied to active jobs` : 'On the roster'}
        />
        <MetricTile
          label="Approved"
          value={kpis.approved}
          Icon={ShieldCheckIcon}
          emphasis={kpis.approved > 0 ? 'success' : 'mute'}
          sub={kpis.approved > 0 ? 'Cleared to work' : 'No subs cleared yet'}
        />
        <MetricTile
          label="Missing Documents"
          value={kpis.missing}
          Icon={FileTextIcon}
          emphasis={kpis.missing > 0 ? 'warning' : 'success'}
          sub={kpis.missing > 0 ? 'W-9 not on file' : 'All W-9s on file'}
        />
        <MetricTile
          label="Expired Insurance"
          value={kpis.expired}
          Icon={TriangleAlertIcon}
          emphasis={kpis.expired > 0 ? 'critical' : 'success'}
          sub={kpis.expired > 0 ? 'Do not assign' : 'No expired coverage'}
        />
        <MetricTile
          label="Expiring Soon"
          value={kpis.expSoon}
          Icon={ClockIcon}
          emphasis={kpis.expSoon > 0 ? 'warning' : 'success'}
          sub={kpis.expSoon > 0 ? 'Within 60 days' : 'No upcoming expirations'}
        />
      </section>

      {/* Filters — chips + trade select + search + clear */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search sub, company, phone, license…"
        chips={filterChips}
        trailing={
          <>
            <select
              value={tradeFilter}
              onChange={e => setTradeFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
              aria-label="Filter by trade"
            >
              {TRADE_FILTERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setTradeFilter('all'); setSearch('') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Subcontractor queue */}
      <DataPanel
        title="Subcontractor queue"
        description={
          visible.length === 0
            ? 'No subs match the current filters.'
            : `${visible.length} of ${enriched.length} sub${enriched.length === 1 ? '' : 's'}`
        }
        Icon={UsersRoundIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <SubsEmptyState filter={filter} hasOtherFilters={tradeFilter !== 'all' || search.trim() !== ''} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(item => (
              <li key={item.s.id}>
                <SubRow
                  item={item}
                  expanded={expandedSub === item.s.id}
                  onToggle={() => setExpandedSub(expandedSub === item.s.id ? null : item.s.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function SubsEmptyState({ filter, hasOtherFilters }) {
  if (hasOtherFilters)              return <EmptyState   Icon={UsersRoundIcon} title="No subs match" description="Try clearing the search or trade filter." />
  if (filter === 'approved')        return <EmptyState   title="No approved subs" description="No subcontractors are currently cleared for work." />
  if (filter === 'pending')         return <AllClearState title="No compliance reviews pending" description="No subs flagged for review." />
  if (filter === 'blocked')         return <AllClearState title="No subs blocked" description="No compliance issues are blocking assignment right now." />
  if (filter === 'missing-docs')    return <AllClearState title="All W-9s on file" description="Every sub has a W-9 collected." />
  if (filter === 'expired')         return <AllClearState title="No expired insurance" description="No expired insurance or license documents on the roster." />
  if (filter === 'expiring-soon')   return <AllClearState title="No upcoming expirations" description="No insurance or license expiring within 60 days." />
  return <EmptyState Icon={UsersRoundIcon} title="No subs yet" description="Subcontractors will appear here once they're on the roster." />
}

function SubRow({ item, expanded, onToggle }) {
  const { s, verdict, insState, licState, insDays, licDays, lastUpdateDays, subJobs, activeJobCount } = item
  const tColor   = tradeColor[s.trade] || '#9ca3af'
  const initials = (s.name || '—').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const action   = subNextAction(s)

  // Severity rail color follows the verdict — critical/warning/success.
  const railColor = verdict.tone === 'critical' ? '#ef4444'
                  : verdict.tone === 'warning'  ? '#eab308'
                  : '#22c55e'

  const insColor = insState === 'expired'         ? '#ef4444'
                 : insState === 'expiring-30'     ? '#ef4444'
                 : insState === 'expiring-60'     ? '#eab308'
                 : insState === 'valid'           ? '#22c55e'
                 : '#9ca3af'

  const licColor = licState === 'expired'         ? '#ef4444'
                 : licState === 'expiring-60'     ? '#eab308'
                 : licState === 'valid'           ? '#22c55e'
                 : '#9ca3af'

  const insLabel = insState === 'expired'      ? `${Math.abs(insDays || 0)}d ago`
                 : insState === 'expiring-30'  ? `${insDays}d left`
                 : insState === 'expiring-60'  ? `${insDays}d left`
                 : insState === 'valid'        ? fmtSubDate(s.insExp)
                 : '—'

  const licLabel = licState === 'expired'      ? `${Math.abs(licDays || 0)}d ago`
                 : licState === 'expiring-60'  ? `${licDays}d left`
                 : licState === 'valid'        ? fmtSubDate(s.licExp)
                 : '—'

  const score = s.score ?? null
  const scoreColor = score === null ? '#9ca3af'
                   : score >= 90 ? '#22c55e'
                   : score >= 80 ? O
                   : '#ef4444'

  const updateColor = lastUpdateDays === null ? '#9ca3af'
                    : lastUpdateDays > 5 ? '#ef4444'
                    : lastUpdateDays > 2 ? '#eab308'
                    : '#22c55e'
  const updateLabel = lastUpdateDays === null ? 'No data'
                    : lastUpdateDays === 0    ? 'Today'
                    : lastUpdateDays === 1    ? '1d ago'
                    : `${lastUpdateDays}d ago`

  const handleKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button') && !e.target.closest('[role="combobox"]') && !e.target.closest('select') && !e.target.closest('textarea')) {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('select') || e.target.closest('textarea')) return
          onToggle()
        }}
        onKeyDown={handleKey}
        className="px-4 py-4 sm:px-5 cursor-pointer transition-colors hover:bg-white/[0.025] focus:outline-none focus:bg-white/[0.04]"
        style={{ borderLeft: `3px solid ${railColor}` }}
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-3">
          {/* Avatar with trade color */}
          <div
            className="shrink-0 mt-0.5 flex items-center justify-center rounded-full text-[11px] font-bold"
            style={{ width: 36, height: 36, backgroundColor: tColor + '22', color: tColor }}
          >
            {initials}
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            {/* Header row — name + trade pill + verdict + active job count */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold text-white truncate">{s.name || '—'}</span>
              <span
                className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ color: tColor, backgroundColor: tColor + '22', border: `1px solid ${tColor}55` }}
              >
                {s.trade}
              </span>
              <Pill tone={verdict.tone} size="xs">{verdict.label}</Pill>
              {activeJobCount > 0 && (
                <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">
                  {activeJobCount} active job{activeJobCount === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {/* Identity line — company / license / phone */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 mb-2">
              {s.co && <span className="truncate max-w-[280px]">{s.co}</span>}
              {s.lic && <span>{s.lic}</span>}
              {s.phone && (
                <a
                  href={`tel:${s.phone}`}
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-zinc-300 hover:text-white"
                >
                  <PhoneIcon size={11} /> {s.phone}
                </a>
              )}
            </div>

            {/* Compliance grid — Insurance / License / Score / Last update */}
            <div className="grid gap-2 mb-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
              <ComplianceCell label="Insurance" valueLabel={insLabel} colorOverride={insColor} stateNote={insState === 'expired' ? 'Expired' : insState === 'expiring-30' ? 'Expiring' : insState === 'expiring-60' ? 'Expiring soon' : insState === 'valid' ? 'Valid' : 'No data'} />
              <ComplianceCell label="License" valueLabel={licLabel} colorOverride={licColor} stateNote={licState === 'expired' ? 'Expired' : licState === 'expiring-60' ? 'Expiring soon' : licState === 'valid' ? 'Valid' : 'No data'} />
              <ComplianceCell label="Score" valueLabel={score === null ? '—' : `${score}`} colorOverride={scoreColor} stateNote={score === null ? 'No score' : score >= 90 ? 'Excellent' : score >= 80 ? 'Watch' : 'Below threshold'} />
              <ComplianceCell label="Last update" valueLabel={updateLabel} colorOverride={updateColor} stateNote={lastUpdateDays === null ? 'No data' : lastUpdateDays > 5 ? 'Field update needed' : lastUpdateDays > 2 ? 'Reach out today' : 'Fresh'} />
            </div>

            {/* W-9 status + next action */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {s.w9
                ? <Pill tone="success" size="xs" Icon={CheckCircleIcon}>W-9 on file</Pill>
                : <Pill tone="critical" size="xs" Icon={AlertCircleIcon}>W-9 missing</Pill>}
              {insState === 'expired' && <Pill tone="critical" size="xs" Icon={TriangleAlertIcon}>Insurance expired</Pill>}
              {(insState === 'expiring-30' || insState === 'expiring-60') && <Pill tone="warning" size="xs" Icon={ClockIcon}>Insurance expiring</Pill>}
              {licState === 'expired' && <Pill tone="critical" size="xs" Icon={TriangleAlertIcon}>License expired</Pill>}
            </div>

            <div className="flex items-start gap-1.5 mt-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-px">Next</span>
              <p
                className="text-[12px] font-semibold leading-snug min-w-0"
                style={{ color: railColor }}
                title={action}
              >
                {action}
              </p>
            </div>
          </div>

          {/* Expand chevron */}
          <ChevronRightIcon
            size={16}
            className="hidden md:block shrink-0 text-zinc-400 mt-1.5 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        </div>
      </div>

      {expanded && <SubAssignments subJobs={subJobs} />}
    </div>
  )
}

function ComplianceCell({ label, valueLabel, colorOverride, stateNote }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 truncate">{label}</p>
      <p className="text-sm font-semibold tabular-nums truncate" style={{ color: colorOverride || '#fff' }}>
        {valueLabel}
      </p>
      {stateNote && <p className="text-[10px] text-zinc-500 truncate">{stateNote}</p>}
    </div>
  )
}

function SubAssignments({ subJobs }) {
  if (!subJobs || subJobs.length === 0) {
    return (
      <div className="px-4 sm:px-5 pb-4">
        <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.015] py-6 text-center">
          <p className="text-[11px] text-zinc-400">No active job assignments found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-5 pb-4 -mt-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">Job assignments</p>
      <ul className="space-y-2">
        {subJobs.map(j => <SubAssignmentRow key={`${j.id}_${j.trade}`} job={j} />)}
      </ul>
    </div>
  )
}

function SubAssignmentRow({ job: j }) {
  const subStatus = (j.subsStatus || {})[j.trade] || 'active'
  const looseEnds = (j.subsLooseEnds || {})[j.trade] || ''
  const sc = SUB_STATUS_COLOR[subStatus] || '#6b7280'
  const tradeKey  = j.trade.charAt(0).toUpperCase() + j.trade.slice(1)
  const tColor    = tradeColor[tradeKey] || '#9ca3af'
  const isComplete = ['complete', 'completed'].includes(j.status)

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {j.id}
          </span>
          <span className="text-sm font-semibold text-white truncate">{jobName(j)}</span>
          <span
            className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap"
            style={{ color: tColor, backgroundColor: tColor + '22', border: `1px solid ${tColor}55` }}
          >
            {j.trade}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          <Select
            value={subStatus}
            onValueChange={v => j._docId && updateJob(j._docId, { [`subsStatus.${j.trade}`]: v })}
          >
            <SelectTrigger
              className="h-auto py-0.5 px-2.5 text-[11px] font-bold border rounded-full"
              style={{ backgroundColor: sc + '22', color: sc, borderColor: sc + '55' }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUB_STATUS_OPTIONS.map(o => (
                <SelectItem key={o} value={o} className="capitalize">{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isComplete && <JobBadge status={j.status} />}
        </div>
      </div>
      <Textarea
        className="bg-white/[0.04] border-white/10 text-[12px] resize-none min-h-14 placeholder:text-zinc-500"
        placeholder="Loose ends — incomplete work, punch list items, notes…"
        value={looseEnds}
        onClick={e => e.stopPropagation()}
        onChange={e => j._docId && updateJob(j._docId, { [`subsLooseEnds.${j.trade}`]: e.target.value })}
      />
    </li>
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

// ── Materials helpers ─────────────────────────────────────────────────────────

const MAT_UNITS = ['ea', 'roll', 'stick', 'box', 'bag', 'pallet', 'ft', 'lf']

function normalizeMatStatus(s) {
  if (!s) return 'Ordered'
  const map = { 'delivered': 'Delivered', 'in-transit': 'In Transit', 'ordered': 'Ordered', 'pending': 'Ordered' }
  return map[s] || s
}

const MAT_STATUS_TONE = {
  'Ordered':    'info',
  'In Transit': 'warning',
  'Delivered':  'success',
  'At Job Site':'success',
  'Used':       'mute',
  'Cancelled':  'mute',
}

const MAT_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'urgent',    label: 'Urgent' },
  { id: 'blocking',  label: 'Blocking' },
  { id: 'needed',    label: 'Needed' },
  { id: 'ordered',   label: 'Ordered' },
  { id: 'delivered', label: 'Delivered' },
]

const matName    = (m) => m.name || m.item || '—'
const matJobId   = (m) => m.jobId || m.job || ''
const matOrdered = (m) => m.dateOrdered || m.eta || ''

function matDaysUntilNeeded(m) {
  if (!m.dateNeeded) return null
  const d = new Date(m.dateNeeded)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((d.getTime() - today.getTime()) / 86400000)
}

function matIsOpen(m) {
  const s = normalizeMatStatus(m.status)
  return !['Delivered', 'At Job Site', 'Used', 'Cancelled'].includes(s)
}

function matIsOverdue(m) {
  if (!matIsOpen(m)) return false
  const days = matDaysUntilNeeded(m)
  return days !== null && days < 0
}

function matIsBlocking(m) {
  if (!matIsOpen(m)) return false
  const days = matDaysUntilNeeded(m)
  return days !== null && days <= 7
}

function matIsRecent(m) {
  const ts = m.createdAt
  if (!ts) return false
  const ms = ts.seconds ? ts.seconds * 1000
           : typeof ts === 'string' ? Date.parse(ts) : null
  if (!ms || isNaN(ms)) return false
  return (Date.now() - ms) <= 86400000 // last 24 hours
}

function matNextAction(m) {
  const s = normalizeMatStatus(m.status)
  if (s === 'Cancelled')   return 'Order cancelled'
  if (s === 'Used')        return 'Used on job'
  if (s === 'At Job Site') return 'On site — ready for install'
  if (s === 'Delivered')   return 'Ready for pickup'
  if (matIsOverdue(m))     return 'Follow up today — overdue'
  if (s === 'In Transit')  return 'Track delivery — in transit'
  const days = matDaysUntilNeeded(m)
  if (s === 'Ordered' && days !== null && days <= 7) return 'Confirm with supplier'
  if (s === 'Ordered')     return 'Waiting on supplier'
  return 'Continue tracking'
}

function matMatchesFilter(m, filter) {
  if (filter === 'all')       return true
  if (filter === 'urgent')    return matIsOverdue(m)
  if (filter === 'blocking')  return matIsBlocking(m)
  if (filter === 'needed')    return matIsOpen(m)
  if (filter === 'ordered')   return normalizeMatStatus(m.status) === 'Ordered'
  if (filter === 'delivered') {
    const s = normalizeMatStatus(m.status)
    return s === 'Delivered' || s === 'At Job Site'
  }
  return true
}

function fmtMatDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const MAT_FORM_INITIAL = {
  name: '', qty: 1, unit: 'ea', jobId: '',
  status: 'Ordered', vendor: '', dateOrdered: '', dateNeeded: '', notes: '',
}

// ── Materials tab ────────────────────────────────────────────────────────────

function Materials() {
  const { jobs = [], materials: MATERIALS = [] } = useData()
  const { history: HISTORY = [] } = useHistory()
  const [filter, setFilter]               = useState('all')
  const [filterJob, setFilterJob]         = useState('all')
  const [showForm, setShowForm]           = useState(false)
  const [editId, setEditId]               = useState(null)
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [form, setForm]                   = useState(MAT_FORM_INITIAL)
  const [saving, setSaving]               = useState(false)

  // ── Derived ────────────────────────────────────────────────────────────────

  const enriched = useMemo(() => MATERIALS.map(m => ({
    m,
    status:    normalizeMatStatus(m.status),
    overdue:   matIsOverdue(m),
    blocking:  matIsBlocking(m),
    open:      matIsOpen(m),
    daysUntil: matDaysUntilNeeded(m),
    recent:    matIsRecent(m),
  })), [MATERIALS])

  // KPI counts — derived from full set, not the filtered list.
  const kpis = useMemo(() => {
    const open       = enriched.filter(e => e.open).length
    const urgent     = enriched.filter(e => e.overdue).length
    const blockJobs  = new Set(enriched.filter(e => e.open).map(e => matJobId(e.m)).filter(Boolean)).size
    const delivered  = enriched.filter(e => ['Delivered', 'At Job Site'].includes(e.status)).length
    const recent     = enriched.filter(e => e.recent).length
    return { open, urgent, blockJobs, delivered, recent }
  }, [enriched])

  // Chip counts (reflect what would show under each chip BEFORE the job filter).
  const chipCounts = useMemo(() => {
    const out = {}
    MAT_FILTERS.forEach(f => { out[f.id] = enriched.filter(e => matMatchesFilter(e.m, f.id)).length })
    return out
  }, [enriched])

  // Apply filter + job, then sort: overdue first, then blocking, then open
  // by closest dateNeeded, then everything else by recency.
  const visible = useMemo(() => {
    return enriched
      .filter(e => matMatchesFilter(e.m, filter))
      .filter(e => filterJob === 'all' || matJobId(e.m) === filterJob)
      .slice()
      .sort((a, b) => {
        if (a.overdue !== b.overdue)   return a.overdue ? -1 : 1
        if (a.blocking !== b.blocking) return a.blocking ? -1 : 1
        if (a.open !== b.open)         return a.open ? -1 : 1
        const aDays = a.daysUntil ?? Infinity
        const bDays = b.daysUntil ?? Infinity
        if (aDays !== bDays) return aDays - bDays
        const aTs = a.m.createdAt?.seconds ?? 0
        const bTs = b.m.createdAt?.seconds ?? 0
        return bTs - aTs
      })
  }, [enriched, filter, filterJob])

  const filterChips = MAT_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || filterJob !== 'all'

  // ── Mutations (preserved verbatim from prior implementation) ───────────────

  const handleStatusChange = async (docId, newStatus) => {
    const m = MATERIALS.find(x => x._docId === docId)
    if (!m) return
    const oldStatus = normalizeMatStatus(m.status)
    await updateMaterial(docId, { status: newStatus })
    await addHistory({
      materialDocId: docId,
      materialName:  matName(m),
      jobId:         matJobId(m),
      fromStatus:    oldStatus,
      toStatus:      newStatus,
      type:          'status_change',
    })
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const job = jobs.find(j => j.id === form.jobId)
    const data = {
      name:        form.name.trim(),
      item:        form.name.trim(),
      qty:         Number(form.qty) || 1,
      unit:        form.unit,
      jobId:       form.jobId,
      job:         form.jobId,
      jobName:     job?.client || '',
      status:      form.status,
      vendor:      form.vendor.trim(),
      dateOrdered: form.dateOrdered,
      dateNeeded:  form.dateNeeded,
      notes:       form.notes.trim(),
      cost:        0,
    }
    if (editId) {
      await updateMaterial(editId, data)
      await addHistory({ materialDocId: editId, materialName: data.name, jobId: data.jobId, type: 'edited' })
    } else {
      await addMaterial(data)
    }
    setForm(MAT_FORM_INITIAL)
    setShowForm(false)
    setEditId(null)
    setSaving(false)
  }

  const openRequest = () => {
    setForm(MAT_FORM_INITIAL)
    setEditId(null)
    setShowForm(true)
  }

  const openEdit = (m) => {
    setForm({
      name:        matName(m),
      qty:         m.qty || 1,
      unit:        m.unit || 'ea',
      jobId:       matJobId(m),
      status:      normalizeMatStatus(m.status),
      vendor:      m.vendor || '',
      dateOrdered: matOrdered(m),
      dateNeeded:  m.dateNeeded || '',
      notes:       m.notes || '',
    })
    setEditId(m._docId)
    setShowForm(true)
  }

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(MAT_FORM_INITIAL) }

  const matHistory = (docId) => HISTORY.filter(h => h.materialDocId === docId)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Materials"
        title="Materials control"
        subtitle="Order, track, and confirm everything the field needs to keep work moving."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.open} open</span>
            {kpis.urgent > 0 && (
              <span className="text-red-300">{kpis.urgent} overdue</span>
            )}
          </>
        }
        actions={
          <button
            type="button"
            onClick={openRequest}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
            style={{ backgroundColor: O }}
          >
            <PlusIcon size={13} /> Request material
          </button>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Materials pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Open Requests"
          value={kpis.open}
          Icon={PackageIcon}
          emphasis={kpis.open > 0 ? 'default' : 'success'}
          sub={kpis.open > 0 ? 'Ordered or in transit' : 'Nothing pending'}
        />
        <MetricTile
          label="Urgent"
          value={kpis.urgent}
          Icon={TriangleAlertIcon}
          emphasis={kpis.urgent > 0 ? 'critical' : 'success'}
          sub={kpis.urgent > 0 ? 'Past needed-by date' : 'No overdue items'}
        />
        <MetricTile
          label="Blocking Jobs"
          value={kpis.blockJobs}
          Icon={HardHatIcon}
          emphasis={kpis.blockJobs > 0 ? 'warning' : 'success'}
          sub={kpis.blockJobs > 0 ? 'Jobs awaiting materials' : 'No materials blocking work'}
        />
        <MetricTile
          label="Delivered / Ready"
          value={kpis.delivered}
          Icon={CheckCircleIcon}
          emphasis={kpis.delivered > 0 ? 'success' : 'mute'}
          sub={kpis.delivered > 0 ? 'On site or delivered' : 'No deliveries logged'}
        />
        <MetricTile
          label="Recent Updates"
          value={kpis.recent}
          Icon={TruckIcon}
          emphasis={kpis.recent > 0 ? 'default' : 'mute'}
          sub="Last 24 hours"
        />
      </section>

      {/* Filters — chips + job select */}
      <FilterBar
        chips={filterChips}
        trailing={
          <>
            <select
              value={filterJob}
              onChange={e => setFilterJob(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[220px]"
              aria-label="Filter by job"
            >
              <option value="all">All jobs</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} — {j.client || j.name || ''}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setFilterJob('all') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Add / Edit panel — toggles open from the page header action */}
      {showForm && (
        <MaterialForm
          form={form}
          setForm={setForm}
          jobs={jobs}
          editing={!!editId}
          saving={saving}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      )}

      {/* Materials queue */}
      <DataPanel
        title="Materials Queue"
        description={
          visible.length === 0
            ? 'No materials match the current filters.'
            : `${visible.length} of ${enriched.length} item${enriched.length === 1 ? '' : 's'}`
        }
        Icon={PackageIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <MaterialsEmptyState filter={filter} hasJobFilter={filterJob !== 'all'} onRequest={openRequest} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(({ m, status, overdue, daysUntil }) => {
              const docKey = m._docId || m.id
              const hist = matHistory(m._docId)
              const showHist = expandedHistory === docKey
              return (
                <li key={docKey}>
                  <MaterialCard
                    m={m}
                    status={status}
                    overdue={overdue}
                    daysUntil={daysUntil}
                    history={hist}
                    showHistory={showHist}
                    onToggleHistory={() => setExpandedHistory(showHist ? null : docKey)}
                    onEdit={() => openEdit(m)}
                    onStatusChange={handleStatusChange}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function MaterialsEmptyState({ filter, hasJobFilter, onRequest }) {
  if (filter === 'urgent')    return <AllClearState title="No urgent materials" description="Nothing is past its needed-by date." />
  if (filter === 'blocking')  return <AllClearState title="No materials blocking work" description="No open items needed within 7 days." />
  if (filter === 'needed')    return <AllClearState title="Nothing needed" description="Every active material has been delivered or used." />
  if (filter === 'ordered')   return <EmptyState   title="No materials in 'Ordered' status" description="Items waiting on a supplier will appear here." />
  if (filter === 'delivered') return <EmptyState   title="No deliveries yet" description="Items marked Delivered or At Job Site will appear here." />
  if (hasJobFilter)           return <EmptyState   title="No materials for that job" description="Try clearing the job filter or request a new material." />
  return (
    <EmptyState
      Icon={PackageIcon}
      title="No materials yet"
      description="Track every material the field is waiting on. Start with the first request."
      action={
        <button
          type="button"
          onClick={onRequest}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
          style={{ backgroundColor: O }}
        >
          <PlusIcon size={13} /> Request material
        </button>
      }
    />
  )
}

function MaterialCard({
  m, status, overdue, daysUntil,
  history, showHistory, onToggleHistory,
  onEdit, onStatusChange,
}) {
  const tone = MAT_STATUS_TONE[status] || 'mute'
  const railColor = overdue
    ? '#ef4444'
    : (MAT_STATUS_COLOR[status] || '#6b7280')
  const action = matNextAction(m)
  const orderedDate = matOrdered(m)
  const neededDate  = m.dateNeeded
  const jobId       = matJobId(m)

  // Plain-English needed-date helper.
  const neededLabel = (() => {
    if (!neededDate) return null
    const fmt = fmtMatDate(neededDate)
    if (overdue && daysUntil !== null) return `${Math.abs(daysUntil)}d overdue`
    if (daysUntil === 0)               return 'Needed today'
    if (daysUntil === 1)               return 'Needed tomorrow'
    if (daysUntil !== null && daysUntil <= 7) return `Due in ${daysUntil}d`
    return `Needed ${fmt}`
  })()

  const neededColor =
    overdue ? '#ef4444' :
    (daysUntil !== null && daysUntil <= 7) ? '#eab308' : '#9ca3af'

  return (
    <div
      className="px-4 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-white/[0.015]"
      style={{ borderLeft: `3px solid ${railColor}` }}
    >
      {/* Header row — name, job pill, urgency tag */}
      <div className="flex items-start gap-2 mb-1.5 flex-wrap">
        {jobId && (
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {jobId}
          </span>
        )}
        <span className="text-sm font-semibold text-white truncate min-w-0 flex-1">
          {matName(m)}
        </span>
        {overdue && (
          <Pill tone="critical" size="xs" Icon={AlertTriangleIcon}>
            Overdue
          </Pill>
        )}
      </div>

      {/* Meta line — qty / vendor / dates / notes */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 mb-2">
        <span className="font-semibold text-zinc-300 tabular-nums">
          {m.qty || 0} {m.unit || 'ea'}
        </span>
        {m.vendor && (
          <span className="inline-flex items-center gap-1">
            <TruckIcon size={11} /> {m.vendor}
          </span>
        )}
        {orderedDate && (
          <span>Ordered {fmtMatDate(orderedDate)}</span>
        )}
        {neededLabel && (
          <span className="font-semibold" style={{ color: neededColor }}>
            {neededLabel}
          </span>
        )}
      </div>

      {m.notes && (
        <p className="text-[11px] text-zinc-300 italic mb-2 leading-snug truncate" title={m.notes}>
          {m.notes}
        </p>
      )}

      {/* Action / status row */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0">Next</span>
          <p
            className="text-[12px] font-semibold leading-snug truncate"
            style={{ color: railColor }}
            title={action}
          >
            {action}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <MatStatusBadge status={status} docId={m._docId} onUpdate={onStatusChange} />
          <button
            type="button"
            onClick={onEdit}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            title="Edit material"
            aria-label="Edit material"
          >
            <PencilIcon size={13} />
          </button>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onToggleHistory}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              title={showHistory ? 'Hide history' : 'View history'}
              aria-label={showHistory ? 'Hide history' : 'View history'}
              aria-expanded={showHistory}
            >
              <ActivityIcon size={13} />
            </button>
          )}
        </div>

        {/* Tone-only Pill — purely visual, gives a quick read of the current status */}
        <Pill tone={tone} size="xs" className="hidden sm:inline-flex">{status}</Pill>
      </div>

      {/* History drawer */}
      {showHistory && history.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">History</p>
          <ul className="space-y-1.5">
            {history.slice(0, 8).map(h => (
              <MaterialHistoryRow key={h._docId} entry={h} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MaterialHistoryRow({ entry }) {
  const ts = entry.createdAt?.toDate
    ? entry.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'
  return (
    <li className="flex items-start gap-2 text-[11px] text-zinc-400">
      <span className="w-16 shrink-0 text-zinc-500">{ts}</span>
      {entry.type === 'status_change' ? (
        <span className="min-w-0">
          <span style={{ color: MAT_STATUS_COLOR[entry.fromStatus] || '#9ca3af' }}>
            {entry.fromStatus || '—'}
          </span>
          <span className="text-zinc-500 mx-1">to</span>
          <span style={{ color: MAT_STATUS_COLOR[entry.toStatus] || '#9ca3af' }}>
            {entry.toStatus || '—'}
          </span>
        </span>
      ) : (
        <span className="capitalize">{entry.type?.replace(/_/g, ' ') || 'updated'}</span>
      )}
    </li>
  )
}

function MaterialForm({ form, setForm, jobs, editing, saving, onSave, onCancel }) {
  return (
    <DataPanel
      title={editing ? 'Edit material' : 'Request material'}
      description={editing
        ? 'Update the material details and save changes.'
        : 'Capture what the field needs. Office sees the request immediately.'}
      Icon={PlusIcon}
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <FormFieldLabel>Item name *</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500"
            placeholder="e.g. 200A Main Panel — Square D"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Qty</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white"
            type="number"
            min="1"
            value={form.qty}
            onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Unit</FormFieldLabel>
          <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAT_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FormFieldLabel>Job</FormFieldLabel>
          <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 w-full">
              <SelectValue placeholder="Select job" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map(j => (
                <SelectItem key={j.id} value={j.id}>
                  {j.id} — {j.client || j.name || ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FormFieldLabel>Status</FormFieldLabel>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FormFieldLabel>Vendor</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500"
            placeholder="Graybar, Ferguson…"
            value={form.vendor}
            onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Date ordered</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white"
            type="date"
            value={form.dateOrdered}
            onChange={e => setForm(f => ({ ...f, dateOrdered: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Date needed</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white"
            type="date"
            value={form.dateNeeded}
            onChange={e => setForm(f => ({ ...f, dateNeeded: e.target.value }))}
          />
        </div>
        <div className="md:col-span-2">
          <FormFieldLabel>Notes</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500"
            placeholder="Optional — sub assignments, location on site, etc."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ backgroundColor: O }}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Submit request'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
        >
          Cancel
        </button>
        {!editing && form.name.trim() && (
          <span className="text-[11px] text-zinc-400 ml-auto">
            Material request received once you submit.
          </span>
        )}
      </div>
    </DataPanel>
  )
}

function FormFieldLabel({ children }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 block mb-1.5">
      {children}
    </span>
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
                <span><span className="" style={{ color: O }}>{j.id}</span> — {j.address}</span>
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

const NOTIF_TYPE_META = {
  error:   { tone: 'critical', label: 'Error',   Icon: AlertCircleIcon,   color: '#ef4444' },
  warn:    { tone: 'warning',  label: 'Warning', Icon: AlertTriangleIcon, color: '#eab308' },
  info:    { tone: 'info',     label: 'Update',  Icon: InfoIcon,          color: '#3b82f6' },
  success: { tone: 'success',  label: 'Done',    Icon: CheckCircleIcon,   color: '#22c55e' },
}

const NOTIF_FILTERS = [
  { id: 'all',           label: 'All' },
  { id: 'unread',        label: 'Unread' },
  { id: 'action-needed', label: 'Action needed' },
  { id: 'billing',       label: 'Billing' },
  { id: 'change-orders', label: 'Change orders' },
  { id: 'inspections',   label: 'Inspections' },
  { id: 'system',        label: 'System' },
  { id: 'read',          label: 'Read' },
]

const NOTIF_CATEGORY_LABEL = {
  billing:         'Billing update',
  'change-orders': 'Change order update',
  inspections:     'Inspection update',
  system:          'System update',
}

const NOTIF_CATEGORY_ICON = {
  billing:         DollarSignIcon,
  'change-orders': FilePenLineIcon,
  inspections:     BadgeCheckIcon,
  system:          InfoIcon,
}

// Derive an operational bucket from the notification message + type. There is
// no `category` field on the document — this is pure derivation, no schema
// change. Order matters: billing is checked before change-orders so that a
// "CO invoiced" message reads as billing, while a "CO approved" message reads
// as a change-order update.
function notifCategory(n) {
  const m = (n.msg || '').toLowerCase()
  if (/(invoice|bill\b|collection|outstanding|paid|payment)/.test(m)) return 'billing'
  if (/(change order|\bco-|extras|approved|rejected|revision)/.test(m))  return 'change-orders'
  if (/(inspection|passed|failed|rough[- ]?in|trim|final)/.test(m))      return 'inspections'
  return 'system'
}

function notifMatchesFilter(n, filter) {
  if (filter === 'all')           return true
  if (filter === 'unread')        return !n.read
  if (filter === 'read')          return !!n.read
  if (filter === 'action-needed') return !n.read && (n.type === 'error' || n.type === 'warn')
  if (filter === 'billing')       return notifCategory(n) === 'billing'
  if (filter === 'change-orders') return notifCategory(n) === 'change-orders'
  if (filter === 'inspections')   return notifCategory(n) === 'inspections'
  if (filter === 'system')        return notifCategory(n) === 'system'
  return true
}

// Firestore Timestamp ({ seconds }), ISO string, or undefined — normalised.
function notifTimestampMs(n) {
  const v = n.createdAt
  if (!v) return null
  if (v.seconds) return v.seconds * 1000
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return isNaN(ms) ? null : ms
  }
  return null
}

function fmtNotifTime(n) {
  const ms = notifTimestampMs(n)
  if (ms === null) return n.time || ''
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function notifAgeLabel(n) {
  const ms = notifTimestampMs(n)
  if (ms === null) return ''
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d === 1)  return '1d ago'
  return `${d}d ago`
}

function notifIsWithinHours(n, hours) {
  const ms = notifTimestampMs(n)
  if (ms === null) return false
  return (Date.now() - ms) / 3600000 <= hours
}

function Notifications() {
  const { notifs = [] } = useData()
  const [filter, setFilter] = useState('all')

  // Live = not dismissed. Dismiss is the user's "clear" gesture; archived
  // notifications drop out of view (matches modern notification-center UX).
  const live = useMemo(() => notifs.filter(n => !n.dismissed), [notifs])

  // KPI counts — derived from `live`, NOT the filtered list.
  const kpis = useMemo(() => {
    const unread       = live.filter(n => !n.read).length
    const actionNeeded = live.filter(n => !n.read && (n.type === 'error' || n.type === 'warn')).length
    const recent       = live.filter(n => notifIsWithinHours(n, 24)).length
    const critical     = live.filter(n => n.type === 'error').length
    return { unread, actionNeeded, recent, critical, total: live.length }
  }, [live])

  // Chip counts (reflect what would show under each chip).
  const chipCounts = useMemo(() => {
    const out = {}
    NOTIF_FILTERS.forEach(f => { out[f.id] = live.filter(n => notifMatchesFilter(n, f.id)).length })
    return out
  }, [live])

  // Visible list — filter + sort: unread first, then newest first within each.
  const visible = useMemo(() => {
    return live
      .filter(n => notifMatchesFilter(n, filter))
      .slice()
      .sort((a, b) => {
        if (!!a.read !== !!b.read) return a.read ? 1 : -1
        return (notifTimestampMs(b) ?? 0) - (notifTimestampMs(a) ?? 0)
      })
  }, [live, filter])

  // Lifecycle mutations — preserved verbatim from prior implementation.
  const markRead = (n) => {
    if (n.read || !n._docId) return
    updateNotification(n._docId, { read: true })
  }
  const dismiss = (n) => {
    if (!n._docId) return
    updateNotification(n._docId, { dismissed: true, read: true })
  }
  const markAll = () => {
    live.filter(n => !n.read && n._docId).forEach(n => updateNotification(n._docId, { read: true }))
  }

  const filterChips = NOTIF_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Notification center"
        subtitle="Recent activity across active jobs — read, action, or clear from the queue."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }}
              />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{kpis.total} live</span>
            {kpis.unread > 0 && <span>{kpis.unread} unread</span>}
            {kpis.actionNeeded > 0 && (
              <span className="text-amber-300">{kpis.actionNeeded} need attention</span>
            )}
          </>
        }
        actions={
          kpis.unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              <CheckIcon size={13} /> Mark all read
            </button>
          )
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Notification pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Unread"
          value={kpis.unread}
          Icon={BellIcon}
          emphasis={kpis.unread > 0 ? 'warning' : 'success'}
          sub={kpis.unread > 0 ? 'Review and clear' : 'All caught up'}
        />
        <MetricTile
          label="Action Needed"
          value={kpis.actionNeeded}
          Icon={TriangleAlertIcon}
          emphasis={kpis.actionNeeded > 0 ? 'critical' : 'success'}
          sub={kpis.actionNeeded > 0 ? 'Warning + error' : 'Nothing flagged'}
        />
        <MetricTile
          label="Recent Updates"
          value={kpis.recent}
          Icon={ActivityIcon}
          emphasis={kpis.recent > 0 ? 'default' : 'mute'}
          sub="Last 24 hours"
        />
        <MetricTile
          label="Critical"
          value={kpis.critical}
          Icon={AlertCircleIcon}
          emphasis={kpis.critical > 0 ? 'critical' : 'success'}
          sub={kpis.critical > 0 ? 'System errors' : 'No errors'}
        />
        <MetricTile
          label="Total Live"
          value={kpis.total}
          Icon={ClipboardListIcon}
          emphasis={kpis.total > 0 ? 'default' : 'success'}
          sub={`${notifs.length} ever`}
        />
      </section>

      {/* Filters */}
      <FilterBar
        chips={filterChips}
        trailing={filter !== 'all' && (
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
          >
            Clear
          </button>
        )}
      />

      {/* Notification queue */}
      <DataPanel
        title="Recent activity"
        description={
          visible.length === 0
            ? 'No notifications match the current filter.'
            : `${visible.length} of ${live.length} shown`
        }
        Icon={BellIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <NotificationsEmptyState filter={filter} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(n => (
              <li key={n._docId || n.id || n.msg}>
                <NotificationCard n={n} onRead={markRead} onDismiss={dismiss} />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function NotificationsEmptyState({ filter }) {
  if (filter === 'unread')        return <AllClearState title="All caught up" description="No unread notifications." />
  if (filter === 'action-needed') return <AllClearState title="Nothing needs attention" description="No warning or error notifications outstanding." />
  if (filter === 'billing')       return <EmptyState   title="No billing notifications" description="Billing updates will appear here when posted." />
  if (filter === 'change-orders') return <EmptyState   title="No change-order notifications" description="CO approvals and revisions land here." />
  if (filter === 'inspections')   return <EmptyState   title="No inspection notifications" description="Inspection results and rework alerts land here." />
  if (filter === 'system')        return <EmptyState   title="No system notifications" description="System updates and errors land here." />
  if (filter === 'read')          return <EmptyState   title="Nothing read yet" description="Notifications you mark read will move here." />
  return <AllClearState title="No notifications" description="You're all caught up." />
}

function NotificationCard({ n, onRead, onDismiss }) {
  const meta = NOTIF_TYPE_META[n.type] || NOTIF_TYPE_META.info
  const cat = notifCategory(n)
  const CatIcon = NOTIF_CATEGORY_ICON[cat] || InfoIcon
  const TypeIcon = meta.Icon

  // Outer is a clickable div (not <button>) so we can nest the <button>
  // dismiss action without invalid HTML. Keyboard support via role/tabIndex.
  const handleKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) {
      e.preventDefault()
      onRead(n)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { if (!e.target.closest('button')) onRead(n) }}
      onKeyDown={handleKey}
      className={`flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4 cursor-pointer transition-colors hover:bg-white/[0.025] focus:outline-none focus:bg-white/[0.04] ${n.read ? 'opacity-60' : ''}`}
      style={{ borderLeft: `3px solid ${n.read ? 'transparent' : meta.color}` }}
      aria-label={n.read ? `Notification: ${n.msg}` : `Unread notification: ${n.msg}`}
    >
      {/* Type icon tile */}
      <div
        className="shrink-0 mt-0.5 flex items-center justify-center rounded-lg"
        style={{ width: 32, height: 32, backgroundColor: meta.color + '22', color: meta.color }}
      >
        <TypeIcon size={16} strokeWidth={2} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <Pill tone={meta.tone} size="xs">{meta.label}</Pill>
          <Pill tone="neutral" size="xs" Icon={CatIcon}>{NOTIF_CATEGORY_LABEL[cat]}</Pill>
          <span className="text-[10px] text-zinc-500">·</span>
          <span className="text-[10px] text-zinc-400">{notifAgeLabel(n)}</span>
        </div>
        <p className={`text-sm leading-snug ${n.read ? 'text-zinc-300' : 'font-semibold text-white'}`}>
          {n.msg}
        </p>
        {fmtNotifTime(n) && (
          <p className="text-[11px] text-zinc-500 mt-0.5">{fmtNotifTime(n)}</p>
        )}
      </div>

      {/* Right column: unread dot + dismiss */}
      <div className="flex items-start gap-1.5 shrink-0">
        {!n.read && (
          <span
            className="w-2 h-2 rounded-full mt-2"
            style={{ backgroundColor: O }}
            aria-label="Unread"
          />
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(n) }}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          title="Clear notification"
          aria-label="Clear notification"
        >
          <XIcon size={14} />
        </button>
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
                  <span className="text-sm font-bold" style={{ color: O }}>{c.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{c.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {c.fields.map(f => (
                    <span key={f} className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">{f}</span>
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
                  <span className="text-sm font-bold" style={{ color: O }}>{f.name}</span>
                  <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CloudIcon size={10} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{f.trigger}</span>
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
          <pre className="text-xs text-muted-foreground overflow-x-auto p-4 rounded-xl bg-black/40 border border-white/5 whitespace-pre leading-relaxed">
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
