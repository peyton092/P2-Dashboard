import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { buildSeed, DEMO_SEED_VERSION } from '../seed'
import { DEMO_USERS } from '../users'
import { extraState } from '../../lib/extraStatus'
import { subJobKey, subInsuranceState } from '../../lib/subs'
import { daysSince, toLocalDateStr } from '../../lib/dates'
import { classifyRisk } from '../../agent/scoring'
import { sumInvoices } from '../../lib/money'
import { STATIC_JOBS, STATIC_SUBS, OLD_PM_MAP } from '../../../scripts/demo-data.mjs'

// The sample data the demo opens with. Every screen of every role needs something to
// show, through the very queries the app builds, so the seed is loaded into a store and
// read back with queryFor from useFirestore.js, the function the data hooks use. The
// rest pins what the sample text may and may not hold.

const NOW = vi.hoisted(() => new Date(2026, 9, 19, 10, 0, 0))

vi.mock('firebase/firestore', () => import('../shims/firestore'))
vi.mock('firebase/functions', () => import('../shims/functions'))
vi.mock('../../firebase', async () => {
  const { firestoreOver } = await import('../shims/firestore')
  const { createDemoStore } = await import('../store')
  const seed = await import('../seed')
  const store = createDemoStore({ seed: () => seed.buildSeed(NOW), version: seed.DEMO_SEED_VERSION })
  return { db: firestoreOver(store), auth: { currentUser: null }, functions: {}, storage: {} }
})

import { onSnapshot } from 'firebase/firestore'
import { queryFor } from '../../hooks/useFirestore'

const seed = buildSeed(NOW)
const docsOf = (path) => Object.entries(seed[path] ?? {}).map(([id, data]) => ({ id, ...data }))

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
})

afterAll(() => {
  vi.useRealTimers()
})

// The rows a query gives, as a hook would receive them.
async function rowsOf(q) {
  let rows = null
  const stop = onSnapshot(q, (snap) => { rows = snap.docs.map((d) => ({ _docId: d.id, ...d.data() })) })
  await vi.advanceTimersByTimeAsync(0)
  stop()
  return rows
}

const SCOPES = {
  owner: { role: 'owner', tenantId: 'p2-core', uid: DEMO_USERS.owner.uid },
  internal: { role: 'internal', tenantId: 'qbs', uid: DEMO_USERS.internal.uid },
  builder: { role: 'builder', tenantId: 'qbs', uid: DEMO_USERS.builder.uid },
  client: { role: 'client', tenantId: null, uid: DEMO_USERS.client.uid },
}

const SCOPED = ['jobs', 'extras', 'notifications', 'submits']

// Every string anywhere in a value, with where it was found.
function stringsIn(value, where = '') {
  if (typeof value === 'string') return [[where, value]]
  if (Array.isArray(value)) return value.flatMap((item, i) => stringsIn(item, `${where}[${i}]`))
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.entries(value).flatMap(([key, inner]) => [[`${where}.${key} (key)`, key], ...stringsIn(inner, `${where}.${key}`)])
  }
  return []
}

const allStrings = stringsIn(seed)

describe('what each role sees', () => {
  it.each(Object.keys(SCOPES).flatMap((role) => SCOPED.map((list) => [role, list])))(
    'the %s reads a %s list that is not empty, through the query the app builds',
    async (role, list) => {
      const rows = await rowsOf(queryFor(list, SCOPES[role]))
      expect(rows.length).toBeGreaterThan(0)
    },
  )

  it('shows the builder exactly the qbs jobs, while other tenants have jobs too', async () => {
    const rows = await rowsOf(queryFor('jobs', SCOPES.builder))
    const qbs = docsOf('jobs').filter((j) => j.tenantId === 'qbs')
    expect(rows.map((j) => j.id).sort()).toEqual(qbs.map((j) => j.id).sort())
    expect(new Set(docsOf('jobs').map((j) => j.tenantId))).toEqual(new Set(['qbs', 'vision', 'p2-core']))
    expect(rows.every((j) => j.tenantId === 'qbs')).toBe(true)
  })

  it('shows the client exactly the jobs their claims name, and what hangs off only those', async () => {
    const jobs = await rowsOf(queryFor('jobs', SCOPES.client))
    expect(jobs.map((j) => j.id).sort()).toEqual([...DEMO_USERS.client.claims.clientJobIds].sort())
    const own = new Set(jobs.map((j) => j.id))
    const extras = await rowsOf(queryFor('extras', SCOPES.client))
    expect(extras.every((e) => own.has(e.job))).toBe(true)
    const notifications = await rowsOf(queryFor('notifications', SCOPES.client))
    expect(notifications.every((n) => own.has(n.jobId))).toBe(true)
    const submits = await rowsOf(queryFor('submits', SCOPES.client))
    expect(submits.every((s) => own.has(s.jobId))).toBe(true)
  })

  it('gives staff the whole of each list', async () => {
    for (const list of SCOPED) {
      const rows = await rowsOf(queryFor(list, SCOPES.owner))
      expect(rows.length, list).toBe(docsOf(list).length)
    }
  })

  it('has a users document for each demo account, as the functions write them', () => {
    for (const account of Object.values(DEMO_USERS)) {
      expect(seed.users[account.uid]).toMatchObject({
        email: account.email, displayName: account.displayName, role: account.claims.role, tenantId: account.claims.tenantId,
      })
    }
    expect(seed.users[DEMO_USERS.client.uid].clientJobIds).toEqual(DEMO_USERS.client.claims.clientJobIds)
  })
})

describe('what the screens need', () => {
  it('has change orders in every status, each with line items and a total', () => {
    const extras = docsOf('extras')
    expect(new Set(extras.map(extraState))).toEqual(new Set(['draft', 'pending', 'approved', 'rejected']))
    for (const e of extras) {
      expect(e.lineItems.length, e.id ?? e.coNumber).toBeGreaterThan(0)
      expect(e.total, e.id ?? e.coNumber).toBeGreaterThan(0)
      expect(typeof e.date).toBe('string')
    }
    expect(extras.filter((e) => e.status === 'Sent to Builder').length).toBeGreaterThan(1)
    expect(extras.find((e) => e.status === 'Rejected').rejectNotes).toBeTruthy()
  })

  it('stamps every change order that was sent with its job scope, and no draft', () => {
    const jobs = new Map(docsOf('jobs').map((j) => [j.id, j]))
    for (const e of docsOf('extras')) {
      if (extraState(e) === 'draft') {
        expect(e.tenantId, e.coNumber).toBeUndefined()
      } else {
        expect(e.tenantId, e.id ?? e.coNumber).toBe(jobs.get(e.job).tenantId)
        expect(e.clientUids).toEqual(jobs.get(e.job).clientUids)
      }
    }
  })

  it('has inspections passed, failed, scheduled and waiting', () => {
    const results = new Set(docsOf('jobs').flatMap((j) => Object.values(j.insp).flatMap((trade) => Object.values(trade))))
    for (const status of ['passed', 'failed', 'scheduled', 'pending-verification', 'not-started']) expect(results).toContain(status)
  })

  it('has jobs ready to bill, invoiced, part paid, paid and on hold, and some blocked or at risk', () => {
    const jobs = docsOf('jobs')
    const statuses = new Set(jobs.map((j) => j.billingStatus))
    for (const status of ['not-invoiced', 'invoiced', 'partial-pay', 'paid', 'hold']) expect(statuses).toContain(status)
    expect(jobs.some((j) => j.status === 'blocked')).toBe(true)
    expect(jobs.some((j) => j.status === 'at-risk')).toBe(true)
    expect(jobs.some((j) => j.nextAction)).toBe(true)
  })

  it('fills every staff collection, each document with the field the app orders it by', () => {
    for (const path of ['materials', 'daily_reports', 'urgent_items', 'history', 'agent_alerts', 'supplier_invoices', 'permits']) {
      const docs = docsOf(path)
      expect(docs.length, path).toBeGreaterThan(2)
      expect(docs.every((d) => d.createdAt), path).toBe(true)
    }
    for (const path of ['notifications', 'submits']) expect(docsOf(path).every((d) => d.createdAt), path).toBe(true)
    expect(docsOf('subs').length).toBeGreaterThan(5)
    expect(Object.keys(seed['config'].settings).length).toBeGreaterThan(0)
    expect(Object.keys(seed.crew_scores).sort()).toEqual(['austin', 'marvin', 'tony', 'trent', 'trevor', 'ty'])
  })

  it('has requests with replies in the submissions', () => {
    const replies = Object.keys(seed).filter((path) => /^submits\/[^/]+\/replies$/.test(path))
    expect(replies.length).toBeGreaterThan(1)
    expect(new Set(docsOf('submits').map((s) => s.portal))).toEqual(new Set(['Builder', 'Client', 'P2']))
  })

  it('has daily reports from yesterday, so the briefing and the inspection gate have something to read', () => {
    const yesterday = toLocalDateStr(new Date(2026, 9, 18))
    const fromYesterday = docsOf('daily_reports').filter((r) => r.date === yesterday)
    expect(fromYesterday.length).toBeGreaterThan(2)
    expect(fromYesterday.length).toBeLessThan(6)
  })

  it('names, on each job, subs that are on the roster', () => {
    const roster = new Set(docsOf('subs').map(subJobKey))
    for (const job of docsOf('jobs')) {
      for (const name of Object.values(job.subs)) if (name !== null) expect(roster, `${job.id} ${name}`).toContain(name)
    }
  })

  it('uses the project managers and the crew the app itself lists', () => {
    const pms = ['Blake Neblett', 'Brendan Embry', 'Jeb Brooks', 'Taylor Hensley', 'Tim King', 'Derek Powers']
    const crew = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']
    for (const job of docsOf('jobs')) {
      expect(pms, job.id).toContain(job.pm)
      expect(crew, job.id).toContain(job.lead)
    }
    for (const report of docsOf('daily_reports')) expect(crew).toContain(report.crewMember)
  })
})

describe('the operating picture the owner opens to', () => {
  // What the Command Center and the sidebar make of the seed, with the app's own rules
  // (CommandCenter.jsx, agent/scoring.js, lib/money.js, lib/subs.js): a healthy business
  // with some real work to do.
  const jobs = docsOf('jobs')
  const active = jobs.filter((j) => !['complete', 'completed'].includes(j.status))
  const stale = (j) => daysSince(j.lastStatusChange || j.start, NOW)
  const phases = (j) => Object.values(j.insp).flatMap((trade) => Object.entries(trade).filter(([phase]) => !phase.endsWith('Date')).map(([, s]) => s))

  it('asks for action on about twenty things, in each of the four kinds', () => {
    const atRisk = active.filter((j) => ['at-risk', 'blocked', 'needs-action'].includes(j.status) || stale(j) >= 7)
    const awaiting = active.filter((j) => phases(j).some((s) => s === 'scheduled' || s === 'pending-verification'))
    const missingDocs = active.filter((j) => !j.permitNumber || Object.values(j.permits).some((s) => s === 'pending' || s === 'applied'))
    const builderApproval = docsOf('extras').filter((e) => e.status === 'Sent to Builder' || e.status === 'pending')
    const counts = [atRisk, awaiting, missingDocs, builderApproval].map((list) => list.length)
    for (const count of counts) expect(count).toBeGreaterThan(0)
    expect(counts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(22)
  })

  it('has most jobs on track and updated in the last two days, a handful at risk, and two or three critical', () => {
    const levels = active.map((j) => classifyRisk(j, NOW)?.level ?? 'none')
    const count = (level) => levels.filter((l) => l === level).length
    expect(count('critical')).toBeGreaterThanOrEqual(2)
    expect(count('critical')).toBeLessThanOrEqual(3)
    expect(count('warning')).toBeGreaterThanOrEqual(3)
    expect(count('warning')).toBeLessThanOrEqual(6)
    expect(active.filter((j) => j.status === 'on-track').length).toBeGreaterThan(active.length / 2)
    expect(active.filter((j) => stale(j) <= 2).length).toBeGreaterThan(active.length * 0.8)
  })

  it('has most targets ahead and a few passed', () => {
    const passed = active.filter((j) => daysSince(j.target, NOW) > 0)
    expect(passed.length).toBeGreaterThan(0)
    expect(passed.length).toBeLessThanOrEqual(3)
  })

  it('has a few invoices dated this month, every one with its amount', () => {
    const thisMonth = jobs.filter((j) => typeof j.invoiceDate === 'string' && j.invoiceDate.startsWith('10/') && j.invoiceDate.endsWith('/2026'))
    expect(thisMonth.length).toBeGreaterThanOrEqual(3)
    expect(thisMonth.length).toBeLessThanOrEqual(6)
    expect(sumInvoices(thisMonth)).toEqual({ total: expect.any(Number), missing: 0 })
    expect(sumInvoices(thisMonth).total).toBeGreaterThan(20000)
    expect(sumInvoices(jobs.filter((j) => j.invoiceDate)).missing).toBe(0)
  })

  it('has one inspection failed, a few booked or waiting, and the rest passed or not yet due', () => {
    const all = jobs.flatMap(phases)
    expect(all.filter((s) => s === 'failed')).toHaveLength(1)
    expect(all.filter((s) => s === 'scheduled').length).toBeGreaterThanOrEqual(3)
    expect(all.filter((s) => s === 'passed').length).toBeGreaterThan(all.filter((s) => s === 'scheduled' || s === 'pending-verification').length * 5)
  })

  it('has the inspections that are booked, waiting or failed where the plan puts them', () => {
    const job = (id) => jobs.find((j) => j.id === id)
    expect(job('QBS-044').insp.plumbing.roughIn).toBe('scheduled')
    expect(job('QBS-044').insp.electrical.roughIn).toBe('passed')
    expect(job('QBS-022').insp.hvac.roughIn).toBe('scheduled')
    expect(job('QBS-040').insp.hvac.final).toBe('scheduled')
    expect(job('QBS-003').insp.electrical).toMatchObject({ trim: 'passed', final: 'scheduled' })
    expect(job('QBS-038').insp.electrical.trim).toBe('pending-verification')
    expect(job('QBS-011').insp.plumbing).toMatchObject({ roughIn: 'failed', roughInDate: '2026-10-16' })
    // Every passed phase has its day, and none is after today.
    for (const j of jobs) {
      for (const [trade, phases] of Object.entries(j.insp)) {
        for (const [phase, status] of Object.entries(phases)) {
          if (status !== 'passed') continue
          expect(phases[`${phase}Date`], `${j.id} ${trade} ${phase}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(phases[`${phase}Date`] <= '2026-10-19', `${j.id} ${trade} ${phase}`).toBe(true)
        }
      }
    }
  })

  it('has most sub insurance current, one or two expiring soon and one expired', () => {
    const states = docsOf('subs').map((s) => subInsuranceState(s))
    expect(states.filter((s) => s === 'expired')).toHaveLength(1)
    const soon = states.filter((s) => s === 'expiring-30' || s === 'expiring-60').length
    expect(soon).toBeGreaterThanOrEqual(1)
    expect(soon).toBeLessThanOrEqual(2)
    expect(states.filter((s) => s === 'valid').length).toBeGreaterThan(states.length / 2)
  })
})

describe('the dates', () => {
  it('dates every job from today, so a later day moves its dates by as many days', () => {
    const changes = docsOf('jobs').map((j) => j.lastStatusChange).filter(Boolean).sort()
    expect(changes[changes.length - 1]).toBe('2026-10-19')
    const later = buildSeed(new Date(2026, 9, 26, 10, 0, 0))
    const before = seed.jobs['job-qbs-001']
    const after = later.jobs['job-qbs-001']
    const days = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000)
    for (const field of ['start', 'target', 'lastStatusChange']) expect(days(before[field], after[field]), field).toBe(7)
    expect(days(before.insp.electrical.roughInDate, after.insp.electrical.roughInDate)).toBe(7)
  })

  it('is the same seed each time for the same day, so a reset gives back what the demo opened with', () => {
    expect(buildSeed(NOW)).toEqual(seed)
    expect(DEMO_SEED_VERSION).toBeTruthy()
  })

  it('dates nothing after now', () => {
    const times = Object.values(seed).flatMap((docs) => Object.values(docs)).flatMap((doc) =>
      Object.values(doc).filter((v) => v && typeof v.toMillis === 'function'))
    expect(times.length).toBeGreaterThan(50)
    expect(times.every((t) => t.toMillis() <= NOW.getTime())).toBe(true)
  })
})

describe('the sample text', () => {
  it('holds no Unicode dash in any string', () => {
    const found = allStrings.filter(([, s]) => /[\u2010-\u2015\u2212]/.test(s))
    expect(found).toEqual([])
  })

  it('uses no hyphen as punctuation, next to a space or doubled', () => {
    const found = allStrings.filter(([, s]) => /(^|\s)-|-(\s|$)|--/.test(s))
    expect(found).toEqual([])
  })

  it('holds nothing about Firebase, no key and nothing that looks like a credential or a token', () => {
    expect(allStrings.filter(([, s]) => /firebase|AIzaSy/i.test(s))).toEqual([])
    expect(allStrings.filter(([, s]) => /token|password|secret|api.?key/i.test(s))).toEqual([])
    expect(Object.keys(seed).filter((path) => /qb_config|cc_config|fcm_tokens/.test(path))).toEqual([])
  })

  it('keeps none of the names, clients and contacts of the emulator data, only the rosters the app lists', () => {
    const rosters = new Set(['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor'])
    const old = [
      ...STATIC_JOBS.flatMap((j) => [j.name, j.client.split(' ')[0]]),
      ...STATIC_SUBS.flatMap((s) => s.name.split(' ')),
      ...Object.keys(OLD_PM_MAP).flatMap((pm) => pm.split(' ')),
      'Torres', 'Moreno', 'Delgado', 'Castillo', 'Enclave',
    ].filter((word) => word && !rosters.has(word) && !['P2', 'In-House', 'Crew'].includes(word))
    const words = new Set(old)
    const found = allStrings.filter(([where, s]) => !where.includes('crewMember') && s.split(/[^A-Za-z]+/).some((w) => words.has(w)))
    expect(found).toEqual([])
  })
})
