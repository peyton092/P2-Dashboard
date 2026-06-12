// Navigation configuration. Source of truth for tenant identity, desktop
// sidebar grouping, and mobile bottom-bar primary/overflow split. Importing
// the icon components here (rather than e.g. via string id lookup) keeps
// Vite's tree-shaking honest — only the icons we actually render ship.

import {
  GaugeIcon, RadarIcon, UserRoundCogIcon, TriangleAlertIcon,
  DollarSignIcon, FilePenLineIcon, ScanSearchIcon, HardHatIcon,
  CalendarClockIcon, BadgeCheckIcon, NotebookPenIcon, BoxesIcon,
  ClipboardSignatureIcon, UsersRoundIcon, FolderOpenIcon, SendIcon,
  BellIcon, ActivityIcon, BarChart3Icon, TrophyIcon, DatabaseIcon,
  SettingsIcon,
} from 'lucide-react'

export const TENANTS = [
  { id: 'p2-core', name: 'P2 Internal',          slug: 'p2'     },
  { id: 'qbs',     name: 'QBS Builder Portal',    slug: 'qbs'    },
  { id: 'vision',  name: 'Vision Building Group', slug: 'vision' },
]

// Desktop sidebar grouping. Each `id` must match a key in TAB_COMPONENTS
// inside MainDashboard.
export const NAV_SECTIONS = [
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
export const MOBILE_PRIMARY = [
  { id: 'command-center', label: 'Command',  Icon: GaugeIcon },
  { id: 'war-room',       label: 'War Room', Icon: RadarIcon },
  { id: 'billing-queue',  label: 'Billing',  Icon: DollarSignIcon },
  { id: 'jobs',           label: 'Jobs',     Icon: HardHatIcon },
]

export const MOBILE_MORE = [
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
