import { createContext, useContext, useState, useEffect } from 'react'
import { collection, getDocs, writeBatch, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { useJobs, useAllExtras, useNotifications, useSubs, useMaterials, useSubmits, useDailyReports, useUrgentItems, useSettings, useAgentAlerts } from './hooks/useFirestore'

// ── Static fallback data (also used as seed) ──────────────────────────────────

const LAST_STATUS_CHANGES = {
  'QBS-001': '2026-04-12', 'QBS-002': '2026-04-21', 'QBS-003': '2026-04-08',
  'QBS-004': '2026-04-13', 'QBS-005': '2026-04-16', 'QBS-006': '2026-04-10',
  'QBS-007': '2026-04-17', 'QBS-008': '2026-04-14', 'QBS-009': '2026-04-16',
  'QBS-010': '2026-03-27', 'QBS-011': '2026-04-05', 'QBS-012': '2026-04-15',
  'QBS-013': '2026-03-28', 'QBS-014': '2026-04-11', 'QBS-015': '2026-04-10',
  'QBS-016': '2026-04-12', 'QBS-017': '2026-04-13', 'QBS-018': '2026-03-25',
  'QBS-019': '2026-04-15', 'QBS-020': '2026-04-12', 'QBS-021': '2026-04-08',
  'QBS-022': '2026-04-02', 'QBS-023': '2026-04-10', 'QBS-024': '2026-04-09',
  'QBS-025': '2026-02-03', 'QBS-026': '2026-04-11', 'QBS-027': '2026-03-20',
  'QBS-028': '2026-04-07', 'QBS-029': '2026-04-16', 'QBS-030': '2026-04-03',
  'QBS-031': '2026-04-14', 'QBS-032': '2026-03-30', 'QBS-033': '2026-04-13',
  'QBS-034': '2026-04-06', 'QBS-035': '2026-04-09', 'QBS-036': '2026-04-15',
  'QBS-037': '2026-04-11', 'QBS-038': '2026-04-13', 'QBS-039': '2026-04-12',
  'QBS-040': '2026-03-10', 'QBS-041': '2026-04-14', 'QBS-042': '2026-04-08',
  'QBS-043': '2026-04-11', 'QBS-044': '2026-04-21',
}

const OLD_PM_MAP = {
  'Mike Rodriguez': 'Blake Neblett',
  'Sarah Chen':     'Brendan Embry',
  'David Park':     'Jeb Brooks',
}

export const STATIC_JOBS = [
  // ── QBS-001 Austin — CORE: elec rough-in PASS 03/02 ──────────────────────────
  {
    id: 'QBS-001', name: 'Austin', address: '4812 Enclave Dr', city: 'Austin, TX 78746', county: 'Travis',
    client: 'Austin Residence', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Mike Rodriguez', lead: 'Jake Torres',
    start: '2025-01-10', target: '2025-05-15', extras: 0,
    invoiceNum: '3397', invoiceDate: '02/05/2026', qbsPM: 'Taylor Hensley',
    billingStatus: 'invoiced',
    permitNumber: '2026009763',
    subs: { electrical: 'Ventura', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-02', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-002 Boseman — CORE: elec rough-in PASS 04/21 ─────────────────────────
  {
    id: 'QBS-002', name: 'Boseman', address: '209 Gallatin St', city: 'Boseman, MT 59715', county: 'Gallatin',
    client: 'Boseman Residence', type: 'HVAC + Electrical Upgrade',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Luis Moreno',
    start: '2025-02-03', target: '2025-06-01', extras: 0,
    invoiceNum: '3466', invoiceDate: '03/26/2026', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2026026755',
    subs: { electrical: 'Mario', plumbing: null, hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: null, hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-21', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-003 Cantrell — CORE: rough-in PASS 03/27, SR PASS 04/03 ──────────────
  {
    id: 'QBS-003', name: 'Cantrell', address: '7731 Cantrell Rd', city: 'Little Rock, AR 72207', county: 'Pulaski',
    client: 'Cantrell Properties', type: 'Commercial MEP Buildout',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Mike Rodriguez', lead: 'Sam Delgado',
    start: '2025-02-18', target: '2025-07-30', extras: 0,
    invoiceNum: '3400', invoiceDate: '02/06/2026', qbsPM: 'Taylor Hensley',
    billingStatus: 'invoiced',
    permitNumber: '2026011466',
    subs: { electrical: 'Ventura', plumbing: 'Edgar', hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-27', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-004 Copes — CORE: elec rough-in PASS 02/02 ───────────────────────────
  {
    id: 'QBS-004', name: 'Copes', address: '1503 Copes Ln', city: 'Sugar Land, TX 77479', county: 'Fort Bend',
    client: 'Copes Family Trust', type: 'Residential Full Rewire',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Ray Castillo',
    start: '2025-01-28', target: '2025-04-30', extras: 0,
    invoiceNum: '3381', invoiceDate: '01/23/2026', qbsPM: 'Taylor Hensley',
    billingStatus: 'invoiced',
    permitNumber: '2026007315',
    subs: { electrical: 'P2 In-House', plumbing: 'Medey', hvac: null },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: null },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-02-02', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'n/a', final: 'n/a' },
    },
  },
  // ── QBS-005 Gold — CORE: rough-in PASS 10/16/2025 ────────────────────────────
  {
    id: 'QBS-005', name: 'Gold', address: '8825 Gold Mine Blvd', city: 'Katy, TX 77494', county: 'Fort Bend',
    client: 'Gold Holdings LLC', type: 'New Construction MEP',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Jake Torres',
    start: '2024-12-01', target: '2025-05-20', extras: 0,
    invoiceNum: '3286', invoiceDate: '10/23/2025', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2025096403',
    subs: { electrical: 'Ventura', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2025-10-16', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-006 Harris — CORE: rough-in PASS 04/01 ───────────────────────────────
  {
    id: 'QBS-006', name: 'Harris', address: '3301 Harris County Rd', city: 'Houston, TX 77008', county: 'Harris',
    client: 'Harris Family', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Mike Rodriguez', lead: 'Luis Moreno',
    start: '2024-11-15', target: '2025-03-31', extras: 0,
    invoiceNum: '3361', invoiceDate: '01/08/2026', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2026021457',
    subs: { electrical: 'Mario', plumbing: 'Edgar', hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-01', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-007 Landwehr — CORE: SR PASS 04/13, elec final PASS 04/17 → COMPLETE ─
  {
    id: 'QBS-007', name: 'Landwehr', address: '512 Landwehr Rd', city: 'Northbrook, IL 60062', county: 'Cook',
    client: 'Landwehr Estate', type: 'Electrical + Plumbing Renovation',
    status: 'complete', phase: 'complete', progress: 100,
    pm: 'David Park', lead: 'Sam Delgado',
    start: '2025-03-05', target: '2025-08-15', extras: 0,
    invoiceNum: '3325', invoiceDate: '12/05/2025', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2025110796',
    subs: { electrical: 'P2 In-House', plumbing: 'Kebler', hvac: null },
    permits: { electrical: 'finaled', plumbing: 'approved', hvac: null },
    insp: {
      electrical: { roughIn: 'pending-verification', trim: 'pending-verification', final: 'passed', finalDate: '2026-04-17' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'n/a', final: 'n/a' },
    },
  },
  // ── QBS-008 Nall — CORE: rough-in PASS 04/09, SR PASS 04/09, final PASS 04/09, HVAC PASS 04/14 → COMPLETE
  {
    id: 'QBS-008', name: 'Nall', address: '6640 Nall Ave', city: 'Mission Hills, KS 66208', county: 'Johnson',
    client: 'Nall Property Group', type: 'Commercial HVAC Retrofit',
    status: 'complete', phase: 'complete', progress: 100,
    pm: 'Sarah Chen', lead: 'Ray Castillo',
    start: '2025-01-20', target: '2025-05-01', extras: 0,
    billingStatus: 'not-invoiced',
    permitNumber: '2025088442',
    subs: { electrical: 'Ventura', plumbing: null, hvac: 'Carlos' },
    permits: { electrical: 'finaled', plumbing: null, hvac: 'finaled' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-09', trim: 'pending-verification', final: 'passed', finalDate: '2026-04-09' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'passed', finalDate: '2026-04-14' },
    },
  },
  // ── QBS-009 Sliger — CORE: elec final PASS 04/16, HVAC PASS 04/16 → COMPLETE ─
  {
    id: 'QBS-009', name: 'Sliger', address: '2218 Sliger Mine Rd', city: 'Pearland, TX 77581', county: 'Brazoria',
    client: 'Sliger Residential', type: 'Full MEP New Build',
    status: 'complete', phase: 'complete', progress: 100,
    pm: 'Mike Rodriguez', lead: 'Jake Torres',
    start: '2025-02-10', target: '2025-07-01', extras: 0,
    invoiceNum: '3349', invoiceDate: '12/30/2025', qbsPM: 'Taylor Hensley',
    billingStatus: 'invoiced',
    permitNumber: '2025116188',
    subs: { electrical: 'Mario', plumbing: 'Edgar', hvac: 'Carlos' },
    permits: { electrical: 'finaled', plumbing: 'approved', hvac: 'finaled' },
    insp: {
      electrical: { roughIn: 'pending-verification', trim: 'pending-verification', final: 'passed', finalDate: '2026-04-16' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'passed', finalDate: '2026-04-16' },
    },
  },
  // ── QBS-010 Tillman — CORE: rough-in PASS (earlier), SR PASS 03/27 ────────────
  {
    id: 'QBS-010', name: 'Tillman', address: '9015 Tillman Ave', city: 'The Woodlands, TX 77380', county: 'Montgomery',
    client: 'Tillman Custom Homes', type: 'New Construction MEP',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'David Park', lead: 'Luis Moreno',
    start: '2024-09-01', target: '2025-01-31', extras: 0,
    invoiceNum: '3401', invoiceDate: '02/06/2026', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2026011106',
    subs: { electrical: 'Ventura', plumbing: 'Kebler', hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-011 Wootens — CORE (shared permit 2025103877): rough-in PASS 11/20, SR FAIL 02/03
  {
    id: 'QBS-011', name: 'Wootens', address: '404 Wootens Hollow Rd', city: 'Cypress, TX 77429', county: 'Harris',
    client: 'Wootens Family', type: 'Residential MEP Upgrade',
    status: 'needs-action', phase: 'service-built-needs-release', progress: 55,
    pm: 'Sarah Chen', lead: 'Sam Delgado',
    start: '2025-02-25', target: '2025-06-15', extras: 0,
    invoiceNum: '3390', invoiceDate: '01/28/2026', qbsPM: 'Derek Powers',
    billingStatus: 'invoiced',
    permitNumber: '2025103877',
    subs: { electrical: 'P2 In-House', plumbing: 'Medey', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2025-11-20', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-012 Zahns — CORE: rough-in PASS 03/04 ────────────────────────────────
  {
    id: 'QBS-012', name: 'Zahns', address: '7223 Zahns Bay Rd', city: 'League City, TX 77573', county: 'Galveston',
    client: 'Zahns Properties', type: 'Electrical Rewire + HVAC',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Mike Rodriguez', lead: 'Ray Castillo',
    start: '2024-12-10', target: '2025-04-10', extras: 0,
    invoiceNum: '3407', invoiceDate: '02/13/2026', qbsPM: 'Derek Powers',
    billingStatus: 'invoiced',
    permitNumber: '2026012143',
    subs: { electrical: 'Ventura', plumbing: null, hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-04', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-013 Bilbrey — no CORE results ────────────────────────────────────────
  {
    id: 'QBS-013', name: 'Bilbrey', address: '1118 Bilbrey Creek Dr', city: 'Friendswood, TX 77546', county: 'Galveston',
    client: 'Bilbrey Development', type: 'Commercial MEP Buildout',
    status: 'pending', phase: 'not-started', progress: 5,
    pm: 'David Park', lead: 'Jake Torres',
    start: '2025-03-15', target: '2025-09-30', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Brendan Embry',
    subs: { electrical: 'Mario', plumbing: 'Edgar', hvac: 'Carlos' },
    permits: { electrical: 'applied', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'not-started', final: 'not-started' },
      hvac:       { roughIn: 'not-started', final: 'not-started' },
    },
  },
  // ── QBS-014 Bottom — CORE: rough-in PASS 01/09 ───────────────────────────────
  {
    id: 'QBS-014', name: 'Bottom', address: '2245 Bottom Creek Ln', city: 'Houston, TX 77042', county: 'Harris',
    client: 'Bottom Family', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Mike Rodriguez', lead: 'Sam Delgado',
    start: '2025-02-20', target: '2025-06-30', extras: 0,
    invoiceNum: '3406', invoiceDate: '02/12/2026', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2026012150',
    subs: { electrical: 'Ventura', plumbing: 'Edgar', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-01-09', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-015 Buford — no CORE results ─────────────────────────────────────────
  {
    id: 'QBS-015', name: 'Buford', address: '801 Buford Crossing Blvd', city: 'Sugar Land, TX 77478', county: 'Fort Bend',
    client: 'Buford Construction', type: 'Electrical + Plumbing Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Luis Moreno',
    start: '2025-03-01', target: '2025-07-15', extras: 0,
    invoiceNum: '3434', invoiceDate: '03/03/2026', qbsPM: 'Brendan Embry',
    billingStatus: 'invoiced',
    subs: { electrical: 'P2 In-House', plumbing: 'Victor', hvac: null },
    permits: { electrical: 'approved', plumbing: 'applied', hvac: null },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'not-started', final: 'not-started' },
      hvac:       { roughIn: 'n/a', final: 'n/a' },
    },
  },
  // ── QBS-016 Chandler — CORE: rough-in PASS 04/07 ─────────────────────────────
  {
    id: 'QBS-016', name: 'Chandler', address: '5534 Chandler Ridge Dr', city: 'Houston, TX 77077', county: 'Harris',
    client: 'Chandler Property Group', type: 'HVAC + Electrical Upgrade',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Ray Castillo',
    start: '2025-01-15', target: '2025-05-31', extras: 0,
    invoiceNum: '3467', invoiceDate: '03/26/2026', qbsPM: 'Blake Neblett',
    billingStatus: 'invoiced',
    permitNumber: '2026023811',
    subs: { electrical: 'Mario', plumbing: null, hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-07', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-017 Christensen — no CORE results ────────────────────────────────────
  {
    id: 'QBS-017', name: 'Christensen', address: '3318 Christensen Cove', city: 'Spring, TX 77379', county: 'Harris',
    client: 'Christensen Estate', type: 'Full MEP New Build',
    status: 'pending', phase: 'not-started', progress: 5,
    pm: 'Mike Rodriguez', lead: 'Jake Torres',
    start: '2024-12-15', target: '2025-04-30', extras: 0,
    billingStatus: 'not-invoiced',
    subs: { electrical: 'Ventura', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'applied', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'not-started', final: 'not-started' },
      hvac:       { roughIn: 'not-started', final: 'not-started' },
    },
  },
  // ── QBS-018 Daniels — no CORE results ────────────────────────────────────────
  {
    id: 'QBS-018', name: 'Daniels', address: '12200 Daniels Commercial Pkwy', city: 'Katy, TX 77449', county: 'Fort Bend',
    client: 'Daniels Development LLC', type: 'Commercial MEP Buildout',
    status: 'pending', phase: 'not-started', progress: 5,
    pm: 'Sarah Chen', lead: 'Sam Delgado',
    start: '2025-03-10', target: '2025-10-15', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Brendan Embry',
    subs: { electrical: 'Mario', plumbing: 'Edgar', hvac: 'Roman' },
    permits: { electrical: 'applied', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'not-started', final: 'not-started' },
      hvac:       { roughIn: 'not-started', final: 'not-started' },
    },
  },
  // ── QBS-019 Enderle — CORE: rough-in PASS 10/27/2025 ─────────────────────────
  {
    id: 'QBS-019', name: 'Enderle', address: '620 Enderele Ave', city: 'Galveston, TX 77550', county: 'Galveston',
    client: 'Enderele Residence', type: 'Residential Full Rewire',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Luis Moreno',
    start: '2024-08-01', target: '2024-12-20', extras: 0,
    invoiceNum: '3288', invoiceDate: '10/23/2025', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2025096952',
    subs: { electrical: 'P2 In-House', plumbing: 'Medey', hvac: null },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: null },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2025-10-27', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'n/a', final: 'n/a' },
    },
  },
  // ── QBS-020 Fitch — CORE: rough-in PASS 01/16, SR PASS 03/06 ─────────────────
  {
    id: 'QBS-020', name: 'Fitch', address: '8801 Fitch Landing Rd', city: 'Pearland, TX 77584', county: 'Brazoria',
    client: 'Fitch Family Trust', type: 'Electrical Rewire + HVAC',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Mike Rodriguez', lead: 'Ray Castillo',
    start: '2025-01-22', target: '2025-05-10', extras: 0,
    invoiceNum: '3372', invoiceDate: '01/16/2026', qbsPM: 'Derek Powers',
    billingStatus: 'invoiced',
    permitNumber: '2026004462',
    subs: { electrical: 'Ventura', plumbing: null, hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-01-16', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-021 Gaddis — CORE: plumbing + HVAC rough-in PASS 03/10 ───────────────
  {
    id: 'QBS-021', name: 'Gaddis', address: '4409 Gaddis Hollow Ln', city: 'Pearland, TX 77581', county: 'Brazoria',
    client: 'Gaddis Properties', type: 'HVAC + Plumbing Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Jake Torres',
    start: '2025-02-28', target: '2025-07-01', extras: 0,
    invoiceNum: '3440', invoiceDate: '03/10/2026', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2026020501',
    subs: { electrical: null, plumbing: 'Victor', hvac: 'Roman' },
    permits: { electrical: null, plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'n/a', trim: 'n/a', final: 'n/a' },
      plumbing:   { roughIn: 'passed', roughInDate: '2026-03-10', final: 'pending-verification' },
      hvac:       { roughIn: 'passed', roughInDate: '2026-03-10', final: 'pending-verification' },
    },
  },
  // ── QBS-022 Harlands — CORE: rough-in PASS 04/02 ─────────────────────────────
  {
    id: 'QBS-022', name: 'Harlands', address: '17500 Harlands Estate Dr', city: 'The Woodlands, TX 77381', county: 'Montgomery',
    client: 'Harlands Estate', type: 'New Construction MEP',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Sam Delgado',
    start: '2025-03-20', target: '2025-11-30', extras: 0,
    invoiceNum: '3416', invoiceDate: '02/17/2026', qbsPM: 'Brendan Embry',
    billingStatus: 'invoiced',
    permitNumber: '2026013267',
    subs: { electrical: 'Mario', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'applied', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-02', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-023 Harrison — no CORE results ───────────────────────────────────────
  {
    id: 'QBS-023', name: 'Harrison', address: '5901 Harrison Ave', city: 'Houston, TX 77007', county: 'Harris',
    client: 'Harrison Holdings', type: 'Commercial HVAC Retrofit',
    status: 'pending', phase: 'not-started', progress: 5,
    pm: 'Mike Rodriguez', lead: 'Luis Moreno',
    start: '2024-12-05', target: '2025-04-20', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Brendan Embry',
    subs: { electrical: 'Ventura', plumbing: null, hvac: 'Roman' },
    permits: { electrical: 'applied', plumbing: null, hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'not-started', final: 'not-started' },
    },
  },
  // ── QBS-024 Hicks — CORE: rough-in PASS 04/01 ────────────────────────────────
  {
    id: 'QBS-024', name: 'Hicks', address: '3100 Hicks Mill Rd', city: 'Stafford, TX 77477', county: 'Fort Bend',
    client: 'Hicks Residential', type: 'Plumbing + Electrical Upgrade',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Ray Castillo',
    start: '2025-02-01', target: '2025-06-01', extras: 0,
    invoiceNum: '3443', invoiceDate: '03/10/2026', qbsPM: 'Brendan Embry',
    billingStatus: 'invoiced',
    permitNumber: '2026023981',
    subs: { electrical: 'P2 In-House', plumbing: 'Edgar', hvac: null },
    permits: { electrical: 'approved', plumbing: 'pending', hvac: null },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-01', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'n/a', final: 'n/a' },
    },
  },
  // ── QBS-025 Kirton — CORE: rough-in PASS 11/20/2025, SR FAIL 02/03 ───────────
  {
    id: 'QBS-025', name: 'Kirton', address: '2950 Kirton Commerce Dr', city: 'Missouri City, TX 77459', county: 'Fort Bend',
    client: 'Kirton Development', type: 'Commercial MEP Buildout',
    status: 'needs-action', phase: 'service-built-needs-release', progress: 55,
    pm: 'David Park', lead: 'Jake Torres',
    start: '2025-03-08', target: '2025-10-31', extras: 0,
    invoiceNum: '3287', invoiceDate: '10/23/2025', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2025103877',
    subs: { electrical: 'Ventura', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2025-11-20', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-026 Leopard — CORE: rough-in PASS (earlier), SR PASS 03/04 ────────────
  {
    id: 'QBS-026', name: 'Leopard', address: '1400 Leopards Run Blvd', city: 'Conroe, TX 77301', county: 'Montgomery',
    client: 'Leopards LLC', type: 'Electrical + HVAC Upgrade',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Mike Rodriguez', lead: 'Sam Delgado',
    start: '2025-02-10', target: '2025-06-15', extras: 0,
    invoiceNum: '3340', invoiceDate: '12/19/2025', qbsPM: 'Derek Powers',
    billingStatus: 'invoiced',
    permitNumber: '2025116173',
    subs: { electrical: 'Mario', plumbing: null, hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-027 Loreant — CORE: rough-in PASS 01/08 ──────────────────────────────
  {
    id: 'QBS-027', name: 'Loreant', address: '7712 Loreant Oaks Dr', city: 'Humble, TX 77338', county: 'Harris',
    client: 'Loreant Properties', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Luis Moreno',
    start: '2024-11-20', target: '2025-03-28', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Jeb Brooks',
    permitNumber: '2026000329',
    subs: { electrical: 'P2 In-House', plumbing: 'Edgar', hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-01-08', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-028 Lowery — CORE: rough-in PASS 03/14, SR PASS 04/01 ────────────────
  {
    id: 'QBS-028', name: 'Lowery', address: '4481 Lowery Creek Ln', city: 'Baytown, TX 77521', county: 'Harris',
    client: 'Lowery Family', type: 'Residential MEP Upgrade',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'David Park', lead: 'Ray Castillo',
    start: '2025-02-15', target: '2025-07-01', extras: 0,
    invoiceNum: '3477', invoiceDate: '04/09/2026', qbsPM: 'Jeb Brooks',
    billingStatus: 'invoiced',
    permitNumber: '2025116769',
    subs: { electrical: 'Ventura', plumbing: 'Medey', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-14', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-029 Lyle — CORE: rough-in PASS 02/05, SR PASS 04/16 ─────────────────
  {
    id: 'QBS-029', name: 'Lyle', address: '6600 Lyle Estates Pkwy', city: 'Richmond, TX 77406', county: 'Fort Bend',
    client: 'Lyle Custom Homes', type: 'New Construction MEP',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Mike Rodriguez', lead: 'Jake Torres',
    start: '2025-03-25', target: '2025-11-15', extras: 0,
    invoiceNum: '3382', invoiceDate: '01/23/2026', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2026007314',
    subs: { electrical: 'Mario', plumbing: 'Victor', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-02-05', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-030 Newman — CORE: HVAC rough-in PASS 03/04 ──────────────────────────
  {
    id: 'QBS-030', name: 'Newman', address: '9900 Newman Blvd', city: 'Tomball, TX 77375', county: 'Harris',
    client: 'Newman Residence', type: 'HVAC System Replacement',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Sam Delgado',
    start: '2024-10-01', target: '2025-01-15', extras: 0,
    invoiceNum: '3429', invoiceDate: '02/27/2026', qbsPM: 'Taylor Hensley',
    billingStatus: 'invoiced',
    permitNumber: '2026017686',
    subs: { electrical: null, plumbing: null, hvac: 'Roman' },
    permits: { electrical: null, plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'n/a', trim: 'n/a', final: 'n/a' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'passed', roughInDate: '2026-03-04', final: 'pending-verification' },
    },
  },
  // ── QBS-031 Olive — CORE: rough-in PASS 04/14 ────────────────────────────────
  {
    id: 'QBS-031', name: 'Olive', address: '1818 Olive Beach Rd', city: 'Galveston, TX 77554', county: 'Galveston',
    client: 'Olive Estate', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Luis Moreno',
    start: '2025-01-05', target: '2025-05-20', extras: 0,
    billingStatus: 'not-invoiced',
    permitNumber: '2026030190',
    subs: { electrical: 'Ventura', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'applied', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-14', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-032 Parker — no CORE results ─────────────────────────────────────────
  {
    id: 'QBS-032', name: 'Parker', address: '5500 Parker Industrial Dr', city: 'Beaumont, TX 77706', county: 'Jefferson',
    client: 'Parker Development Group', type: 'Commercial MEP Buildout',
    status: 'pending', phase: 'not-started', progress: 5,
    pm: 'Mike Rodriguez', lead: 'Ray Castillo',
    start: '2025-03-12', target: '2025-10-30', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Brendan Embry',
    subs: { electrical: 'Mario', plumbing: 'Edgar', hvac: 'Roman' },
    permits: { electrical: 'applied', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'not-started', final: 'not-started' },
      hvac:       { roughIn: 'not-started', final: 'not-started' },
    },
  },
  // ── QBS-033 Parton — complete (owner-confirmed, no CORE permit) ───────────────
  {
    id: 'QBS-033', name: 'Parton', address: '2200 Parton Magnolia Ln', city: 'La Porte, TX 77571', county: 'Harris',
    client: 'Parton Property Group', type: 'Electrical Full Rewire',
    status: 'complete', phase: 'complete', progress: 100,
    pm: 'Sarah Chen', lead: 'Jake Torres',
    start: '2024-12-20', target: '2025-04-15', extras: 0,
    invoiceNum: '3338', invoiceDate: '12/11/2025', qbsPM: 'Taylor Hensley',
    billingStatus: 'invoiced',
    subs: { electrical: 'P2 In-House', plumbing: null, hvac: null },
    permits: { electrical: 'finaled', plumbing: null, hvac: null },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'n/a', final: 'n/a' },
    },
  },
  // ── QBS-034 Qualls — CORE (shared permit 2026020871): rough-in PASS 03/11 ─────
  {
    id: 'QBS-034', name: 'Qualls', address: '3388 Qualls Mill Rd', city: 'Deer Park, TX 77536', county: 'Harris',
    client: 'Qualls Construction', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Sam Delgado',
    start: '2025-02-22', target: '2025-07-10', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Taylor Hensley',
    permitNumber: '2026020871',
    subs: { electrical: 'Ventura', plumbing: 'Victor', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-11', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-035 Rigsby — CORE: rough-in PASS 03/02 ───────────────────────────────
  {
    id: 'QBS-035', name: 'Rigsby', address: '4601 Rigsby Ranch Rd', city: 'Pasadena, TX 77505', county: 'Harris',
    client: 'Rigsby Residential', type: 'HVAC + Plumbing Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Mike Rodriguez', lead: 'Luis Moreno',
    start: '2025-02-05', target: '2025-06-30', extras: 0,
    invoiceNum: '3428', invoiceDate: '02/27/2026', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2026012158',
    subs: { electrical: null, plumbing: 'Medey', hvac: 'Roman' },
    permits: { electrical: null, plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'n/a', trim: 'n/a', final: 'n/a' },
      plumbing:   { roughIn: 'passed', roughInDate: '2026-03-02', final: 'pending-verification' },
      hvac:       { roughIn: 'passed', roughInDate: '2026-03-02', final: 'pending-verification' },
    },
  },
  // ── QBS-036 Russell — CORE: rough-in PASS 04/15 ──────────────────────────────
  {
    id: 'QBS-036', name: 'Russell', address: '1122 Russell Lake Dr', city: 'Clear Lake, TX 77058', county: 'Harris',
    client: 'Russell Family Trust', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Ray Castillo',
    start: '2024-11-01', target: '2025-03-15', extras: 0,
    billingStatus: 'not-invoiced',
    permitNumber: '2026030189',
    subs: { electrical: 'Mario', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'applied', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-15', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-037 Sears — no CORE results ──────────────────────────────────────────
  {
    id: 'QBS-037', name: 'Sears', address: '7700 Sears Crossing Blvd', city: 'Webster, TX 77598', county: 'Harris',
    client: 'Sears Holdings', type: 'Electrical + HVAC Upgrade',
    status: 'pending', phase: 'not-started', progress: 5,
    pm: 'David Park', lead: 'Jake Torres',
    start: '2025-02-08', target: '2025-06-20', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Brendan Embry',
    subs: { electrical: 'Ventura', plumbing: null, hvac: 'Roman' },
    permits: { electrical: 'applied', plumbing: null, hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'not-started', final: 'not-started' },
    },
  },
  // ── QBS-038 Shepard — CORE: rough-in PASS 01/26, SR PASS 03/03 ───────────────
  {
    id: 'QBS-038', name: 'Shepard', address: '9200 Shepard Meadows Dr', city: 'Rosenberg, TX 77469', county: 'Fort Bend',
    client: 'Shepard Estate', type: 'New Construction MEP',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Mike Rodriguez', lead: 'Sam Delgado',
    start: '2025-03-18', target: '2025-12-01', extras: 0,
    invoiceNum: '3375', invoiceDate: '01/16/2026', qbsPM: 'Blake Neblett',
    billingStatus: 'invoiced',
    permitNumber: '2026005685',
    subs: { electrical: 'P2 In-House', plumbing: 'Edgar', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-01-26', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-039 Slaton — CORE: rough-in PASS 02/05 ───────────────────────────────
  {
    id: 'QBS-039', name: 'Slaton', address: '3820 Slaton Commerce Way', city: 'Manvel, TX 77578', county: 'Brazoria',
    client: 'Slaton Development', type: 'Commercial MEP Buildout',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Sarah Chen', lead: 'Luis Moreno',
    start: '2025-01-18', target: '2025-06-01', extras: 0,
    invoiceNum: '3396', invoiceDate: '02/05/2026', qbsPM: 'Derek Powers',
    billingStatus: 'invoiced',
    permitNumber: '2026009175',
    subs: { electrical: 'Mario', plumbing: 'Victor', hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-02-05', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-040 Stetchyn — CORE: SR PASS 03/10, elec final PASS 03/10, HVAC FAIL 03/10
  {
    id: 'QBS-040', name: 'Stetchyn', address: '1504 Stetchyn Oak St', city: 'Alvin, TX 77511', county: 'Brazoria',
    client: 'Stetchyn Residence', type: 'Residential Full Rewire',
    status: 'needs-action', phase: 'final-phase', progress: 90,
    pm: 'David Park', lead: 'Ray Castillo',
    start: '2025-03-05', target: '2025-07-20', extras: 0,
    billingStatus: 'paid',
    permitNumber: '2025090662',
    subs: { electrical: 'Ventura', plumbing: null, hvac: null },
    permits: { electrical: 'finaled', plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'pending-verification', trim: 'pending-verification', final: 'passed', finalDate: '2026-03-10' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'failed', finalFailDate: '2026-03-10' },
    },
  },
  // ── QBS-041 Thompson — CORE: SR PASS 02/06 ───────────────────────────────────
  {
    id: 'QBS-041', name: 'Thompson', address: '8810 Thompson Industrial Ave', city: 'Galena Park, TX 77547', county: 'Harris',
    client: 'Thompson Properties', type: 'Full MEP Renovation',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Mike Rodriguez', lead: 'Jake Torres',
    start: '2024-12-01', target: '2025-04-10', extras: 0,
    billingStatus: 'not-invoiced', qbsPM: 'Tim King',
    permitNumber: '2026000328',
    subs: { electrical: 'Mario', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'pending-verification', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-042 Viox — CORE: rough-in PASS 03/27, SR PASS 04/07 ─────────────────
  {
    id: 'QBS-042', name: 'Viox', address: '2201 Viox Harbor Blvd', city: 'Seabrook, TX 77586', county: 'Harris',
    client: 'Viox Construction', type: 'HVAC + Electrical Upgrade',
    status: 'on-track', phase: 'service-release-passed', progress: 75,
    pm: 'Sarah Chen', lead: 'Sam Delgado',
    start: '2025-02-25', target: '2025-07-10', extras: 0,
    invoiceNum: '3417', invoiceDate: '02/17/2026', qbsPM: 'Brendan Embry',
    billingStatus: 'invoiced',
    permitNumber: '2026014600',
    subs: { electrical: 'P2 In-House', plumbing: null, hvac: 'Roman' },
    permits: { electrical: 'approved', plumbing: null, hvac: 'approved' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-27', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'n/a', final: 'n/a' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-043 Weaver — CORE (shared permit 2026020871): rough-in PASS 03/11 ─────
  {
    id: 'QBS-043', name: 'Weaver', address: '6633 Weaver Cove Rd', city: 'Dickinson, TX 77539', county: 'Galveston',
    client: 'Weaver Family', type: 'Residential MEP Upgrade',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'David Park', lead: 'Luis Moreno',
    start: '2025-02-12', target: '2025-06-30', extras: 0,
    invoiceNum: '3351', invoiceDate: '12/30/2025', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2026020871',
    subs: { electrical: 'Ventura', plumbing: 'Edgar', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-03-11', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
  // ── QBS-044 Young — CORE: rough-in PASS 04/21 ────────────────────────────────
  {
    id: 'QBS-044', name: 'Young', address: '4500 Young Plantation Dr', city: 'Lake Jackson, TX 77566', county: 'Brazoria',
    client: 'Young Custom Homes', type: 'New Construction MEP',
    status: 'on-track', phase: 'rough-in-passed', progress: 40,
    pm: 'Mike Rodriguez', lead: 'Ray Castillo',
    start: '2025-04-01', target: '2025-12-15', extras: 0,
    invoiceNum: '3486', invoiceDate: '04/15/2026', qbsPM: 'Tim King',
    billingStatus: 'invoiced',
    permitNumber: '2026034220',
    subs: { electrical: 'Mario', plumbing: 'Kebler', hvac: 'Carlos' },
    permits: { electrical: 'approved', plumbing: 'applied', hvac: 'pending' },
    insp: {
      electrical: { roughIn: 'passed', roughInDate: '2026-04-21', trim: 'pending-verification', final: 'pending-verification' },
      plumbing:   { roughIn: 'pending-verification', final: 'pending-verification' },
      hvac:       { roughIn: 'pending-verification', final: 'pending-verification' },
    },
  },
].map(j => ({
  ...j,
  address: '',
  city: 'Middle Tennessee',
  county: '',
  pm: j.qbsPM || OLD_PM_MAP[j.pm] || j.pm,
  tenantId: 'qbs',
  ...(LAST_STATUS_CHANGES[j.id] ? { lastStatusChange: LAST_STATUS_CHANGES[j.id] } : {}),
}))

export const STATIC_EXTRAS = [
  { id: 'CO-001', job: 'QBS-001', desc: 'Panel upgrade to 200A',             amount: 3500, status: 'approved', qbs: true,  date: '2025-01-18' },
  { id: 'CO-002', job: 'QBS-001', desc: 'EV charger outlet + conduit',       amount: 2900, status: 'approved', qbs: true,  date: '2025-02-05' },
  { id: 'CO-003', job: 'QBS-003', desc: 'Additional 24 circuits — suite B',  amount: 8700, status: 'approved', qbs: true,  date: '2025-02-20' },
  { id: 'CO-004', job: 'QBS-003', desc: 'Backflow preventer (city req)',      amount: 4100, status: 'pending',  qbs: false, date: '2025-03-01' },
  { id: 'CO-005', job: 'QBS-005', desc: 'Gas line — outdoor kitchen',        amount: 2400, status: 'approved', qbs: true,  date: '2025-01-15' },
  { id: 'CO-006', job: 'QBS-005', desc: 'Smart thermostat wiring x6',        amount: 1800, status: 'approved', qbs: false, date: '2025-02-01' },
  { id: 'CO-007', job: 'QBS-005', desc: 'Emergency generator hookup',        amount: 4700, status: 'pending',  qbs: false, date: '2025-03-10' },
  { id: 'CO-008', job: 'QBS-008', desc: 'VAV box replacement x8',            amount: 7300, status: 'approved', qbs: true,  date: '2025-02-12' },
  { id: 'CO-009', job: 'QBS-009', desc: 'Radiant floor heating loop',        amount: 6200, status: 'pending',  qbs: false, date: '2025-03-05' },
  { id: 'CO-010', job: 'QBS-012', desc: 'Tankless water heater — master',    amount: 2850, status: 'approved', qbs: true,  date: '2025-01-22' },
  { id: 'CO-011', job: 'QBS-013', desc: 'Fire alarm rough-in — phase 1',     amount: 9200, status: 'approved', qbs: true,  date: '2025-03-20' },
  { id: 'CO-012', job: 'QBS-013', desc: 'Data/low voltage — server room',    amount: 5300, status: 'pending',  qbs: false, date: '2025-04-01' },
]

export const STATIC_NOTIFS = [
  { id: 1, type: 'error',   msg: 'QBS-024 Plumbing drain slope non-compliant — rework required', time: '3h ago',  read: false },
  { id: 2, type: 'warn',    msg: "Roman's insurance expires in 38 days — renewal required",      time: '1d ago',  read: false },
  { id: 3, type: 'warn',    msg: 'Medey: W-9 missing — cannot issue 1099',                       time: '2d ago',  read: false },
  { id: 4, type: 'info',    msg: 'QBS-008 HVAC rough-in inspection PASSED',                      time: '2d ago',  read: true  },
  { id: 5, type: 'success', msg: 'QBS-040 Stetchyn complete — all inspections passed',           time: '3d ago',  read: true  },
  { id: 6, type: 'info',    msg: 'CO-007 Awaiting QBS approval — $4,700',                        time: '3d ago',  read: true  },
  { id: 7, type: 'warn',    msg: 'QBS-013 permit applications pending — city review 2–3 weeks',  time: '4d ago',  read: false },
  { id: 8, type: 'success', msg: 'QBS-033 Parton HVAC final PASSED',                             time: '5d ago',  read: true  },
]

export const STATIC_SUBS = [
  { id: 'carlos',  name: 'Carlos Reyes',    co: 'Reliable HVAC Systems',     trade: 'HVAC',       lic: 'TACLA45231C',  licExp: '2026-06-30', insExp: '2025-12-31', w9: true,  score: 94,  jobs: 5, phone: '(713) 555-0101', lastUpdate: '2026-04-15' },
  { id: 'roman',   name: 'Roman Vasquez',   co: "Roman's Air & Heat",         trade: 'HVAC',       lic: 'TACLA78654E',  licExp: '2025-09-15', insExp: '2025-05-24', w9: true,  score: 88,  jobs: 3, phone: '(281) 555-0102', lastUpdate: '2026-04-10' },
  { id: 'kebler',  name: 'Kebler Torres',   co: 'Kebler Plumbing LLC',        trade: 'Plumbing',   lic: 'MPL#34521',    licExp: '2026-03-31', insExp: '2026-01-31', w9: true,  score: 97,  jobs: 4, phone: '(713) 555-0103', lastUpdate: '2026-04-16' },
  { id: 'medey',   name: 'Medey Ortiz',     co: 'Medey Plumbing Co',          trade: 'Plumbing',   lic: 'MPL#56789',    licExp: '2025-11-30', insExp: '2025-10-31', w9: false, score: 79,  jobs: 2, phone: '(832) 555-0104', lastUpdate: '2026-04-08' },
  { id: 'edgar',   name: 'Edgar Fuentes',   co: "Edgar's Pipe Works",         trade: 'Plumbing',   lic: 'MPL#12345',    licExp: '2026-05-31', insExp: '2026-03-31', w9: true,  score: 91,  jobs: 4, phone: '(713) 555-0105', lastUpdate: '2026-04-14' },
  { id: 'victor',  name: 'Victor Salinas',  co: 'Victor Plumbing Services',   trade: 'Plumbing',   lic: 'MPL#98765',    licExp: '2026-08-31', insExp: '2026-06-30', w9: true,  score: 85,  jobs: 0, phone: '(281) 555-0106', lastUpdate: '2026-04-01' },
  { id: 'ventura', name: 'Ventura Cruz',    co: 'Ventura Electric Inc',       trade: 'Electrical', lic: 'TECL#154321',  licExp: '2026-01-31', insExp: '2026-01-31', w9: true,  score: 96,  jobs: 5, phone: '(713) 555-0107', lastUpdate: '2026-04-15' },
  { id: 'mario',   name: 'Mario Delgado',   co: 'Mario Electric LLC',         trade: 'Electrical', lic: 'TECL#287654',  licExp: '2025-07-31', insExp: '2025-09-30', w9: true,  score: 82,  jobs: 3, phone: '(832) 555-0108', lastUpdate: '2026-04-11' },
  { id: 'p2',      name: 'P2 In-House Crew',co: 'P2 Field Services',          trade: 'Electrical', lic: 'TECL#000001',  licExp: '2026-12-31', insExp: '2026-12-31', w9: true,  score: 100, jobs: 3, phone: '(713) 555-0000', lastUpdate: '2026-04-16' },
]

export const STATIC_MATERIALS = [
  { id: 'M-001', job: 'QBS-001', item: '200A Main Panel Square D',      qty: 1,  unit: 'ea',    cost: 485,  status: 'delivered',  vendor: 'Graybar',    eta: '2025-01-20' },
  { id: 'M-002', job: 'QBS-001', item: '12/2 Romex Wire 250ft',         qty: 4,  unit: 'roll',  cost: 185,  status: 'delivered',  vendor: 'Graybar',    eta: '2025-01-20' },
  { id: 'M-003', job: 'QBS-003', item: '4" PVC Drain Pipe 20ft',        qty: 16, unit: 'stick', cost: 42,   status: 'delivered',  vendor: 'Ferguson',   eta: '2025-02-25' },
  { id: 'M-004', job: 'QBS-003', item: 'Carrier 5-Ton RTU Unit',        qty: 2,  unit: 'ea',    cost: 4200, status: 'in-transit', vendor: 'Johnstone',  eta: '2025-04-10' },
  { id: 'M-005', job: 'QBS-005', item: 'GFCI Outlets 15A x12',          qty: 12, unit: 'ea',    cost: 24,   status: 'ordered',    vendor: 'Graybar',    eta: '2025-04-18' },
  { id: 'M-006', job: 'QBS-009', item: 'Rheem 50-gal Water Heater',     qty: 2,  unit: 'ea',    cost: 890,  status: 'delivered',  vendor: 'Ferguson',   eta: '2025-02-28' },
  { id: 'M-007', job: 'QBS-013', item: 'Fire Alarm Control Panel',      qty: 1,  unit: 'ea',    cost: 3200, status: 'ordered',    vendor: 'ADT Supply', eta: '2025-04-20' },
  { id: 'M-008', job: 'QBS-008', item: 'VAV Box Assembly Trane',        qty: 8,  unit: 'ea',    cost: 680,  status: 'in-transit', vendor: 'Johnstone',  eta: '2025-04-05' },
]

// ── Zone + contract value lookup (used in migration) ─────────────────────────

const SEED_VERSION = 2

const PM_TO_ZONE = {
  'Blake Neblett':   'zone-1',
  'Brendan Embry':   'zone-2',
  'Jeb Brooks':      'zone-3',
  'Taylor Hensley':  'zone-4',
  'Tim King':        'zone-5',
  'Derek Powers':    'zone-6',
}

const TYPE_CONTRACT = {
  'New Construction MEP':             28000,
  'Full MEP Renovation':              22000,
  'Commercial MEP Buildout':          35000,
  'Commercial HVAC Retrofit':         20000,
  'Electrical Rewire + HVAC':         18000,
  'HVAC + Electrical Upgrade':        16000,
  'Residential Full Rewire':          14000,
  'HVAC + Plumbing Renovation':       15000,
  'Plumbing + Electrical Upgrade':    16000,
  'Full MEP New Build':               30000,
  'HVAC System Replacement':          12000,
  'Residential MEP Upgrade':          18000,
  'Electrical + Plumbing Renovation': 15000,
  'Electrical + HVAC Upgrade':        17000,
  'Electrical Full Rewire':           13000,
}

function agentFields(job) {
  return {
    zoneId:               PM_TO_ZONE[job.pm] || 'zone-7',
    contractValue:        TYPE_CONTRACT[job.type] || 18000,
    nextAction:           '',
    nextActionDue:        null,
    nextActionAssignedTo: null,
    materialStatus:       'unknown',
    gcReadyConfirmed:     null,
    _seedVersion:         SEED_VERSION,
  }
}

// ── Seed / migrate Firestore — NEVER overwrites user-edited fields ────────────

async function seedFirestore() {
  const snap = await getDocs(collection(db, 'jobs'))

  if (!snap.empty) {
    console.log('[seed] Jobs already exist — skipping seed')
    return
  }

  console.log('[seed] Empty collection — running first-time seed')
  const batch = writeBatch(db)

  STATIC_JOBS.forEach(job => {
    const ref = doc(collection(db, 'jobs'))
    batch.set(ref, { ...job, ...agentFields(job), _seeded: true, createdAt: serverTimestamp() })
  })

  if (true) {
    STATIC_EXTRAS.forEach(extra => {
      const ref = doc(collection(db, 'extras'))
      batch.set(ref, { ...extra, createdAt: serverTimestamp() })
    })
    STATIC_NOTIFS.forEach(n => {
      const ref = doc(collection(db, 'notifications'))
      batch.set(ref, { type: n.type, msg: n.msg, read: n.read, createdAt: serverTimestamp() })
    })
    STATIC_SUBS.forEach(sub => {
      batch.set(doc(db, 'subs', sub.id), sub)
    })
    STATIC_MATERIALS.forEach(m => {
      batch.set(doc(db, 'materials', m.id), { ...m, createdAt: serverTimestamp() })
    })
  }

  await batch.commit()
}

// ── Context ───────────────────────────────────────────────────────────────────

const DataContext = createContext(null)

export function DataProvider({ children, tenantId = null, role = null }) {
  const { jobs: firestoreJobs, loading: jobsLoading }               = useJobs()
  const { extras: firestoreExtras, loading: extrasLoading }         = useAllExtras()
  const { notifs: firestoreNotifs, loading: notifsLoading }         = useNotifications()
  const { subs: firestoreSubs, loading: subsLoading }               = useSubs()
  const { materials: firestoreMaterials, loading: matsLoading }     = useMaterials()
  const { submits: firestoreSubmits, loading: submitsLoading }       = useSubmits()
  const { dailyReports: firestoreDailyReports, loading: drLoading } = useDailyReports()
  const { urgentItems: firestoreUrgentItems, loading: uiLoading }   = useUrgentItems()
  const { settings }                                                 = useSettings()
  const { alerts: agentAlerts, loading: alertsLoading }             = useAgentAlerts()
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    seedFirestore()
      .then(() => setSeeded(true))
      .catch(() => setSeeded(true))
  }, [])

  const loading = jobsLoading || extrasLoading || notifsLoading || subsLoading || matsLoading || submitsLoading || drLoading || uiLoading

  const allJobs   = firestoreJobs.length      > 0 ? firestoreJobs      : STATIC_JOBS
  const allExtras = firestoreExtras.length    > 0 ? firestoreExtras    : STATIC_EXTRAS
  const notifs    = firestoreNotifs.length    > 0 ? firestoreNotifs    : STATIC_NOTIFS
  const subs      = firestoreSubs.length      > 0 ? firestoreSubs      : STATIC_SUBS
  const materials = firestoreMaterials.length > 0 ? firestoreMaterials : STATIC_MATERIALS
  const submits   = firestoreSubmits

  const shouldFilter = tenantId && (role === 'builder' || (role === 'internal' && tenantId !== 'p2-core'))
  const jobs   = shouldFilter ? allJobs.filter(j => (j.tenantId || 'qbs') === tenantId) : allJobs
  const extras = shouldFilter
    ? allExtras.filter(e => { const j = allJobs.find(x => x.id === e.job); return (j?.tenantId || 'qbs') === tenantId })
    : allExtras

  // Filter per-job records (dailyReports, urgentItems, submits) by job tenancy when scoped.
  const jobIdSet = shouldFilter ? new Set(jobs.map(j => j.id)) : null

  const matchesTenantJob = (rec) => {
    if (!jobIdSet) return true
    const id = rec?.jobId || rec?.job
    // Pass-through records with no job association (e.g. general urgent items, general submits)
    // when viewing builder portal — they're typically internal-only, so hide them for builders.
    if (!id) return role !== 'builder'
    return jobIdSet.has(id)
  }

  const dailyReports = shouldFilter ? firestoreDailyReports.filter(matchesTenantJob) : firestoreDailyReports
  const urgentItems  = shouldFilter ? firestoreUrgentItems.filter(matchesTenantJob)  : firestoreUrgentItems
  const submitsScoped = shouldFilter ? submits.filter(matchesTenantJob) : submits

  return (
    <DataContext.Provider value={{
      jobs, extras, notifs,
      subs,
      materials,
      submits: submitsScoped,
      dailyReports,
      urgentItems,
      settings,
      agentAlerts,
      loading,
      seeded,
    }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  return useContext(DataContext)
}
