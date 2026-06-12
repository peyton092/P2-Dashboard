import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { useStickyState } from './lib/useStickyState'
import { useData } from './DataContext'
import { PageSkeleton } from './components/shared'
import AppShell from './components/shell/AppShell'
import Sidebar from './components/shell/Sidebar'
import MobileNav from './components/shell/MobileNav'
import CommandPalette from './components/CommandPalette'
import ShortcutsHelp from './components/ShortcutsHelp'
import OfflineBanner from './components/OfflineBanner'
import ErrorBoundary from './components/ErrorBoundary'
import JobDetail from './components/JobDetail'
import WarRoomComponent from './components/WarRoom'
import PMDashboardComponent from './components/PMDashboard'
import AlertsPageComponent from './components/AlertsPage'
import BillingQueueComponent from './components/BillingQueue'
import { TENANTS, NAV_SECTIONS, MOBILE_PRIMARY, MOBILE_MORE } from './nav/navConfig'

// Tab screens — each route lazy-loads so the initial bundle stays small.
// Order mirrors the sidebar groupings in navConfig.js.
const CommandCenterComponent  = lazy(() => import('./components/CommandCenter'))
const MorningBriefingComponent = lazy(() => import('./components/MorningBriefing'))
const ProjectFoldersComponent  = lazy(() => import('./components/ProjectFolders'))
const SubmitInboxComponent     = lazy(() => import('./components/SubmitInbox'))
const NotificationsComponent   = lazy(() => import('./components/Notifications'))
const MaterialsComponent       = lazy(() => import('./components/Materials'))
const SubsComponent            = lazy(() => import('./components/Subs'))
const InspectionsComponent     = lazy(() => import('./components/Inspections'))
const JobStatusComponent       = lazy(() => import('./components/JobStatus'))
const CrewReportComponent      = lazy(() => import('./components/CrewReport'))
const ChangeOrdersComponent    = lazy(() => import('./components/ChangeOrders'))
const SettingsPageComponent    = lazy(() => import('./components/SettingsPage'))
const AnalyticsComponent       = lazy(() => import('./components/Analytics'))
const TeamLeaderboardComponent = lazy(() => import('./components/TeamLeaderboard'))
const InvoiceAuditorComponent  = lazy(() => import('./components/InvoiceAuditor'))
const ArchitectureComponent    = lazy(() => import('./components/Architecture'))
const PermitsComponent         = lazy(() => import('./components/Permits'))
const CalendarComponent        = lazy(() => import('./components/Calendar'))
const ActivityComponent        = lazy(() => import('./components/Activity'))

const O = '#F47920'

export default function MainDashboard({
  role = 'internal',
  tenantId = 'p2-core',
  onTenantChange,
  onLogout,
  onCreateUser,
  initialTab,
}) {
  // Persist the user's last-viewed tab so the next visit lands where they
  // left off. initialTab (set after an OAuth callback) takes precedence —
  // we want the user dropped back on Settings after a Quickbooks/CompanyCam
  // round-trip, not on whatever was open before.
  const [activeTab, setActiveTab] = useStickyState(
    'app.lastTab',
    initialTab || 'command-center',
    { crossTabSync: false },
  )
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab)
  }, [initialTab, setActiveTab])
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
    // setActiveTab is stable (useState/useStickyState setter); listeners
    // intentionally registered once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    'command-center':  wrap(<CommandCenterComponent />),
    'war-room':        wrap(<WarRoomComponent />),
    'pm-dashboard':    wrap(<PMDashboardComponent />),
    'alerts':          wrap(<AlertsPageComponent />),
    'billing-queue':   wrap(<BillingQueueComponent />),
    'morning':         wrap(<MorningBriefingComponent />),
    'jobs':            wrap(<JobStatusComponent />),
    'extras':          wrap(<ChangeOrdersComponent />),
    'inspections':     wrap(<InspectionsComponent />),
    'subs':            wrap(<SubsComponent />),
    'materials':       wrap(<MaterialsComponent />),
    'permits':         wrap(<PermitsComponent />),
    'folders':         wrap(<ProjectFoldersComponent />),
    'notifications':   wrap(<NotificationsComponent />),
    'submit':          wrap(<SubmitInboxComponent />),
    'architecture':    wrap(<ArchitectureComponent />),
    'daily-report':    wrap(<CrewReportComponent />),
    'analytics':       wrap(<AnalyticsComponent />),
    'team':            wrap(<TeamLeaderboardComponent />),
    'invoice-auditor': wrap(<Suspense fallback={<PageSkeleton />}><InvoiceAuditorComponent /></Suspense>),
    'settings':        wrap(<SettingsPageComponent onLogout={onLogout} />),
    'job-detail':      wrap(<JobDetail jobId={selectedJobId} onBack={() => setActiveTab('jobs')} />),
    'calendar':        wrap(<CalendarComponent />),
    'activity':        wrap(<ActivityComponent />),
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
      <ShortcutsHelp />
      <Suspense fallback={<PageSkeleton />}>
        <div key={activeTab} className="p2-page-enter">
          {TAB_COMPONENTS[activeTab]}
        </div>
      </Suspense>
    </AppShell>
  )
}
