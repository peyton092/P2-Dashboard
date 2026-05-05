import { useMemo, useState } from 'react'
import { useData } from '../DataContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertTriangleIcon, CheckCircleIcon, ClockIcon, ZapIcon,
  DollarSignIcon, MapPinIcon, ActivityIcon, AlertCircleIcon,
  TargetIcon, TrendingUpIcon, ShieldIcon, UsersIcon, RefreshCwIcon,
} from 'lucide-react'
import { scoreJob, classifyRisk } from '../agent/scoring'
import { generateAlerts, ALERT_TYPE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL } from '../agent/alerts'
import { ZONES, getZoneId } from '../agent/zones'
import { updateAgentAlert } from '../hooks/useFirestore'

const O = '#F47920'
const TODAY = new Date()

function daysSinceLocal(dateVal) {
  if (!dateVal) return null
  try {
    const d = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal)
    if (isNaN(d.getTime())) return null
    return Math.floor((TODAY - d) / 86400000)
  } catch { return null }
}

function isBillingReadyLocal(job) {
  if (job.billingStatus === 'invoiced' || job.billingStatus === 'paid') return false
  const insp = job.insp || {}
  return ['electrical', 'plumbing', 'hvac'].some(t =>
    insp[t]?.final === 'passed' || insp[t]?.roughIn === 'passed'
  )
}

function isComplete(job) {
  return ['complete', 'completed'].includes(job.status)
}

// ── Severity sort order ───────────────────────────────────────────────────────
const SEV_ORDER = { critical: 0, warning: 1, info: 2 }

// ── Sub-component: Stat Card ──────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = O, sub }) {
  return (
    <Card style={{ backgroundColor: '#1a1a1a', border: '1px solid #374151' }}>
      <CardContent style={{ padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
          <Icon size={16} style={{ color }} />
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{sub}</div>}
      </CardContent>
    </Card>
  )
}

// ── Sub-component: Section Header ─────────────────────────────────────────────
function SectionHead({ title, badge, icon: Icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      {Icon && <Icon size={16} style={{ color: O }} />}
      <span style={{ fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>{title}</span>
      {badge != null && (
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#fff',
          background: '#374151', borderRadius: 9999, padding: '1px 7px',
        }}>{badge}</span>
      )}
      {children}
    </div>
  )
}

export default function WarRoom() {
  const { jobs = [], extras = [], agentAlerts = [] } = useData()
  const [alertFilter, setAlertFilter] = useState('all')
  const [dismissed, setDismissed] = useState(new Set())

  // ── Derived data ─────────────────────────────────────────────────────────────
  const activeJobs = useMemo(() => jobs.filter(j => !isComplete(j)), [jobs])

  // Alert feed: prefer Firestore agentAlerts, fall back to generateAlerts()
  const rawAlerts = useMemo(() => {
    const base = agentAlerts.length > 0 ? agentAlerts : generateAlerts(jobs, extras)
    return base.filter(a => a.status !== 'dismissed' && !dismissed.has(a._docId || a.id))
  }, [agentAlerts, jobs, extras, dismissed])

  const sortedAlerts = useMemo(() => {
    return [...rawAlerts].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
  }, [rawAlerts])

  const filteredAlerts = useMemo(() => {
    const list = alertFilter === 'all' ? sortedAlerts : sortedAlerts.filter(a => a.severity === alertFilter)
    return list.slice(0, 15)
  }, [sortedAlerts, alertFilter])

  const criticalCount = useMemo(() => rawAlerts.filter(a => a.severity === 'critical').length, [rawAlerts])

  // Stalled jobs: non-complete, staled >= 3 days
  const stalledJobs = useMemo(() => {
    return activeJobs
      .map(j => ({ job: j, days: daysSinceLocal(j.lastStatusChange || j.start) }))
      .filter(({ days }) => days !== null && days >= 3)
      .sort((a, b) => b.days - a.days)
      .slice(0, 12)
  }, [activeJobs])

  // Billing ready
  const billingReadyCount = useMemo(() => activeJobs.filter(isBillingReadyLocal).length, [activeJobs])

  // Zone board
  const zoneStats = useMemo(() => {
    return Object.values(ZONES).map(zone => {
      const zoneJobs = activeJobs.filter(j => getZoneId(j) === zone.id)
      const critIssues = zoneJobs.filter(j => {
        const r = classifyRisk(j)
        return r?.level === 'critical'
      }).length
      return { zone, jobCount: zoneJobs.length, critIssues }
    })
  }, [activeJobs])

  // Inspection queue: jobs with pending-verification or scheduled in insp
  const inspQueue = useMemo(() => {
    return activeJobs
      .map(j => {
        const insp = j.insp || {}
        const ready = []
        for (const [trade, phases] of Object.entries(insp)) {
          for (const [phase, result] of Object.entries(phases || {})) {
            if (result === 'pending-verification' || result === 'scheduled') {
              const label = `${trade === 'electrical' ? 'E' : trade === 'plumbing' ? 'P' : 'H'} ${phase === 'roughIn' ? 'rough' : phase}`
              ready.push(label)
            }
          }
        }
        return ready.length > 0 ? { job: j, ready } : null
      })
      .filter(Boolean)
      .slice(0, 8)
  }, [activeJobs])

  // Top risk jobs
  const riskJobs = useMemo(() => {
    return activeJobs
      .map(j => ({ job: j, score: scoreJob(j, extras), risk: classifyRisk(j) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [activeJobs, extras])

  // Dismiss handler
  function handleDismiss(alert) {
    const id = alert._docId || alert.id
    setDismissed(prev => new Set([...prev, id]))
    if (alert._docId) {
      updateAgentAlert(alert._docId, { status: 'dismissed' }).catch(() => {})
    }
  }

  // Score color
  function scoreColor(score) {
    if (score >= 80) return '#ef4444'
    if (score >= 60) return '#f97316'
    return '#f59e0b'
  }

  const filterBtns = ['all', 'critical', 'warning', 'info']

  return (
    <div style={{ padding: '16px 20px', minHeight: '100vh', backgroundColor: '#0f0f0f', color: '#fff' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <ShieldIcon size={20} style={{ color: O }} />
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>War Room</h1>
        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 4 }}>Field Operations Command</span>
        <RefreshCwIcon size={13} style={{ color: '#374151', marginLeft: 'auto' }} />
        <span style={{ fontSize: 11, color: '#4b5563' }}>{TODAY.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* ── Section 1: Stat Row ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard
          icon={ActivityIcon}
          label="Active Jobs"
          value={activeJobs.length}
          color={O}
          sub={`${jobs.filter(isComplete).length} completed`}
        />
        <StatCard
          icon={AlertTriangleIcon}
          label="Critical Alerts"
          value={criticalCount}
          color={criticalCount > 0 ? '#ef4444' : '#22c55e'}
          sub={criticalCount > 0 ? 'Requires immediate action' : 'All clear'}
        />
        <StatCard
          icon={ClockIcon}
          label="Stalled Jobs"
          value={stalledJobs.length}
          color={stalledJobs.length > 0 ? '#f59e0b' : '#22c55e'}
          sub={`≥3 days without update`}
        />
        <StatCard
          icon={DollarSignIcon}
          label="Billing Ready"
          value={billingReadyCount}
          color={billingReadyCount > 0 ? '#22c55e' : '#6b7280'}
          sub="Inspection passed, not invoiced"
        />
      </div>

      {/* ── Section 2 + 3: Alert Feed + Zone Board ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 20 }}>

        {/* Alert Feed */}
        <Card style={{ backgroundColor: '#111827', border: '1px solid #374151' }}>
          <CardHeader style={{ padding: '14px 16px 8px' }}>
            <SectionHead title="Live Alerts" badge={rawAlerts.length} icon={ZapIcon}>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {filterBtns.map(f => (
                  <button
                    key={f}
                    onClick={() => setAlertFilter(f)}
                    style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 4,
                      border: alertFilter === f ? `1px solid ${f === 'critical' ? '#ef4444' : f === 'warning' ? '#f59e0b' : f === 'info' ? '#3b82f6' : O}` : '1px solid #374151',
                      background: alertFilter === f ? 'rgba(255,255,255,0.06)' : 'transparent',
                      color: alertFilter === f ? '#fff' : '#9ca3af',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >{f}</button>
                ))}
              </div>
            </SectionHead>
          </CardHeader>
          <CardContent style={{ padding: '0 16px 14px' }}>
            {filteredAlerts.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 0', color: '#22c55e' }}>
                <CheckCircleIcon size={18} />
                <span style={{ fontSize: 13 }}>No active alerts</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredAlerts.map(alert => (
                  <div
                    key={alert._docId || alert.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '8px 10px', borderRadius: 6,
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: `1px solid rgba(255,255,255,0.06)`,
                    }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                      backgroundColor: SEVERITY_COLOR[alert.severity] || '#6b7280',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6', lineHeight: 1.3 }}>
                        {alert.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, lineHeight: 1.4 }}>
                        {alert.description}
                      </div>
                      {alert.pm && (
                        <span style={{
                          display: 'inline-block', fontSize: 10, marginTop: 4,
                          padding: '1px 6px', borderRadius: 3,
                          background: 'rgba(244,121,32,0.15)', color: O, border: `1px solid rgba(244,121,32,0.3)`,
                        }}>{alert.pm}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDismiss(alert)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#4b5563', fontSize: 14, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
                      }}
                      title="Dismiss"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Zone Board */}
        <Card style={{ backgroundColor: '#111827', border: '1px solid #374151' }}>
          <CardHeader style={{ padding: '14px 16px 8px' }}>
            <SectionHead title="Zone Board" icon={MapPinIcon} />
          </CardHeader>
          <CardContent style={{ padding: '0 14px 14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {zoneStats.map(({ zone, jobCount, critIssues }) => (
                <div
                  key={zone.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 6,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    borderLeft: `3px solid ${zone.color}`,
                    border: `1px solid rgba(255,255,255,0.06)`,
                    borderLeftWidth: 3, borderLeftColor: zone.color,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6' }}>{zone.name}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {zone.area}
                    </div>
                    {zone.pm && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{zone.pm}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{jobCount} active</span>
                    {critIssues > 0 && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 3,
                        background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                        border: '1px solid rgba(239,68,68,0.3)',
                      }}>{critIssues} critical</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 4: Stalled Job Tracker ────────────────────────────────── */}
      <Card style={{ backgroundColor: '#111827', border: '1px solid #374151', marginBottom: 20 }}>
        <CardHeader style={{ padding: '14px 16px 8px' }}>
          <SectionHead title="Stalled Job Tracker" badge={stalledJobs.length} icon={ClockIcon} />
        </CardHeader>
        <CardContent style={{ padding: '0 16px 14px' }}>
          {stalledJobs.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0', color: '#22c55e' }}>
              <CheckCircleIcon size={16} />
              <span style={{ fontSize: 13 }}>No stalled jobs</span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #374151' }}>
                    {['Job ID', 'Job Name', 'PM', 'Days Stalled', 'Phase / Status', 'Last Update'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '6px 10px', color: '#6b7280',
                        fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stalledJobs.map(({ job, days }) => {
                    const rowBg = days >= 7
                      ? 'rgba(239,68,68,0.07)'
                      : days >= 3
                        ? 'rgba(245,158,11,0.06)'
                        : 'transparent'
                    const daysColor = days >= 7 ? '#ef4444' : days >= 3 ? '#f59e0b' : '#9ca3af'
                    const lastUpdate = job.lastStatusChange || job.start
                    const lastUpdateStr = lastUpdate
                      ? (lastUpdate?.toDate ? lastUpdate.toDate() : new Date(lastUpdate)).toLocaleDateString()
                      : '—'
                    const phase = (job.phase || job.status || '—')
                      .replace(/-/g, ' ')
                      .replace(/\b\w/g, c => c.toUpperCase())
                    return (
                      <tr key={job._docId || job.id} style={{ backgroundColor: rowBg, borderBottom: '1px solid rgba(55,65,81,0.4)' }}>
                        <td style={{ padding: '7px 10px', color: '#9ca3af', fontFamily: 'monospace' }}>{job.id}</td>
                        <td style={{ padding: '7px 10px', color: '#f3f4f6', fontWeight: 500 }}>{job.name || job.id}</td>
                        <td style={{ padding: '7px 10px', color: '#9ca3af' }}>{job.pm || '—'}</td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{ fontWeight: 700, color: daysColor }}>{days}d</span>
                        </td>
                        <td style={{ padding: '7px 10px', color: '#d1d5db' }}>{phase}</td>
                        <td style={{ padding: '7px 10px', color: '#6b7280' }}>{lastUpdateStr}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 5 + 6: Inspection Queue + Top Risk Jobs ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Inspection Queue */}
        <Card style={{ backgroundColor: '#111827', border: '1px solid #374151' }}>
          <CardHeader style={{ padding: '14px 16px 8px' }}>
            <SectionHead title="Inspection Queue" icon={TargetIcon} />
          </CardHeader>
          <CardContent style={{ padding: '0 16px 14px' }}>
            {inspQueue.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0', color: '#22c55e' }}>
                <CheckCircleIcon size={16} />
                <span style={{ fontSize: 13 }}>No pending inspections</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {inspQueue.map(({ job, ready }) => (
                  <div
                    key={job._docId || job.id}
                    style={{
                      padding: '8px 10px', borderRadius: 6,
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6' }}>{job.name || job.id}</span>
                      {job.pm && (
                        <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8, flexShrink: 0 }}>{job.pm}</span>
                      )}
                    </div>
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {ready.map((label, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 3,
                            background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                            border: '1px solid rgba(59,130,246,0.3)',
                          }}
                        >{label}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Risk Jobs */}
        <Card style={{ backgroundColor: '#111827', border: '1px solid #374151' }}>
          <CardHeader style={{ padding: '14px 16px 8px' }}>
            <SectionHead title="Top Risk Jobs" icon={TrendingUpIcon} />
          </CardHeader>
          <CardContent style={{ padding: '0 16px 14px' }}>
            {riskJobs.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0', color: '#22c55e' }}>
                <CheckCircleIcon size={16} />
                <span style={{ fontSize: 13 }}>No high-risk jobs</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {riskJobs.map(({ job, score, risk }) => (
                  <div
                    key={job._docId || job.id}
                    style={{
                      padding: '8px 10px', borderRadius: 6,
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 4, flexShrink: 0,
                        background: `${scoreColor(score)}22`,
                        color: scoreColor(score),
                        border: `1px solid ${scoreColor(score)}44`,
                      }}>{score}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.name || job.id}
                      </span>
                      {job.pm && (
                        <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>{job.pm.split(' ')[0]}</span>
                      )}
                    </div>
                    {risk?.reason && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, marginLeft: 44 }}>
                        {risk.reason}
                      </div>
                    )}
                    <div style={{ marginTop: 5, marginLeft: 44, height: 3, borderRadius: 2, backgroundColor: '#1f2937', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${Math.min(100, score)}%`,
                        backgroundColor: scoreColor(score),
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
