import {
  STATIC_JOBS, STATIC_EXTRAS, STATIC_SUBS, STATIC_MATERIALS, LAST_STATUS_CHANGES, agentFields,
} from '../../scripts/demo-data.mjs'
import { daysBetween, parseDateStr, toLocalDateStr } from '../lib/dates'
import { Timestamp } from './timestamp'
import { DEMO_USERS } from './users'
import { extraActivity, inspectionActivity, jobActivity, scopeForJob } from './callables'

// The sample data the demo opens with, and goes back to on reset.
//
//   buildSeed(now)  every collection the screens read, as { [path]: { [docId]: data } }
//
// The jobs, change orders, subs and materials of the emulator seed (scripts/demo-data.mjs)
// are the base, with every date in them moved by one offset so that the newest status
// change is the day before now: the jobs keep how old each step is, and the app looks
// current. What that data does not have, and a screen needs, is added here, dated from
// now: the demo accounts, settings, submissions and replies, daily reports, alerts, crew
// scores, history, supplier invoices, permits, change orders in every status with line
// items, a few jobs in other tenants, and some jobs with blockers.
//
// Every name of a person, client, homeowner or company and every street address here is
// invented, and none comes from the emulator data, which has real looking names. The
// names that stay are the project managers and crew that the app itself lists (the PM
// rosters in PMDashboard.jsx and App.jsx, the crew in CrewReport.jsx and
// TeamLeaderboard.jsx), and the supplier names the Invoice Auditor lists. The text has
// no dash in it, and nothing here is or looks like a credential, a token or a Firebase
// identifier. The seed is the same for the same day, so a reset gives back what the
// demo opened with.

// Saved state is kept only for the seed version it was made from. Change this whenever
// the seed changes, so a browser that saved state from an older seed starts again from
// the new one instead of mixing the two.
export const DEMO_SEED_VERSION = 'demo-seed-1'

const CLIENT = DEMO_USERS.client
const BUILDER = DEMO_USERS.builder
const OWNER = DEMO_USERS.owner
const OFFICE = DEMO_USERS.internal

// ── Who is who ────────────────────────────────────────────────────────────────

// The homeowners and companies of the QBS jobs, in the order of the jobs that are not
// the client's.
const SURNAMES = [
  'Ashby', 'Barlowe', 'Callahan', 'Dunleavy', 'Eastwick', 'Fairchild', 'Garrity', 'Halvorsen', 'Ingersoll',
  'Jessup', 'Kingsley', 'Lockhart', 'Marchetti', 'Northam', 'Ogilvie', 'Prentiss', 'Quinlan', 'Ridgeway',
  'Stanhope', 'Thornbury', 'Upchurch', 'Vandermeer', 'Whitaker', 'Yancey', 'Zellner', 'Alcott', 'Brightwell',
  'Corrigan', 'Delacroix', 'Ellsworth', 'Fennimore', 'Gladstone', 'Hargrove', 'Iverson', 'Kettering',
  'Langston', 'Merritt', 'Norwood', 'Pendleton', 'Rosewood', 'Sutherland',
]

const STREETS = [
  'Juniper Hollow Ln', 'Cedar Bluff Rd', 'Maple Ridge Dr', 'Foxglove Ct', 'Stonebrook Way', 'Willow Bend Dr',
  'Hickory Crest Ln', 'Briar Glen Ct', 'Sycamore Run', 'Quail Hollow Dr', 'Magnolia Bend', 'Red Oak Trl',
  'Persimmon Ct', 'Laurel Springs Rd', 'Bluebell Way', 'Pine Hollow Rd', 'Chestnut Hill Dr', 'Meadowlark Ln',
  'Cobblestone Ct', 'Fern Valley Rd', 'Holly Brook Dr', 'Elm Crossing Way', 'Wren Hollow Ct', 'Copper Creek Rd',
  'Thistle Down Ln', 'Silver Maple Dr', 'Dogwood Trace', 'Harvest Moon Ct', 'Sassafras Ln', 'Clover Ridge Rd',
  'Ivy Gate Dr', 'Walnut Grove Way', 'Aspen Fork Rd', 'Poplar Point Ct', 'Honeysuckle Ln', 'Rolling Fork Dr',
  'Bramble Way', 'Shady Oak Ct', 'Twin Creeks Rd', 'Old Mill Pass', 'Kingfisher Ct',
]

// The three jobs of the demo client, a home builder with lots on one street.
const CLIENT_JOBS = {
  'QBS-003': { name: 'Larkspur Lot 12', address: '12 Larkspur Trace' },
  'QBS-024': { name: 'Larkspur Lot 14', address: '14 Larkspur Trace' },
  'QBS-033': { name: 'Larkspur Lot 9', address: '9 Larkspur Trace' },
}
const CLIENT_TOWN = ['Franklin, TN', 'Williamson']

// The towns of each project manager's zone (src/agent/zones.js), with their county.
const PM_TOWNS = {
  'Blake Neblett': [['Gallatin, TN', 'Sumner'], ['Hendersonville, TN', 'Sumner']],
  'Brendan Embry': [['Mt. Juliet, TN', 'Wilson'], ['Lebanon, TN', 'Wilson']],
  'Jeb Brooks': [['Murfreesboro, TN', 'Rutherford'], ['Smyrna, TN', 'Rutherford']],
  'Taylor Hensley': [['Franklin, TN', 'Williamson'], ['Brentwood, TN', 'Williamson']],
  'Tim King': [['Spring Hill, TN', 'Maury'], ['Columbia, TN', 'Maury']],
  'Derek Powers': [['Clarksville, TN', 'Montgomery'], ['Clarksville, TN', 'Montgomery']],
}

// The emulator data's job leads, as the crew the app lists.
const LEADS = { 'Jake Torres': 'Austin', 'Luis Moreno': 'Tony', 'Sam Delgado': 'Marvin', 'Ray Castillo': 'Trevor' }

// The subs, with invented people and companies. The key is the sub's id in the emulator
// data; jobs name a sub by the first word of its name (subJobKey in src/lib/subs.js).
const SUBS = {
  carlos: { id: 'wade', name: 'Wade Pruitt', co: 'Pruitt Comfort Air', lic: 'CMC 40821', phone: '(615) 555-0101' },
  roman: { id: 'lena', name: 'Lena Ocampo', co: 'Ocampo Heating and Air', lic: 'CMC 51307', phone: '(615) 555-0102' },
  kebler: { id: 'grant', name: 'Grant Elwood', co: 'Elwood Plumbing LLC', lic: 'PLB 33418', phone: '(615) 555-0103' },
  medey: { id: 'mara', name: 'Mara Quintero', co: 'Quintero Plumbing Co', lic: 'PLB 56920', phone: '(615) 555-0104' },
  edgar: { id: 'silas', name: 'Silas Brandt', co: 'Brandt Pipe Works', lic: 'PLB 12077', phone: '(615) 555-0105' },
  victor: { id: 'noel', name: 'Noel Ferrante', co: 'Ferrante Plumbing Services', lic: 'PLB 98034', phone: '(615) 555-0106' },
  ventura: { id: 'theo', name: 'Theo Marchand', co: 'Marchand Electric Inc', lic: 'ELC 15532', phone: '(615) 555-0107' },
  mario: { id: 'ivy', name: 'Ivy Castell', co: 'Castell Electric LLC', lic: 'ELC 28761', phone: '(615) 555-0108' },
  p2: { id: 'p2', name: 'P2 In-House Crew', co: 'P2 Field Services', lic: 'ELC 00001', phone: '(615) 555-0100' },
}

const SUB_KEYS = {
  Carlos: 'Wade', Roman: 'Lena', Kebler: 'Grant', Medey: 'Mara', Edgar: 'Silas', Victor: 'Noel', Ventura: 'Theo', Mario: 'Ivy',
  'P2 In-House': 'P2 In-House',
}

// Item names of the emulator data that are written here without a hyphen.
const ITEM_NAMES = { 'Carrier 5-Ton RTU Unit': 'Carrier 5 Ton RTU Unit', 'Rheem 50-gal Water Heater': 'Rheem 50 Gallon Water Heater' }

// The change orders of the emulator data, described here without dashes.
const EXTRA_WORDS = {
  'CO-001': 'Panel upgrade to 200A',
  'CO-002': 'EV charger outlet and conduit',
  'CO-003': 'Additional 24 circuits for suite B',
  'CO-004': 'Backflow preventer the city requires',
  'CO-005': 'Gas line for the outdoor kitchen',
  'CO-006': 'Smart thermostat wiring, six zones',
  'CO-007': 'Emergency generator hookup',
  'CO-008': 'VAV box replacement, eight boxes',
  'CO-009': 'Radiant floor heating loop',
  'CO-010': 'Tankless water heater for the main suite',
  'CO-011': 'Fire alarm rough in, phase 1',
  'CO-012': 'Data and low voltage for the server room',
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const US_DAY = /^\d{1,2}\/\d{1,2}\/\d{4}$/

function clock(now) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  // The local day n days from today, as 2026-10-19.
  const day = (n) => toLocalDateStr(new Date(y, m, d + n))
  // A moment n days ago at a local time of day, never later than now.
  const at = (daysAgo, hour = 9, minute = 0) => {
    const when = new Date(y, m, d - daysAgo, hour, minute)
    return Timestamp.fromMillis(Math.min(when.getTime(), now.getTime() - 60_000))
  }
  const hoursAgo = (hours) => Timestamp.fromMillis(now.getTime() - hours * 3_600_000)
  const iso = (stamp) => stamp.toDate().toISOString()
  return { day, at, hoursAgo, iso }
}

// Moves every day written in a value (2026-04-21 or 04/21/2026) by offset days, and
// leaves everything else as it is.
function shiftDays(value, offset) {
  if (typeof value === 'string' && (ISO_DAY.test(value) || US_DAY.test(value))) {
    const date = parseDateStr(value)
    if (!date) return value
    const moved = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
    return ISO_DAY.test(value)
      ? toLocalDateStr(moved)
      : `${pad(moved.getMonth() + 1)}/${pad(moved.getDate())}/${moved.getFullYear()}`
  }
  if (Array.isArray(value)) return value.map((item) => shiftDays(item, offset))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shiftDays(inner, offset)]))
  }
  return value
}

// Merges changes into a job at every depth, so one inspection phase can be set alone.
function withChanges(base, changes) {
  const out = { ...base }
  for (const [key, value] of Object.entries(changes)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object'
      ? withChanges(base[key], value)
      : value
  }
  return out
}

const docKey = (id) => id.toLowerCase()

// ── The seed ──────────────────────────────────────────────────────────────────

export function buildSeed(now) {
  const { day, at, hoursAgo, iso } = clock(now)
  const newest = Object.values(LAST_STATUS_CHANGES).sort().pop()
  const offset = daysBetween(newest, day(-1))
  const shift = (value) => shiftDays(value, offset)

  // ── Jobs ──
  const jobs = {}
  const byId = new Map()
  const permitNumbers = new Map()
  const permitFor = (old) => {
    if (!old) return undefined
    if (!permitNumbers.has(old)) permitNumbers.set(old, `${now.getFullYear()}${String(41_000 + permitNumbers.size * 173).padStart(6, '0')}`)
    return permitNumbers.get(old)
  }

  const changes = {
    'QBS-011': { insp: { plumbing: { roughIn: 'failed', roughInDate: day(-3) } }, nextAction: 'Rework the drain slope and call the plumbing rough in again', nextActionDue: day(1) },
    'QBS-012': { status: 'blocked', nextAction: 'Framing inspection has to pass before the service is set', nextActionAssignedTo: 'Marvin' },
    'QBS-022': { insp: { hvac: { roughIn: 'scheduled' } } },
    'QBS-028': { billingStatus: 'partial-pay' },
    'QBS-031': { photoCount: 6, companyCamUpdated: true },
    'QBS-035': { status: 'at-risk', nextAction: 'Confirm the HVAC startup date with the builder', nextActionDue: day(2) },
    'QBS-041': { billingStatus: 'hold', nextAction: 'Hold billing until the punch list is signed' },
    'QBS-044': { photoCount: 8, companyCamUpdated: true, insp: { plumbing: { roughIn: 'scheduled' } }, nextAction: 'Plumbing rough in is booked for Thursday', nextActionDue: day(3) },
  }

  let named = 0
  STATIC_JOBS.forEach((source, index) => {
    const own = CLIENT_JOBS[source.id]
    const name = own ? own.name : SURNAMES[named]
    const street = own ? null : `${120 + ((index * 37) % 880)} ${STREETS[named]}`
    if (!own) named += 1
    const towns = PM_TOWNS[source.pm] ?? PM_TOWNS['Taylor Hensley']
    const [city, county] = own ? CLIENT_TOWN : towns[index % towns.length]
    const clientWords = source.client.split(' ').slice(1).join(' ')
    const base = shift({ ...source, ...agentFields(source) })
    const job = withChanges({
      ...base,
      name,
      client: own ? CLIENT.displayName : `${name} ${clientWords}`,
      address: own ? own.address : street,
      city,
      county,
      lead: LEADS[source.lead] ?? 'Austin',
      subs: Object.fromEntries(Object.entries(source.subs).map(([trade, sub]) => [trade, sub ? SUB_KEYS[sub] : null])),
      ...(source.permitNumber ? { permitNumber: permitFor(source.permitNumber) } : {}),
      ...(source.invoiceNum ? { invoiceNum: String(Number(source.invoiceNum) + 1000) } : {}),
      tenantId: 'qbs',
      clientUids: own ? [CLIENT.uid] : [],
      createdAt: at(daysBetween(base.start, day(0)) ?? 30, 8, 0),
    }, changes[source.id] ?? {})
    delete job._seedVersion
    jobs[`job-${docKey(source.id)}`] = job
    byId.set(job.id, job)
  })

  const otherJobs = [
    {
      id: 'VBG-001', name: 'Brannock', client: 'Brannock Residence', tenantId: 'vision', type: 'New Construction MEP',
      address: '61 Lantern Hill Rd', city: 'Mt. Juliet, TN', county: 'Wilson', pm: 'Brendan Embry', qbsPM: 'Brendan Embry', lead: 'Tony',
      status: 'on-track', phase: 'rough-in-passed', progress: 35, start: day(-24), target: day(48), lastStatusChange: day(-2),
      billingStatus: 'not-invoiced', permitNumber: `${now.getFullYear()}052118`,
      subs: { electrical: 'Ivy', plumbing: 'Grant', hvac: 'Wade' },
      permits: { electrical: 'approved', plumbing: 'approved', hvac: 'applied' },
      insp: {
        electrical: { roughIn: 'passed', roughInDate: day(-6), trim: 'not-started', final: 'not-started' },
        plumbing: { roughIn: 'pending-verification', final: 'not-started' },
        hvac: { roughIn: 'not-started', final: 'not-started' },
      },
    },
    {
      id: 'VBG-002', name: 'Hollowell', client: 'Hollowell Family', tenantId: 'vision', type: 'Residential MEP Upgrade',
      address: '208 Cardinal Ridge Ct', city: 'Lebanon, TN', county: 'Wilson', pm: 'Brendan Embry', qbsPM: 'Brendan Embry', lead: 'Ty',
      status: 'pending', phase: 'not-started', progress: 5, start: day(6), target: day(80), lastStatusChange: day(-4),
      billingStatus: 'not-invoiced',
      subs: { electrical: 'P2 In-House', plumbing: 'Noel', hvac: null },
      permits: { electrical: 'applied', plumbing: 'applied', hvac: null },
      insp: {
        electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
        plumbing: { roughIn: 'not-started', final: 'not-started' },
        hvac: { roughIn: 'n/a', final: 'n/a' },
      },
    },
    {
      id: 'VBG-003', name: 'Ostrander', client: 'Ostrander Custom Homes', tenantId: 'vision', type: 'HVAC + Electrical Upgrade',
      address: '1450 Saddle Creek Dr', city: 'Murfreesboro, TN', county: 'Rutherford', pm: 'Jeb Brooks', qbsPM: 'Jeb Brooks', lead: 'Marvin',
      status: 'needs-action', phase: 'service-built-needs-release', progress: 60, start: day(-70), target: day(12), lastStatusChange: day(-1),
      billingStatus: 'not-invoiced', permitNumber: `${now.getFullYear()}052466`,
      subs: { electrical: 'Theo', plumbing: null, hvac: 'Lena' },
      permits: { electrical: 'approved', plumbing: null, hvac: 'approved' },
      insp: {
        electrical: { roughIn: 'passed', roughInDate: day(-30), trim: 'pending-verification', final: 'not-started' },
        plumbing: { roughIn: 'n/a', final: 'n/a' },
        hvac: { roughIn: 'scheduled', final: 'not-started' },
      },
    },
    {
      id: 'PEM-001', name: 'Calder', client: 'Calder Residence', tenantId: 'p2-core', type: 'Residential Full Rewire',
      address: '33 Summit View Ln', city: 'Brentwood, TN', county: 'Williamson', pm: 'Taylor Hensley', lead: 'Austin',
      status: 'on-track', phase: 'rough-in-passed', progress: 50, start: day(-40), target: day(21), lastStatusChange: day(-1),
      billingStatus: 'not-invoiced', permitNumber: `${now.getFullYear()}052903`,
      subs: { electrical: 'P2 In-House', plumbing: null, hvac: null },
      permits: { electrical: 'approved', plumbing: null, hvac: null },
      insp: {
        electrical: { roughIn: 'passed', roughInDate: day(-9), trim: 'pending-verification', final: 'not-started' },
        plumbing: { roughIn: 'n/a', final: 'n/a' },
        hvac: { roughIn: 'n/a', final: 'n/a' },
      },
    },
    {
      id: 'PEM-002', name: 'Tamsin', client: 'Tamsin Farm Supply', tenantId: 'p2-core', type: 'Commercial MEP Buildout',
      address: '4100 Depot St', city: 'Columbia, TN', county: 'Maury', pm: 'Tim King', lead: 'Trevor',
      status: 'at-risk', phase: 'not-started', progress: 20, start: day(-15), target: day(60), lastStatusChange: day(-6),
      billingStatus: 'not-invoiced', nextAction: 'Utility has not set the meter. Call the co op again.', nextActionDue: day(1),
      subs: { electrical: 'P2 In-House', plumbing: 'Silas', hvac: 'Wade' },
      permits: { electrical: 'applied', plumbing: 'pending', hvac: 'pending' },
      insp: {
        electrical: { roughIn: 'not-started', trim: 'not-started', final: 'not-started' },
        plumbing: { roughIn: 'not-started', final: 'not-started' },
        hvac: { roughIn: 'not-started', final: 'not-started' },
      },
    },
  ]
  for (const extra of otherJobs) {
    const job = {
      extras: 0,
      ...extra,
      ...agentFields(extra),
      clientUids: [],
      createdAt: at(daysBetween(extra.start, day(0)) > 0 ? daysBetween(extra.start, day(0)) : 3, 8, 0),
    }
    delete job._seedVersion
    jobs[`job-${docKey(extra.id)}`] = job
    byId.set(job.id, job)
  }

  const scopeOf = (jobId) => scopeForJob(byId.get(jobId))
  const stampFor = (jobId) => {
    const { tenantId, clientUids } = scopeOf(jobId)
    return { tenantId, clientUids }
  }

  // ── Users and settings ──
  const users = Object.fromEntries(Object.values(DEMO_USERS).map((account) => [account.uid, {
    email: account.email,
    displayName: account.displayName,
    role: account.claims.role,
    tenantId: account.claims.tenantId,
    ...(account.claims.role === 'client' ? { clientJobIds: [...account.claims.clientJobIds], clientName: account.displayName } : {}),
    createdBy: OWNER.uid,
    createdByEmail: OWNER.email,
    createdAt: at(120),
  }]))

  const config = {
    settings: {
      emailDigests: true,
      aiMorningBriefing: true,
      mandatoryDailyReports: true,
      hvacStartupBlocking: true,
      qbsPortalAccess: true,
      smsNotifications: false,
    },
  }

  // ── Change orders ──
  const extras = {}
  const author = { createdBy: OWNER.uid, createdByEmail: OWNER.email }
  const who = (account) => ({ uid: account.uid, email: account.email, displayName: account.displayName })

  STATIC_EXTRAS.forEach((source, index) => {
    const desc = EXTRA_WORDS[source.id]
    const pending = source.status === 'pending'
    extras[docKey(source.id)] = {
      ...shift(source),
      desc,
      lineItems: [{ desc, qty: 1, unit: 'LS', unitPrice: source.amount, extPrice: source.amount }],
      subtotal: source.amount,
      markupPct: 0,
      markup: 0,
      total: source.amount,
      notes: '',
      ...(pending ? { sentAt: at(1 + index % 9, 10) } : {}),
      ...stampFor(source.job),
      ...author,
      createdAt: at(200 - index * 5),
    }
  })

  const lineOf = ([desc, qty, unit, unitPrice]) => ({ desc, qty, unit, unitPrice, extPrice: Math.round(qty * unitPrice * 100) / 100 })
  const year = now.getFullYear()
  const NEW_COS = [
    { n: 14, job: 'QBS-044', status: 'Draft', daysAgo: 1, notes: 'Owner asked for these at the walk through.', lines: [['Two dedicated 20A circuits for the shop', 2, 'EA', 425], ['Surface conduit along the garage wall', 40, 'LF', 9.5]] },
    { n: 15, job: 'QBS-031', status: 'Draft', daysAgo: 0, notes: '', lines: [['Relocate the panel six feet', 1, 'LS', 1350]] },
    { n: 16, job: 'QBS-036', status: 'Sent to Builder', daysAgo: 2, sent: 2, notes: '', lines: [['Add a 50A range circuit', 1, 'EA', 780], ['Upsize the feeder to 4/0', 1, 'LS', 1120]] },
    { n: 17, job: 'QBS-024', status: 'Sent to Builder', daysAgo: 5, sent: 5, notes: 'Requested by Larkspur Homes for the kitchen.', lines: [['Under cabinet lighting in the kitchen', 14, 'LF', 38], ['Island outlet with a pop up box', 1, 'EA', 265]] },
    { n: 18, job: 'QBS-029', status: 'Rejected', daysAgo: 6, sent: 6, rejected: 4, by: BUILDER, reason: 'Use the existing panel location and resubmit the price.', notes: '', lines: [['Second panel for the bonus room', 1, 'LS', 2650]] },
    { n: 19, job: 'QBS-022', status: 'Approved', daysAgo: 8, sent: 7, approved: 3, by: BUILDER, notes: '', lines: [['Generator inlet and interlock kit', 1, 'EA', 940], ['Exterior outlet at the patio', 2, 'EA', 185]] },
    { n: 20, job: 'VBG-001', status: 'Sent to Builder', daysAgo: 3, sent: 3, notes: '', lines: [['Attic fan circuit', 1, 'EA', 360]] },
    { n: 21, job: 'QBS-003', status: 'Approved', daysAgo: 12, sent: 11, approved: 9, by: CLIENT, notes: '', lines: [['Landscape lighting transformer', 1, 'EA', 690]] },
  ]
  const newCos = NEW_COS.map((co) => {
    const coNumber = `CO-${year}-${String(co.n).padStart(3, '0')}`
    const lineItems = co.lines.map(lineOf)
    const subtotal = Math.round(lineItems.reduce((sum, line) => sum + line.extPrice, 0) * 100) / 100
    const markup = Math.round(subtotal * 15) / 100
    const total = Math.round((subtotal + markup) * 100) / 100
    const record = {
      coNumber, job: co.job, date: day(-co.daysAgo), status: co.status, lineItems, subtotal, markupPct: 15, markup, total,
      notes: co.notes, amount: total, desc: `${coNumber}: ${lineItems[0].desc}`,
      ...(co.status === 'Draft' ? {} : stampFor(co.job)),
      ...(co.sent ? { qbs: true, sentAt: at(co.sent, 11), qbsSentAt: at(co.sent, 11) } : {}),
      ...(co.approved ? { approvedBy: who(co.by), approvedAt: at(co.approved, 14) } : {}),
      ...(co.rejected ? { rejectedBy: who(co.by), rejectedAt: at(co.rejected, 15), rejectNotes: co.reason } : {}),
      ...author,
      createdAt: at(co.daysAgo, 9, 15),
    }
    extras[`co-${year}-${String(co.n).padStart(3, '0')}`] = record
    return { co, record }
  })

  // ── Notifications and history ──
  const notifications = {}
  const history = {}
  let noteCount = 0
  let lineCount = 0
  const notify = (fields) => {
    noteCount += 1
    notifications[`note-${String(noteCount).padStart(2, '0')}`] = fields
  }
  const record = (fields) => {
    lineCount += 1
    history[`hist-${String(lineCount).padStart(2, '0')}`] = fields
  }
  const scoped = (jobId) => (jobId ? stampFor(jobId) : {})
  const actorFields = (account) => ({ actor: account.displayName, actorUid: account.uid, actorEmail: account.email, createdBy: account.uid, createdByEmail: account.email })

  for (const { co, record: extra } of newCos) {
    const steps = [
      co.sent ? ['send', OWNER, co.sent] : null,
      co.approved ? ['approve', co.by, co.approved] : null,
      co.rejected ? ['reject', co.by, co.rejected] : null,
    ].filter(Boolean)
    for (const [action, account, daysAgo] of steps) {
      const activity = extraActivity(extra, action, account, co.reason)
      const when = at(daysAgo, action === 'send' ? 11 : 14)
      notify({ type: activity.type, msg: activity.msg, jobId: co.job, ...scoped(co.job), createdBy: account.uid, createdByEmail: account.email, createdAt: when, read: daysAgo > 3 })
      record({ type: 'change-order', action: activity.action, summary: activity.summary, jobId: co.job, extraId: `co-${year}-${String(co.n).padStart(3, '0')}`, ...actorFields(account), createdAt: when })
    }
  }

  // The results recorded on the jobs, told on the day each was recorded.
  const inspectionNews = [
    ['QBS-044', 'electrical', 'roughIn', OWNER],
    ['QBS-002', 'electrical', 'roughIn', OFFICE],
    ['QBS-011', 'plumbing', 'roughIn', OFFICE],
    ['QBS-036', 'electrical', 'roughIn', OWNER],
    ['QBS-009', 'electrical', 'final', OWNER],
    ['QBS-040', 'hvac', 'final', OFFICE],
  ]
  for (const [jobId, trade, phase, account] of inspectionNews) {
    const job = byId.get(jobId)
    const result = job.insp[trade][phase]
    const recorded = job.insp[trade][`${phase}Date`] ?? job.insp[trade][`${phase}FailDate`]
    const daysAgo = daysBetween(recorded, day(0))
    const activity = inspectionActivity(job, trade, phase, result)
    const when = at(daysAgo, 13)
    notify({ type: activity.type, msg: activity.msg, jobId, ...scoped(jobId), createdBy: account.uid, createdByEmail: account.email, createdAt: when, read: daysAgo > 2 })
    record({ type: 'inspection', action: activity.action, summary: activity.summary, jobId, ...actorFields(account), createdAt: when })
  }

  for (const jobId of ['VBG-002', 'PEM-002']) {
    const job = byId.get(jobId)
    const activity = jobActivity(job, OWNER)
    const when = at(Math.max(4, -daysBetween(day(0), job.start)), 10)
    notify({ type: activity.type, msg: activity.msg, jobId, ...scoped(jobId), createdBy: OWNER.uid, createdByEmail: OWNER.email, createdAt: when, read: true })
    record({ type: 'job', action: activity.action, summary: activity.summary, jobId, ...actorFields(OWNER), createdAt: when })
  }

  const plainNews = [
    ['warn', 'Lena Ocampo has an expired insurance certificate. Do not assign work until it is renewed.', null, 20, false],
    ['warn', 'Mara Quintero has no W9 on file, so a 1099 cannot be issued.', null, 30, false],
    ['warn', 'QBS-013 permit applications are with the city. Review takes two to three weeks.', 'QBS-013', 50, false],
    ['warn', 'QBS-012 is blocked until the framing inspection passes.', 'QBS-012', 6, false],
    ['info', 'QBS-003 service release passed. The final walkthrough can be booked.', 'QBS-003', 70, false],
    ['info', 'CO-007 is waiting for the builder to approve it: $4,700 (QBS-005)', 'QBS-005', 80, true],
    ['success', 'QBS-008 HVAC final passed', 'QBS-008', 100, true],
  ]
  for (const [type, msg, jobId, hours, read] of plainNews) {
    notify({ type, msg, jobId, ...scoped(jobId), createdBy: OFFICE.uid, createdByEmail: OFFICE.email, createdAt: hoursAgo(hours), read })
  }

  // ── Subs and materials ──
  const subs = Object.fromEntries(STATIC_SUBS.map((source) => {
    const sub = SUBS[source.id]
    return [sub.id, { ...shift(source), ...sub }]
  }))

  const materials = {}
  STATIC_MATERIALS.forEach((source, index) => {
    const item = ITEM_NAMES[source.item] ?? source.item
    materials[docKey(source.id)] = { ...shift(source), item, name: item, createdAt: at(30 + index * 4, 10) }
  })
  const newMaterials = [
    ['M-009', 'QBS-044', 'Plumbing rough in kit, two baths', 1, 'ea', 640, 'Ordered', 'Ferguson', -4, 2, 30],
    ['M-010', 'QBS-012', 'Meter base, 200A', 1, 'ea', 210, 'In Transit', 'Graybar', -6, -1, 140],
    ['M-011', 'QBS-036', '50A range receptacle', 2, 'ea', 34, 'Ordered', 'Graybar', -1, 3, 5],
    ['M-012', 'QBS-031', 'LED wafer lights, 6 inch', 24, 'ea', 19, 'At Job Site', 'Graybar', -9, -2, 200],
    ['M-013', 'PEM-002', 'Main distribution panel, 400A', 1, 'ea', 3850, 'Ordered', 'Graybar', -10, 18, 230],
    ['M-014', 'VBG-001', 'Condensing unit, 3 ton', 1, 'ea', 2950, 'Delivered', 'Johnstone', -12, -3, 260],
  ]
  for (const [id, job, item, qty, unit, cost, status, vendor, ordered, needed, hours] of newMaterials) {
    materials[docKey(id)] = {
      id, job, jobId: job, item, name: item, qty, unit, cost, status, vendor,
      dateOrdered: day(ordered), dateNeeded: day(needed), notes: '',
      ...author, createdAt: hoursAgo(hours),
    }
  }
  const materialMoves = [
    ['m-010', 'Ordered', 'In Transit', 2],
    ['m-012', 'Delivered', 'At Job Site', 3],
    ['m-014', 'In Transit', 'Delivered', 5],
  ]
  for (const [docId, fromStatus, toStatus, daysAgo] of materialMoves) {
    const material = materials[docId]
    record({ materialDocId: docId, materialName: material.name, jobId: material.jobId, fromStatus, toStatus, type: 'status_change', createdBy: OFFICE.uid, createdByEmail: OFFICE.email, createdAt: at(daysAgo, 15) })
  }

  // ── Submissions and replies ──
  const submits = {}
  const replies = {}
  const SUBMITS = [
    { key: 'sub-01', subject: 'Panel location on lot 14', category: 'RFI', priority: 'High', portal: 'Builder', qbsPM: 'Taylor Hensley', jobId: 'QBS-024', status: 'Open', hours: 20, by: BUILDER,
      body: 'The plans show the panel on the garage wall, but the framer put a window there. Where do you want it?', scope: { tenantId: 'qbs', clientUids: [] } },
    { key: 'sub-02', subject: 'HVAC final on QBS-020', category: 'Question', priority: 'Medium', portal: 'Builder', qbsPM: 'Derek Powers', jobId: 'QBS-020', status: 'In Progress', hours: 50, by: BUILDER,
      body: 'Can the HVAC final be called this week? The homeowner wants to move in on the first.', scope: { tenantId: 'qbs', clientUids: [] },
      replies: [['P2 Team', 'internal', 'We will call it in Wednesday morning and confirm the time with you.', 30]] },
    { key: 'sub-03', subject: 'When is the final walkthrough?', category: 'Schedule', priority: 'Medium', portal: 'Client', clientName: CLIENT.displayName, jobId: 'QBS-003', status: 'Open', hours: 30, by: CLIENT,
      body: 'Our buyers would like to see the house next week. When can we walk it with you?' },
    { key: 'sub-04', subject: 'Extra outlet in the kitchen island', category: 'Change Request', priority: 'Medium', portal: 'Client', clientName: CLIENT.displayName, jobId: 'QBS-024', status: 'Resolved', hours: 160, by: CLIENT,
      body: 'Please add a second outlet on the island facing the dining room.',
      replies: [['P2 Team', 'internal', 'Added to change order CO-2026-017 with the under cabinet lighting.', 140], [CLIENT.displayName, 'client', 'Thank you, that works for us.', 130]] },
    { key: 'sub-05', subject: 'Transfer switch is backordered', category: 'Issue', priority: 'Critical', portal: 'P2', jobId: 'QBS-005', status: 'Open', hours: 8, by: OFFICE,
      body: 'Graybar says the generator transfer switch ships in three weeks. The service release is waiting on it.' },
    { key: 'sub-06', subject: 'Checklist for the Vision jobs', category: 'Other', priority: 'Low', portal: 'P2', jobId: null, status: 'In Progress', hours: 90, by: OFFICE,
      body: 'Draft the rough in checklist the Vision coordinators asked for.',
      replies: [['P2 Team', 'internal', 'First draft is in the shared folder.', 60]] },
  ]
  for (const s of SUBMITS) {
    const scope = s.scope ?? (s.jobId ? stampFor(s.jobId) : {})
    submits[s.key] = {
      subject: s.subject, category: s.category, priority: s.priority, body: s.body, portal: s.portal, status: s.status, jobId: s.jobId,
      ...(s.qbsPM ? { qbsPM: s.qbsPM } : {}),
      ...(s.clientName ? { clientName: s.clientName } : {}),
      ...scope,
      createdBy: s.by.uid, createdByEmail: s.by.email, createdAt: hoursAgo(s.hours),
    }
    if (s.replies) {
      replies[`submits/${s.key}/replies`] = Object.fromEntries(s.replies.map(([authorName, authorRole, body, hours], i) => [`reply-${i + 1}`, {
        body, author: authorName, authorRole, createdBy: authorRole === 'client' ? CLIENT.uid : OFFICE.uid, createdAt: hoursAgo(hours),
      }]))
    }
  }

  // ── Daily reports ──
  const REPORTS = [
    [1, 'Austin', 'QBS-044', 'Rough-In', ['circuits', 'boxes'], 'None', true, 'Plumbing rough in is next. Electrical is ready.', '12/2 wire, one box of staples', ''],
    [1, 'Tony', 'QBS-031', 'Rough-In', ['circuits', 'boxes', 'panel'], 'None', true, 'Ready for the electrical rough in inspection.', 'Two boxes of wire nuts', ''],
    [1, 'Marvin', 'QBS-012', 'Rough-In', ['boxes'], 'Waiting on other trade', false, 'Framing has to pass before the service is set.', '', ''],
    [1, 'Trevor', 'QBS-036', 'Trim', ['devices', 'fixtures'], 'Material missing', false, 'Need the range receptacle before trim is finished.', '', '50A range receptacle'],
    [2, 'Trent', 'QBS-022', 'Service Release', ['service'], 'Inspection needed', null, 'Service release inspection requested for Thursday.', '', ''],
    [2, 'Austin', 'QBS-028', 'Trim', ['devices'], 'None', true, 'Trim is complete on the first floor.', 'Twenty devices', ''],
    [3, 'Ty', 'QBS-020', 'Rough-In', ['circuits'], 'Owner decision', false, 'The owner is deciding where the island outlet goes.', '', ''],
    [3, 'Tony', 'QBS-005', 'Service Release', ['service', 'panel'], 'None', null, 'The transfer switch is still on order.', '', 'Generator transfer switch'],
    [4, 'Marvin', 'QBS-029', 'Rough-In', ['circuits', 'boxes'], 'None', true, 'Ready for rough in.', '', ''],
    [5, 'Trevor', 'QBS-040', 'Final', ['fixtures'], 'Inspection needed', false, 'HVAC final failed. The HVAC sub is fixing the condensate line.', '', ''],
    [6, 'Ty', 'QBS-003', 'Final', ['devices', 'fixtures'], 'None', true, 'Punch list walk with the builder next week.', '', ''],
    [0, 'Austin', 'PEM-001', 'Trim', ['devices'], 'None', null, 'Started trim on the upstairs bedrooms.', '', ''],
  ]
  const dailyReports = Object.fromEntries(REPORTS.map(([daysAgo, crewMember, jobId, phase, workCompleted, blocker, inspectionReady, nextStep, materialsUsed, materialsNeeded], i) => [
    `report-${String(i + 1).padStart(2, '0')}`,
    {
      crewMember, jobId, jobName: byId.get(jobId).name, date: day(-daysAgo), phase, workCompleted, photoUrls: [],
      materialsUsed, materialsNeeded, blocker, inspectionReady, nextStep,
      createdBy: OFFICE.uid, createdByEmail: OFFICE.email, createdAt: daysAgo === 0 ? hoursAgo(1) : at(daysAgo, 16, 30),
    },
  ]))

  // ── Urgent items, alerts and crew scores ──
  const urgentItems = {
    'urgent-1': { title: 'Generator transfer switch backordered', detail: 'The QBS-005 service release waits on it.', jobId: 'QBS-005', resolved: false, ...author, createdAt: hoursAgo(9) },
    'urgent-2': { title: 'Framing inspection holding the QBS-012 service', detail: 'Ask the builder for the new inspection date.', jobId: 'QBS-012', resolved: false, ...author, createdAt: hoursAgo(28) },
    'urgent-3': { title: 'Meter not set at the PEM-002 site', detail: 'The co op promised it for this week.', jobId: 'PEM-002', resolved: true, ...author, createdAt: at(5, 8) },
  }

  const ALERTS = [
    ['QBS-040', 'inspection_failed', 'critical', 'open', 'HVAC final failed', 'The HVAC final failed on the condensate line.', 'Schedule the HVAC sub to correct it and call the final again.', 2],
    ['QBS-011', 'inspection_failed', 'critical', 'open', 'Plumbing rough in failed', 'The drain slope failed the plumbing rough in.', 'Rework the slope and call the rough in again.', 3],
    ['QBS-025', 'stalled', 'warning', 'snoozed', 'No update in over a week', 'The service is built and waits for its release.', 'Ask the PM for the release date.', 5],
    ['QBS-008', 'billing_ready', 'warning', 'open', 'Ready to bill', 'The HVAC final passed and the job is not invoiced.', 'Submit the final invoice.', 2],
    ['QBS-016', 'no_next_action', 'info', 'resolved', 'No next action set', 'The job had no next action.', 'Set the next action with the PM.', 6],
  ]
  const agentAlerts = Object.fromEntries(ALERTS.map(([jobId, type, severity, status, title, description, recommendation, daysAgo]) => {
    const job = byId.get(jobId)
    const id = `${jobId}_${type}`
    const created = daysAgo < 1 ? hoursAgo(daysAgo * 24) : at(daysAgo, 7, 30)
    return [id, {
      id, jobId, jobName: job.name, type, severity, status, title: `${title}: ${job.name} (${jobId})`, description, recommendation,
      pm: job.pm, zoneId: job.zoneId,
      // A snooze ends tomorrow. It is written as the screen writes it, as text.
      ...(status === 'snoozed' ? { snoozeUntil: iso(hoursAgo(-20)) } : {}),
      ...(status === 'resolved' ? { resolvedAt: iso(hoursAgo(30)) } : {}),
      createdAt: created,
    }]
  }))

  const crewScores = Object.fromEntries([
    ['Austin', 'Lead Electrician', 3, 1, 20, 'Stayed late to finish the service at lot 12.'],
    ['Tony', 'Electrician', 2, 0, 0, ''],
    ['Marvin', 'Electrician', 1, 1, 10, 'Caught a missing ground before the inspection.'],
    ['Trent', 'Apprentice', 0, 0, 5, 'Kept the truck stocked all month.'],
    ['Ty', 'Apprentice', 1, 0, 0, ''],
    ['Trevor', 'Field Tech', 0, 1, 15, 'Covered a weekend service call.'],
  ].map(([name, role, googleReviews, referrals, bonusPoints, bonusNote]) => [name.toLowerCase(), {
    name, id: name.toLowerCase(), role, googleReviews, referrals, bonusPoints, bonusNote, createdAt: at(60), updatedAt: at(2),
  }]))

  // ── Supplier invoices and permits ──
  const lineFor = (desc, qty, unit, unitPrice) => ({ desc, qty, unit, unitPrice, extPrice: Math.round(qty * unitPrice * 100) / 100 })
  const invoice = (key, vendor, invoiceNum, daysAgo, jobId, lineItems, status, flags, notes = '') => [key, {
    vendor, invoiceNum, invoiceDate: day(-daysAgo), jobId, lineItems,
    total: Math.round(lineItems.reduce((sum, line) => sum + line.extPrice, 0) * 100) / 100,
    notes, status, flags, ...author, createdAt: at(daysAgo, 12), updatedAt: at(Math.max(0, daysAgo - 1), 12),
  }]
  const supplierInvoices = Object.fromEntries([
    invoice('inv-1', 'Graybar', 'GB-20418', 14, 'QBS-001', [lineFor('200A Main Panel Square D', 1, 'EA', 485), lineFor('12/2 Romex Wire 250ft', 4, 'ROLL', 189)], 'approved', []),
    invoice('inv-2', 'Johnstone', 'JS-77120', 9, 'QBS-003', [lineFor('Carrier 5 Ton RTU Unit', 2, 'EA', 5250)], 'pending-review', [
      { type: 'price-variance', severity: 'warning', message: '"Carrier 5 Ton RTU Unit": billed $5,250.00 vs PO $4,200.00 (+25%)' },
    ]),
    invoice('inv-3', 'Ferguson', 'FG-55102', 21, 'QBS-009', [lineFor('Rheem 50 Gallon Water Heater', 2, 'EA', 890)], 'paid', []),
    invoice('inv-4', 'ADT Supply', 'AS-3391', 6, 'QBS-013', [lineFor('Fire Alarm Control Panel', 1, 'EA', 3200), lineFor('Freight', 2, 'LS', 145)], 'disputed', [], 'Freight was charged twice.'),
    invoice('inv-5', 'Graybar', 'GB-20418', 3, 'QBS-005', [lineFor('GFCI Outlets 15A x12', 12, 'EA', 24)], 'pending-review', [
      { type: 'duplicate', severity: 'critical', message: 'Duplicate invoice #GB-20418 from Graybar already exists' },
    ]),
    invoice('inv-6', 'Ferguson', 'FG-55190', 2, null, [lineFor('Copper pipe, type L, 20 sticks', 25, 'STICK', 650)], 'pending-review', [
      { type: 'no-job', severity: 'warning', message: 'Invoice not assigned to a job, so it cannot be checked against the POs' },
      { type: 'high-value', severity: 'warning', message: 'High value invoice ($16,250.00) needs manager approval before payment' },
    ]),
  ])

  const permits = Object.fromEntries([
    ['permit-1', 'VBG-001', 'hvac', 'applied', 4],
    ['permit-2', 'PEM-002', 'electrical', 'applied', 9],
    ['permit-3', 'QBS-013', 'plumbing', 'applied', 20],
  ].map(([key, jobId, trade, status, daysAgo]) => [key, {
    jobId, trade, status, county: byId.get(jobId).county, appliedOn: day(-daysAgo), ...author, createdAt: at(daysAgo, 11),
  }]))

  return {
    users,
    config,
    jobs,
    extras,
    notifications,
    history,
    subs,
    materials,
    submits,
    ...replies,
    daily_reports: dailyReports,
    urgent_items: urgentItems,
    agent_alerts: agentAlerts,
    crew_scores: crewScores,
    supplier_invoices: supplierInvoices,
    permits,
  }
}
