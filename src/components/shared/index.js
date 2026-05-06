export { PageHeader, SectionHeader } from './headers'
export { default as MetricTile } from './MetricTile'
export { default as DataPanel } from './DataPanel'
export {
  Pill,
  StatusBadge,
  InspectionBadge,
  BillingBadge,
  PriorityBadge,
} from './badges'
export {
  EmptyState,
  AllClearState,
  LoadingState,
  ErrorState,
} from './states'
export {
  ActionBar,
  FilterBar,
  ResponsiveTable,
  TableHeader,
  TableRow,
  TableCell,
  JobRow,
  JobCard,
} from './lists'

// Phase 19 — primitives extracted from src/App.jsx. Pure UI; behavior
// preserved exactly. The legacy InspBadge/JobBadge live alongside the
// modern Pill from `./badges`; new screens should prefer Pill.
export { ProgressBar } from './ProgressBar'
export { StatCard } from './StatCard'
export {
  inspMeta, iMeta, statusMeta, sMeta,
  InspBadge, JobBadge,
} from './legacy-badges'
export {
  InlineStatusSelect, InlinePhaseSelect,
  BillingStatusSelect, MatStatusBadge,
} from './inline-edits'
