import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, secondaryAuth, db, functions } from './firebase'
import { httpsCallable } from 'firebase/functions'
import { DataProvider, useData } from './DataContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ShieldIcon, ShieldCheckIcon, AlertTriangleIcon, CheckCircleIcon, Building2Icon, BanIcon,
  DollarSignIcon, FileTextIcon, BellIcon,
  UsersIcon, PackageIcon, ClipboardIcon, MapPinIcon,
  ZapIcon, TruckIcon, CalendarIcon, ClockIcon, TrendingUpIcon,
  TargetIcon, StarIcon, LockIcon, LogOutIcon,
  ChevronRightIcon, ChevronLeftIcon, PlusIcon, XIcon, CheckIcon,
  AlertCircleIcon, InfoIcon, SearchIcon,
  DownloadIcon, PencilIcon, Trash2Icon, PhoneIcon, MailIcon,
  BarChart2Icon, ActivityIcon, SendIcon,
  MessageSquareIcon, FolderIcon,
  ArrowUpIcon, RefreshCwIcon,
  DatabaseIcon, CodeIcon, LayersIcon,
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
const ClientPortalComponent    = lazy(() => import('./components/ClientPortal'))
const ProjectFoldersComponent  = lazy(() => import('./components/ProjectFolders'))
const SubmitInboxComponent     = lazy(() => import('./components/SubmitInbox'))
const NotificationsComponent   = lazy(() => import('./components/Notifications'))
const MorningBriefingComponent = lazy(() => import('./components/MorningBriefing'))
const MaterialsComponent       = lazy(() => import('./components/Materials'))
const SubsComponent           = lazy(() => import('./components/Subs'))
const InspectionsComponent    = lazy(() => import('./components/Inspections'))
const JobStatusComponent      = lazy(() => import('./components/JobStatus'))
const CrewReportComponent      = lazy(() => import('./components/CrewReport'))
const ChangeOrdersComponent    = lazy(() => import('./components/ChangeOrders'))
const SettingsPageComponent    = lazy(() => import('./components/SettingsPage'))
const AnalyticsComponent       = lazy(() => import('./components/Analytics'))
const TeamLeaderboardComponent = lazy(() => import('./components/TeamLeaderboard'))
const InvoiceAuditorComponent  = lazy(() => import('./components/InvoiceAuditor'))
// Phase 20 — Architecture + Permits extracted from this file.
const ArchitectureComponent    = lazy(() => import('./components/Architecture'))
const PermitsComponent         = lazy(() => import('./components/Permits'))
import WarRoomComponent from './components/WarRoom'
import CommandPalette from './components/CommandPalette'
import JobDetail from './components/JobDetail'
import OfflineBanner from './components/OfflineBanner'
const CalendarComponent = lazy(() => import('./components/Calendar'))
const ActivityComponent = lazy(() => import('./components/Activity'))
import PMDashboardComponent from './components/PMDashboard'
import AlertsPageComponent from './components/AlertsPage'
import BillingQueueComponent from './components/BillingQueue'
import ErrorBoundary from './components/ErrorBoundary'
import {
  PageHeader, MetricTile, DataPanel, Pill,
  EmptyState, AllClearState, FilterBar, PageSkeleton,
  // Phase 19 — primitives extracted from App.jsx
  ProgressBar, StatCard,
  InlineStatusSelect, InlinePhaseSelect,
  BillingStatusSelect, MatStatusBadge,
} from './components/shared'
// daysSince is defined locally in this file with identical semantics, so we
// Helpers and pure functions are imported by each extracted tab component;
// the only ones still referenced from App.jsx itself are inside the auth /
// shell / nav scaffolding.
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
      { id: 'command-center', label: 'Command Center',   Icon: GaugeIcon },
      { id: 'morning',        label: 'Morning Briefing', Icon: CalendarClockIcon },
      { id: 'war-room',       label: 'War Room',         Icon: RadarIcon },
      { id: 'pm-dashboard',   label: 'PM Dashboard',     Icon: UserRoundCogIcon },
      { id: 'alerts',         label: 'Alerts',           Icon: TriangleAlertIcon },
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
      { id: 'jobs',         label: 'Job Status',   Icon: HardHatIcon },
      { id: 'calendar',     label: 'Calendar',     Icon: CalendarClockIcon },
      { id: 'inspections',  label: 'Inspections',  Icon: BadgeCheckIcon },
      { id: 'daily-report', label: 'Daily Report', Icon: NotebookPenIcon },
      { id: 'materials',    label: 'Materials',    Icon: BoxesIcon },
      { id: 'permits',      label: 'Permits',      Icon: ClipboardSignatureIcon },
      { id: 'subs',         label: 'Subs',         Icon: UsersRoundIcon },
    ],
  },
  {
    heading: 'Workspace',
    items: [
      { id: 'folders',       label: 'Documents',     Icon: FolderOpenIcon },
      { id: 'submit',        label: 'Submit',        Icon: SendIcon },
      { id: 'notifications', label: 'Notifications', Icon: BellIcon },
      { id: 'activity',      label: 'Activity',      Icon: ActivityIcon },
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
  { id: 'calendar',      label: 'Calendar',    Icon: CalendarClockIcon },
  { id: 'morning',       label: 'Briefing',    Icon: CalendarClockIcon },
  { id: 'submit',        label: 'Submit',      Icon: SendIcon },
  { id: 'notifications', label: 'Notifs',      Icon: BellIcon },
  { id: 'folders',       label: 'Documents',   Icon: FolderOpenIcon },
  { id: 'materials',     label: 'Materials',   Icon: BoxesIcon },
  { id: 'permits',       label: 'Permits',     Icon: ClipboardSignatureIcon },
  { id: 'subs',          label: 'Subs',        Icon: UsersRoundIcon },
  { id: 'analytics',     label: 'Reports',     Icon: BarChart3Icon },
  { id: 'team',          label: 'Team',        Icon: TrophyIcon },
  { id: 'activity',      label: 'Activity',    Icon: ActivityIcon },
  { id: 'settings',      label: 'Settings',    Icon: SettingsIcon },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

// jobName moved to src/lib/jobs.js (Phase 18).
// BILLING_STATUSES, BILLING_STATUS_LABEL, BILLING_STATUS_COLOR moved to
// src/lib/billing.js (Phase 18).

// inspMeta, iMeta, statusMeta, sMeta moved to
// src/components/shared/legacy-badges.jsx (Phase 19) and re-exported here
// via the named imports at the top of this file.


const CREW_LIST = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']
const TODAY = new Date()
const _yd = new Date(TODAY); _yd.setDate(_yd.getDate() - 1)
const YESTERDAY_STR = _yd.toISOString().slice(0, 10)

// phaseLabel moved to src/lib/jobs.js (Phase 18).

// ── Reusable components ───────────────────────────────────────────────────────
//
// ProgressBar, StatCard, InspBadge, JobBadge, BillingStatusSelect,
// InlineStatusSelect, InlinePhaseSelect (and their JOB_STATUS_OPTIONS /
// PHASE_OPTIONS data) moved to src/components/shared/* (Phase 19) and
// re-imported via the named-imports block at the top of this file.
// The legacy local SectionHeader (used by Architecture + Permits) moved
// alongside those tabs in Phase 20 — see src/components/Architecture.jsx
// and src/components/Permits.jsx.

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


// ── Tab: Extras / COs ─────────────────────────────────────────────────────────

function Extras() {
  return <ChangeOrdersComponent />
}




// ── Tab: Permits ──────────────────────────────────────────────────────────────

function Permits() {
  return <PermitsComponent />
}

// ── Tab: Project Folders ──────────────────────────────────────────────────────

function ProjectFolders() {
  return <ProjectFoldersComponent />
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
  return <ArchitectureComponent />
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

function MainDashboard({ role = 'internal', tenantId = 'p2-core', onTenantChange, onLogout, onCreateUser, initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'command-center')
  const [collapsed, setCollapsed] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState(null)
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
    // Deep-link to a single job's full-detail view.
    const openJob = (e) => {
      const id = e?.detail?.id
      if (typeof id === 'string') { setSelectedJobId(id); setActiveTab('job-detail') }
    }
    window.addEventListener('p2:navigate', handler)
    window.addEventListener('p2:open-job', openJob)
    return () => {
      window.removeEventListener('p2:navigate', handler)
      window.removeEventListener('p2:open-job', openJob)
    }
  }, [])

  // Five filters over jobs + four over other collections, recomputed every
  // time anything in DataContext snapshots. Memoize on the actual inputs so
  // any unrelated render (e.g. modal open) doesn't re-run.
  const navCounts = useMemo(() => ({
    'command-center': (jobs || []).filter(j => {
      if (['complete', 'completed'].includes(j.status)) return false
      const insp = j.insp || {}
      const failed = Object.values(insp).some(t => Object.values(t || {}).some(s => s === 'failed'))
      const stale = ((new Date() - new Date(j.lastStatusChange || j.start)) / 86400000) >= 2
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
        Object.values(trade || {}).some(s => s === 'scheduled' || s === 'failed'),
      )
    }).length,
  }), [jobs, extras, notifs, subs, submits, agentAlerts])

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
    'morning':       wrap(<MorningBriefingComponent />),
    'jobs':          wrap(<JobStatusComponent />),
    'extras':        wrap(<Extras />),
    'inspections':   wrap(<InspectionsComponent />),
    'subs':          wrap(<SubsComponent />),
    'materials':     wrap(<MaterialsComponent />),
    'permits':       wrap(<Permits />),
    'folders':       wrap(<ProjectFolders />),
    'notifications': wrap(<NotificationsComponent />),
    'submit':        wrap(<Submit />),
    'architecture':  wrap(<Architecture />),
    'daily-report':  wrap(<CrewReport />),
    'analytics':     wrap(<AnalyticsComponent />),
    'team':           wrap(<TeamLeaderboardComponent />),
    'invoice-auditor': wrap(<Suspense fallback={<PageSkeleton />}><InvoiceAuditorComponent /></Suspense>),
    'settings':       wrap(<SettingsPageComponent onLogout={onLogout} />),
    'job-detail':     wrap(<JobDetail jobId={selectedJobId} onBack={() => setActiveTab('jobs')} />),
    'calendar':       wrap(<CalendarComponent />),
    'activity':       wrap(<ActivityComponent />),
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
      <OfflineBanner />
      <CommandPalette />
      <Suspense fallback={<PageSkeleton />}>
        <div key={activeTab} className="p2-page-enter">
          {TAB_COMPONENTS[activeTab]}
        </div>
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
      if (!r || cJobs === null) {
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
          if (snap.exists()) {
            const u = snap.data()
            r   = r   || u.role     || 'internal'
            tid = u.tenantId || tid
            dn  = u.displayName || dn
            cName = cName || u.clientName || u.displayName || ''
            if (cJobs === null) cJobs = Array.isArray(u.clientJobIds) ? u.clientJobIds : []
          } else if (!r) {
            r = 'internal'
          }
        } catch {
          if (!r) r = 'internal'
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
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse" style={{ backgroundColor: O }}>
            <ZapIcon size={18} color="#fff" />
          </div>
          <p className="text-muted-foreground text-sm">
            {oauthState === 'loading' ? `Connecting ${oauthProvider}…` : 'Loading…'}
          </p>
        </div>
      </div>
    )
  }

  if (oauthState === 'success' || (oauthState && oauthState.error)) {
    const ok = oauthState === 'success'
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
            {ok ? `${oauthProvider} connected successfully!` : oauthState.error}
          </p>
          {!ok && (
            <button
              className="text-xs text-muted-foreground underline hover:text-white"
              onClick={() => { setOauthState(null); setInitialTab('settings') }}
            >
              Back to Settings
            </button>
          )}
        </div>
      </div>
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
