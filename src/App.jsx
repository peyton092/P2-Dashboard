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
  createJob,
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
  InspBadge, JobBadge,
  InlineStatusSelect, InlinePhaseSelect,
  BillingStatusSelect, MatStatusBadge,
} from './components/shared'
// daysSince is defined locally in this file with identical semantics, so we
// don't re-import it from agent/scoring (would be a duplicate declaration).
import { classifyRisk, hasFailedInspection, isBillingReady } from './agent/scoring'
import { ZONES, getZoneId } from './agent/zones'

// Phase 18 — Domain helpers extracted from App.jsx into src/lib/.
// Pure data + pure functions. No behavior change.
import { BILLING_STATUSES, BILLING_STATUS_LABEL, BILLING_STATUS_COLOR } from './lib/billing'
import {
  jobName,
  JOB_FILTERS, JOB_FORM_INITIAL,
  isJobComplete, jobStaleness, jobMatchesFilter,
  jobNextAction, jobRiskMeta, fmtJobDate,
} from './lib/jobs'
import { exportToCsv } from './lib/exportCsv'
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

// ── Tab: Job Status ───────────────────────────────────────────────────────────

// JOB_FILTERS, JOB_FORM_INITIAL, isJobComplete, jobStaleness,
// jobMatchesFilter, jobNextAction, jobRiskMeta, fmtJobDate moved to
// src/lib/jobs.js (Phase 18).

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

  const exportVisibleCsv = () => {
    exportToCsv('p2-jobs', [
      { label: 'Job ID',    key: 'id' },
      { label: 'Name',      get: e => jobName(e.j) },
      { label: 'Client',    get: e => e.j.client || '' },
      { label: 'Address',   get: e => e.j.address || '' },
      { label: 'City',      get: e => e.j.city || '' },
      { label: 'PM',        get: e => e.j.pm || '' },
      { label: 'Status',    get: e => e.j.status || '' },
      { label: 'Phase',     get: e => e.j.phase || '' },
      { label: 'Progress',  get: e => `${e.j.progress ?? 0}%` },
      { label: 'Target',    get: e => e.j.target || '' },
      { label: 'Billing',   get: e => e.j.billingStatus || '' },
      { label: 'Permit #',  get: e => e.j.permitNumber || '' },
      { label: 'At Risk',   get: e => (e.risk?.level === 'critical' || e.risk?.level === 'warning' || e.failed) ? 'yes' : 'no' },
    ], visible)
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportVisibleCsv()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
            >
              <DownloadIcon size={13} /> Export CSV
            </button>
            <button
              type="button"
              onClick={() => { setShowNewJob(v => !v); if (!showNewJob) setJobForm(JOB_FORM_INITIAL) }}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
              style={{ backgroundColor: O }}
            >
              <PlusIcon size={13} /> New job
            </button>
          </div>
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
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="QBS-045" value={jobForm.id} onChange={e => setJobForm(f => ({ ...f, id: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Street address *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="123 Main St" value={jobForm.address} onChange={e => setJobForm(f => ({ ...f, address: e.target.value }))} />
            </JobFormField>
            <JobFormField label="City, state ZIP">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="Brentwood, TN 37027" value={jobForm.city} onChange={e => setJobForm(f => ({ ...f, city: e.target.value }))} />
            </JobFormField>
            <JobFormField label="Client *">
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="Client name" value={jobForm.client} onChange={e => setJobForm(f => ({ ...f, client: e.target.value }))} />
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
              <Input className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400" placeholder="2026012345" value={jobForm.permitNumber} onChange={e => setJobForm(f => ({ ...f, permitNumber: e.target.value }))} />
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
            {/* Header row — id pill, name (clickable → JobDetail), status select, phase select */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: job.id } })) }}
                title="Open job detail"
                className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0 hover:bg-white/[0.12] hover:text-white transition-colors"
              >
                {job.id}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: job.id } })) }}
                title="Open job detail"
                className="text-base font-bold text-white truncate min-w-0 text-left hover:underline underline-offset-4 decoration-white/30"
              >
                {jobName(job)}
              </button>
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
    <div className="border-t border-white/5 bg-white/[0.015]">
      <div className="px-4 py-4 sm:px-5 sm:py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
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
          <p className="text-[11px] text-zinc-400">No subs assigned</p>
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
          <p className="text-[11px] text-zinc-400">No permits on file</p>
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
      <div className="px-4 pb-4 sm:px-5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('p2:open-job', { detail: { id: job.id } }))}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white"
          style={{ backgroundColor: O }}
        >
          Open full view →
        </button>
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
    'jobs':          wrap(<JobStatus />),
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
