import { useMemo } from 'react'
import { useData } from '../DataContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertTriangleIcon, CheckCircleIcon, DollarSignIcon,
  UsersIcon, MapPinIcon, ClockIcon, AlertCircleIcon,
  BrainCircuitIcon, ActivityIcon, XCircleIcon,
  CalendarIcon, ZapIcon, TrendingUpIcon,
} from 'lucide-react'

const O = '#F47920'

const TODAY = new Date()
const _yd = new Date(TODAY)
_yd.setDate(_yd.getDate() - 1)
const YESTERDAY_STR = _yd.toISOString().slice(0, 10)
const CREW_LIST = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']

const daysSince = (date) => {
  if (!date) return null
  try {
    const d = date?.toDate ? date.toDate() : new Date(date)
    if (isNaN(d.getTime())) return null
    return Math.floor((TODAY - d) / 86400000)
  } catch { return null }
}

const jobLabel = (j) => j.name || j.client?.split(' ')[0] || j.id

const PM_ZONES = {
  'Blake Neblett':   'Zone 1',
  'Brendan Embry':   'Zone 2',
  'Jeb Brooks':      'Zone 3',
  'Taylor Hensley':  'Zone 4',
  'Tim King':        'Zone 5',
  'Derek Powers':    'Zone 6',
}

const TYPE_ESTIMATE = {
  'New Construction MEP':            28000,
  'Full MEP Renovation':             22000,
  'Commercial MEP Buildout':         35000,
  'Commercial HVAC Retrofit':        20000,
  'Electrical Rewire + HVAC':        18000,
  'HVAC + Electrical Upgrade':       16000,
  'Residential Full Rewire':         14000,
  'HVAC + Plumbing Renovation':      15000,
  'Plumbing + Electrical Upgrade':   16000,
  'Full MEP New Build':              30000,
  'HVAC System Replacement':         12000,
  'Residential MEP Upgrade':         18000,
  'Electrical + Plumbing Renovation':15000,
  'Electrical + HVAC Upgrade':       17000,
  'Electrical Full Rewire':          13000,
  'HVAC + Plumbing':                 14000,
}

const fmt$ = (n) => '$' + Number(n).toLocaleString()

const cleanPhase = (phase) => {
  if (!phase) return '—'
  return phase
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Priority classification ────────────────────────────────────────────────────

function classifyJob(job, allMaterials) {
  const insp = job.insp || {}
  const stale = daysSince(job.lastStatusChange || job.start)
  const isActive = !['complete', 'completed'].includes(job.status)

  if (!isActive) return null

  // CRITICAL: failed inspection
  const hasFailed = Object.values(insp).some(t =>
    Object.values(t || {}).some(s => s === 'failed')
  )
  if (hasFailed) {
    return {
      tier: 'critical',
      color: '#ef4444',
      label: 'FAILED INSPECTION',
      action: 'Schedule rework — contact PM + crew immediately',
      priority: 1,
    }
  }

  // STALLED: no update in 48h+
  if (stale !== null && stale >= 2 && job.status !== 'pending') {
    return {
      tier: 'stalled',
      color: stale >= 7 ? '#ef4444' : O,
      label: stale >= 7 ? `STALLED ${stale}d` : `STALLED ${stale}d`,
      action: `No update in ${stale} day${stale !== 1 ? 's' : ''} — get field status from PM`,
      priority: stale >= 7 ? 2 : 3,
    }
  }

  // DISPATCH RISK: crew assigned but any job material not delivered
  const jobMats = (allMaterials || []).filter(m => m.job === job.id)
  const hasMaterialIssue = jobMats.some(m =>
    !['delivered', 'on_site'].includes(m.status)
  )
  if (hasMaterialIssue && jobMats.length > 0) {
    return {
      tier: 'dispatch-risk',
      color: '#eab308',
      label: 'DISPATCH RISK',
      action: 'Confirm material delivery before dispatching crew',
      priority: 4,
    }
  }

  // MONEY AT RISK: near final phase, billing not prepared
  if ((job.progress || 0) >= 67 && job.billingStatus === 'not-invoiced') {
    return {
      tier: 'billing',
      color: O,
      label: 'MONEY AT RISK',
      action: 'Near final phase — prepare 30% billing now',
      priority: 5,
    }
  }

  // READY: all rough-in inspections passed, at least one final pending
  const allRoughPassed = ['electrical', 'plumbing', 'hvac'].every(trade => {
    const t = insp[trade]
    if (!t) return true
    const r = t.roughIn
    return r === 'passed' || r === 'n/a'
  })
  const hasPendingNext = Object.values(insp).some(t =>
    t?.final === 'pending' || t?.trim === 'pending'
  )
  if (allRoughPassed && hasPendingNext) {
    return {
      tier: 'ready',
      color: '#22c55e',
      label: 'READY — INSPECT',
      action: 'All prerequisites met — call in inspection today',
      priority: 6,
    }
  }

  return null
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function CommandCenter() {
  const { jobs, dailyReports, materials } = useData()

  const activeJobs = useMemo(() =>
    jobs.filter(j => !['complete', 'completed'].includes(j.status)),
    [jobs]
  )

  // A. Priority jobs
  const priorityJobs = useMemo(() =>
    activeJobs
      .map(j => ({ ...j, _class: classifyJob(j, materials), _stale: daysSince(j.lastStatusChange || j.start) }))
      .filter(j => j._class !== null)
      .sort((a, b) => (a._class.priority || 99) - (b._class.priority || 99)),
    [activeJobs, materials]
  )

  // B. Stalled jobs (48h+ no update)
  const stalledJobs = useMemo(() =>
    activeJobs
      .filter(j => j.status !== 'pending')
      .map(j => ({ ...j, staleDays: daysSince(j.lastStatusChange || j.start) }))
      .filter(j => j.staleDays !== null && j.staleDays >= 2)
      .sort((a, b) => b.staleDays - a.staleDays),
    [activeJobs]
  )

  // C. Billing ready queue
  const billingQueue = useMemo(() =>
    jobs
      .filter(j => {
        if (['paid'].includes(j.billingStatus)) return false
        if (['complete', 'completed'].includes(j.status) && j.billingStatus === 'invoiced') return false
        const insp = j.insp || {}
        return Object.values(insp).some(t => t?.final === 'passed')
      })
      .map(j => {
        const base = TYPE_ESTIMATE[j.type] || 18000
        const est = j.billingStatus === 'invoiced' ? base * 0.3 : base * 0.3
        return { ...j, _est: est }
      }),
    [jobs]
  )

  // D. No-next-action jobs
  const classifiedIds = useMemo(() => new Set(priorityJobs.map(j => j.id)), [priorityJobs])
  const noNextActionJobs = useMemo(() =>
    activeJobs.filter(j =>
      !classifiedIds.has(j.id) &&
      !['pending', 'complete', 'completed'].includes(j.status)
    ),
    [activeJobs, classifiedIds]
  )

  // E. Crew status
  const submittedYesterday = useMemo(() =>
    new Set((dailyReports || []).filter(r => r.date === YESTERDAY_STR).map(r => r.crewMember)),
    [dailyReports]
  )

  const crewStatus = useMemo(() =>
    CREW_LIST.map(name => {
      const reports = (dailyReports || [])
        .filter(r => r.crewMember === name)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
      const last = reports[0]
      return {
        name,
        reportedYesterday: submittedYesterday.has(name),
        lastReportDate: last?.date || null,
        lastReportDays: last?.date ? daysSince(last.date) : null,
        currentJob: last?.jobId || last?.jobName || null,
      }
    }),
    [dailyReports, submittedYesterday]
  )

  // F. Zone overview
  const zoneOverview = useMemo(() => {
    const zones = {}
    activeJobs.forEach(j => {
      const zone = PM_ZONES[j.pm] || 'Unassigned'
      if (!zones[zone]) zones[zone] = { zone, pm: j.pm || '—', jobs: [] }
      zones[zone].jobs.push(j)
    })
    return Object.values(zones).sort((a, b) => a.zone.localeCompare(b.zone))
  }, [activeJobs])

  // G. Inspection pipeline
  const inspPipeline = useMemo(() => {
    return activeJobs
      .map(j => {
        const insp = j.insp || {}
        const phases = []
        ;['electrical', 'plumbing', 'hvac'].forEach(trade => {
          const t = insp[trade]
          if (!t || (t.roughIn === 'n/a' && t.final === 'n/a')) return
          if (t.roughIn === 'pending') phases.push({ trade, phase: 'Rough-In', status: 'pending', blocker: 'Work in progress' })
          else if (t.roughIn === 'scheduled') phases.push({ trade, phase: 'Rough-In', status: 'scheduled', blocker: null })
          else if (t.roughIn === 'passed' && (t.trim === 'pending' || t.trim === 'scheduled')) {
            phases.push({ trade, phase: 'Trim', status: t.trim, blocker: t.trim === 'pending' ? 'Trim work not called in' : null })
          } else if (t.roughIn === 'passed' && t.final === 'pending') {
            phases.push({ trade, phase: 'Final', status: 'pending', blocker: null })
          } else if (t.roughIn === 'passed' && t.final === 'scheduled') {
            phases.push({ trade, phase: 'Final', status: 'scheduled', blocker: null })
          }
        })
        return phases.length > 0 ? { ...j, _phases: phases } : null
      })
      .filter(Boolean)
      .slice(0, 10)
  }, [activeJobs])

  // H. Quick stats
  const missingReports = crewStatus.filter(c => !c.reportedYesterday).length
  const inspPendingCount = activeJobs.filter(j =>
    Object.values(j.insp || {}).some(t =>
      Object.values(t || {}).some(s => s === 'pending' || s === 'scheduled')
    )
  ).length

  const stats = [
    { label: 'ACTIVE JOBS',     value: activeJobs.length,    color: O,           Icon: ActivityIcon      },
    { label: 'STALLED',         value: stalledJobs.length,   color: stalledJobs.length > 0 ? '#ef4444' : '#22c55e', Icon: ClockIcon },
    { label: 'READY TO BILL',   value: billingQueue.length,  color: billingQueue.length > 0 ? '#22c55e' : '#6b7280', Icon: DollarSignIcon },
    { label: 'MISSING REPORTS', value: missingReports,       color: missingReports > 0 ? '#eab308' : '#22c55e', Icon: AlertTriangleIcon },
    { label: 'INSPECT PENDING', value: inspPendingCount,     color: inspPendingCount > 0 ? '#3b82f6' : '#6b7280', Icon: CheckCircleIcon  },
  ]

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: O + '22', border: `1px solid ${O}44` }}>
          <BrainCircuitIcon size={18} style={{ color: O }} />
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-black tracking-wide sm:tracking-widest uppercase" style={{ color: O }}>
            PM Agent — Command Center
          </h1>
          <p className="text-xs text-muted-foreground">
            {TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            &nbsp;·&nbsp;{activeJobs.length} active jobs&nbsp;·&nbsp;Middle Tennessee
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] text-green-400 font-mono tracking-widest">LIVE</span>
        </div>
      </div>

      {/* H. Quick Stats Bar */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {stats.map(s => (
          <div key={s.label}
            className="p-2 sm:p-3 rounded-lg border text-center"
            style={{ borderColor: s.color + '33', backgroundColor: s.color + '0d' }}>
            <div className="flex items-center justify-center gap-1 mb-1">
              <s.Icon size={10} style={{ color: s.color }} />
              <span className="text-[9px] font-black tracking-widest leading-tight" style={{ color: s.color }}>{s.label}</span>
            </div>
            <p className="text-2xl font-black leading-none" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* B. Stalled Alert Banner */}
      {stalledJobs.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border"
          style={{ borderColor: '#ef444466', backgroundColor: '#ef444411' }}>
          <AlertCircleIcon size={16} color="#ef4444" className="shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-black text-red-400 mr-3">
              {stalledJobs.length} JOB{stalledJobs.length !== 1 ? 'S' : ''} STALLED 48h+
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              {stalledJobs.slice(0, 4).map(j => `${j.id} (${j.staleDays}d)`).join(' · ')}
              {stalledJobs.length > 4 && ` · +${stalledJobs.length - 4} more`}
            </span>
          </div>
        </div>
      )}

      {/* A. Today's Priority Jobs */}
      <Card className="border-white/10" style={{ borderColor: priorityJobs.length > 0 ? O + '33' : undefined }}>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-black tracking-widest uppercase flex items-center gap-2">
            <ZapIcon size={13} style={{ color: O }} />
            Today&apos;s Priority Jobs
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              {priorityJobs.length} flagged · {activeJobs.length} total active
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {priorityJobs.length === 0 ? (
            <div className="flex items-center gap-2 py-3 text-green-400">
              <CheckCircleIcon size={14} />
              <span className="text-xs font-medium">All jobs clear — no priority flags today</span>
            </div>
          ) : (
            priorityJobs.map((j, i) => {
              const c = j._class
              return (
                <div key={j.id}
                  className="flex items-start gap-3 p-3 rounded-lg border"
                  style={{ borderColor: c.color + '33', backgroundColor: c.color + '08' }}>
                  <div className="text-[10px] font-black w-4 text-center shrink-0 mt-0.5 tabular-nums"
                    style={{ color: c.color }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-sm">{jobLabel(j)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{j.id}</span>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full tracking-widest shrink-0"
                        style={{ backgroundColor: c.color + '22', color: c.color, border: `1px solid ${c.color}44` }}>
                        {c.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                      <span>PM: {j.pm || '—'}</span>
                      {j._stale !== null && <span>{j._stale}d no update</span>}
                      <span>{cleanPhase(j.phase)}</span>
                      {j.billingStatus && <span className="uppercase">{j.billingStatus}</span>}
                    </div>
                    <p className="mt-1.5 text-xs font-semibold" style={{ color: c.color }}>
                      → {c.action}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Mid grid: Billing | Crew | No Next Action */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* C. Billing Ready Queue */}
        <Card style={{ borderColor: '#22c55e33' }}>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-black tracking-widest uppercase flex items-center gap-2">
              <DollarSignIcon size={13} color="#22c55e" />
              Billing Ready
              <span className="ml-auto text-xs font-mono" style={{ color: '#22c55e' }}>
                {billingQueue.length > 0
                  ? fmt$(billingQueue.reduce((s, j) => s + j._est, 0))
                  : 'CLEAR'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {billingQueue.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No billing ready — all clear</p>
            ) : (
              <>
                {billingQueue.slice(0, 7).map(j => (
                  <div key={j.id}
                    className="flex items-center justify-between p-2 rounded border"
                    style={{ borderColor: '#22c55e22', backgroundColor: '#22c55e08' }}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">
                        {jobLabel(j)}
                        <span className="font-mono font-normal text-muted-foreground ml-1.5">{j.id}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">{cleanPhase(j.phase)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-xs font-black" style={{ color: '#22c55e' }}>{fmt$(j._est)}</p>
                      <p className="text-[9px] text-muted-foreground">30% due</p>
                    </div>
                  </div>
                ))}
                {billingQueue.length > 7 && (
                  <p className="text-[10px] text-muted-foreground text-center pt-1">+{billingQueue.length - 7} more</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* E. Crew Status */}
        <Card className="border-white/10">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-black tracking-widest uppercase flex items-center gap-2">
              <UsersIcon size={13} style={{ color: O }} />
              Crew Status
              {missingReports > 0 && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: '#eab30822', color: '#eab308' }}>
                  {missingReports} MISSING
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {crewStatus.map(c => (
              <div key={c.name}
                className="flex items-center gap-2.5 p-2 rounded border border-white/10">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                  style={{ backgroundColor: O + '22', color: O }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {c.currentJob ? `Last: ${c.currentJob}` : 'No recent job'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {c.reportedYesterday ? (
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                      REPORTED
                    </span>
                  ) : (
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                      MISSING
                    </span>
                  )}
                  {c.lastReportDays !== null && (
                    <p className="text-[9px] text-muted-foreground mt-0.5">{c.lastReportDays}d ago</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* D. Next Action Queue */}
        <Card style={{ borderColor: noNextActionJobs.length > 0 ? '#ef444433' : undefined }}>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-black tracking-widest uppercase flex items-center gap-2">
              <XCircleIcon size={13} color={noNextActionJobs.length > 0 ? '#ef4444' : '#6b7280'} />
              No Next Action
              {noNextActionJobs.length > 0 && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: '#ef444422', color: '#ef4444' }}>
                  {noNextActionJobs.length} unaccounted
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {noNextActionJobs.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-green-400">
                <CheckCircleIcon size={12} />
                <span className="text-xs">All active jobs accounted for</span>
              </div>
            ) : (
              <>
                <p className="text-[10px] text-muted-foreground mb-1">
                  These jobs have no explicit next action — assign one now.
                </p>
                {noNextActionJobs.slice(0, 8).map(j => (
                  <div key={j.id}
                    className="flex items-center justify-between p-2 rounded border"
                    style={{ borderColor: '#ef444422', backgroundColor: '#ef444408' }}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">
                        {jobLabel(j)}
                        <span className="font-mono font-normal text-muted-foreground ml-1.5">{j.id}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">{j.pm || '—'}</p>
                    </div>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 ml-2"
                      style={{ backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef444433' }}>
                      NO ACTION
                    </span>
                  </div>
                ))}
                {noNextActionJobs.length > 8 && (
                  <p className="text-[10px] text-muted-foreground text-center">+{noNextActionJobs.length - 8} more</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom grid: Zone Overview | Inspection Pipeline */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* F. Zone Overview */}
        <Card className="border-white/10">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-black tracking-widest uppercase flex items-center gap-2">
              <MapPinIcon size={13} style={{ color: O }} />
              Zone Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {zoneOverview.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No active jobs</p>
            ) : (
              zoneOverview.map(z => {
                const needsAction = z.jobs.filter(j => j.status === 'needs-action').length
                const blocked = z.jobs.filter(j => j.status === 'blocked').length
                const stalled = z.jobs.filter(j => {
                  const d = daysSince(j.lastStatusChange || j.start)
                  return d !== null && d >= 2 && j.status !== 'pending'
                }).length
                const allOk = needsAction === 0 && blocked === 0 && stalled === 0
                return (
                  <div key={z.zone} className="p-3 rounded-lg border border-white/10 bg-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black" style={{ color: O }}>{z.zone}</span>
                        <span className="text-[10px] text-muted-foreground">{z.pm}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">
                        {z.jobs.length} job{z.jobs.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {needsAction > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: O + '22', color: O }}>
                          {needsAction} need action
                        </span>
                      )}
                      {blocked > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: '#ef444422', color: '#ef4444' }}>
                          {blocked} blocked
                        </span>
                      )}
                      {stalled > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: '#ef444422', color: '#ef4444' }}>
                          {stalled} stalled
                        </span>
                      )}
                      {allOk && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: '#22c55e22', color: '#22c55e' }}>
                          all clear
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {z.jobs.slice(0, 6).map(j => (
                        <span key={j.id}
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">
                          {j.id.replace('QBS-0', '').replace('QBS-', '')}
                        </span>
                      ))}
                      {z.jobs.length > 6 && (
                        <span className="text-[9px] text-muted-foreground">+{z.jobs.length - 6}</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* G. Inspection Pipeline */}
        <Card className="border-white/10">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-black tracking-widest uppercase flex items-center gap-2">
              <CheckCircleIcon size={13} style={{ color: '#3b82f6' }} />
              Inspection Pipeline
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {inspPipeline.length} jobs
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {inspPipeline.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No inspections in pipeline</p>
            ) : (
              inspPipeline.map(j => (
                <div key={j.id} className="p-2.5 rounded-lg border border-white/10 bg-white/5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold">{jobLabel(j)}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{j.id}</span>
                    {j.pm && <span className="text-[10px] text-muted-foreground ml-auto">{j.pm.split(' ')[0]}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {j._phases.map((p, idx) => {
                      const col = p.status === 'scheduled' ? '#22c55e'
                               : p.status === 'pending'   ? '#eab308'
                               : '#6b7280'
                      const tradeShort = p.trade === 'electrical' ? 'E'
                                       : p.trade === 'plumbing'   ? 'P'
                                       : 'H'
                      return (
                        <span key={idx}
                          className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: col + '22', color: col, border: `1px solid ${col}44` }}>
                          {tradeShort} {p.phase}
                          {p.status === 'scheduled' ? ' · CALLED' : ' · PENDING'}
                        </span>
                      )
                    })}
                  </div>
                  {j._phases.some(p => p.blocker) && (
                    <p className="text-[9px] text-yellow-400 mt-1.5">
                      ⚠ {j._phases.find(p => p.blocker)?.blocker}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
