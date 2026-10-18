import { ZapIcon, WrenchIcon, HammerIcon } from 'lucide-react'
import { TRADE, PHASE, statusLabel, statusColor } from './status'

// Inspection vocabulary + per-trade metadata. Pure data + pure helpers, no
// React or Firestore dependency. Moved out of src/App.jsx in Phase 18. The words
// and colors of a status are in status.js; this file adds what only inspections
// need: the order a person picks them in, each trade's icon and its phases.

export const INSP_STATUSES = ['pending', 'scheduled', 'passed', 'failed', 'blocked', 'n/a']

export const TRADE_META = {
  electrical: { label: statusLabel(TRADE, 'electrical'), color: statusColor(TRADE, 'electrical'), Icon: ZapIcon,    phases: ['roughIn', 'trim', 'final'] },
  plumbing:   { label: statusLabel(TRADE, 'plumbing'),   color: statusColor(TRADE, 'plumbing'),   Icon: WrenchIcon, phases: ['roughIn', 'final'] },
  hvac:       { label: statusLabel(TRADE, 'hvac'),       color: statusColor(TRADE, 'hvac'),       Icon: HammerIcon, phases: ['roughIn', 'final'] },
}

// The stored phase fields (roughIn, trim, final) by the words of the phase.
export const PHASE_LABEL = {
  roughIn: statusLabel(PHASE, 'rough-in'),
  trim:    statusLabel(PHASE, 'trim'),
  final:   statusLabel(PHASE, 'final'),
}
