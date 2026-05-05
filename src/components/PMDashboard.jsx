import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import { scoreJob, classifyRisk } from '../agent/scoring'
import { ZONES, getZoneId } from '../agent/zones'
import { updateJob } from '../hooks/useFirestore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  UserIcon, TargetIcon, AlertCircleIcon, CheckCircleIcon,
  ClockIcon, TrendingUpIcon, ChevronDownIcon, ChevronUpIcon,
  MapPinIcon, ZapIcon,
} from 'lucide-react'

const O = '#F47920'

const QBS_PMS = [
  'Blake Neblett',
  'Brendan Embry',
  'Jeb Brooks',
  'Taylor Hensley',
  'Tim King',
  'Derek Powers',
]

const STATUS_COLORS = {
  'on-track':    { bg: '#22c55e22', color: '#22c55e', label: 'On Track' },
  'needs-action':{ bg: '#F4792022', color: O,         label: 'Needs Action' },
  'blocked':     { bg: '#ef444422', color: '#ef4444', label: 'Blocked' },
  'pending':     { bg: '#6b728022', color: '#9ca3af', label: 'Pending' },
  'complete':    { bg: '#22c55e22', color: '#22c55e', label: 'Complete' },
}

function cleanPhase(phase) {
  if (!phase) return '—'
  return phase.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function isBillingReady(job) {
  if (job.billingStatus === 'invoiced' || job.billingStatus === 'paid') return false
  const insp = job.insp || {}
  return ['electrical', 'plumbing', 'hvac'].some(t => insp[t]?.final === 'passed')
}

function scoreBgColor(score) {
  if (score >= 80) return '#ef4444'
  if (score >= 60) return O
  return '#f59e0b'
}

// ── Inline next-action input ──────────────────────────────────────────────────

function NextActionInput({ job }) {
  const [val, setVal] = useState(job.nextAction || '')

  function handleBlur() {
    if (!job._docId) return
    const trimmed = val.trim()
    if (trimmed !== (job.nextAction || '').trim()) {
      updateJob(job._docId, { nextAction: trimmed }).catch(() => {})
    }
  }

  return (
    <input
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={handleBlur}
      placeholder="Next action…"
      style={{
        background: '#111827',
        border: '1px solid #374151',
        color: 'white',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: 12,
        width: '100%',
        outline: 'none',
      }}
      onFocus={e => { e.target.style.borderColor = O }}
      onBlurCapture={e => { e.target.style.borderColor = '#374151' }}
    />
  )
}

// ── Single job row ────────────────────────────────────────────────────────────

function JobRow({ job, rank }) {
  const score = job._score ?? scoreJob(job)
  const risk  = job._risk  ?? classifyRisk(job)
  const st    = STATUS_COLORS[job.status] || STATUS_COLORS['pending']

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto',
        gap: '10px',
        alignItems: 'start',
        padding: '10px 12px',
        borderRadius: 6,
        border: '1px solid',
        borderColor: risk?.level === 'critical' ? '#ef444433'
                   : risk?.level === 'warning'  ? '#f59e0b33'
                   : '#37415133',
        backgroundColor: risk?.level === 'critical' ? '#ef444408'
                       : risk?.level === 'warning'  ? '#f59e0b06'
                       : '#ffffff05',
        marginBottom: 6,
      }}
    >
      {/* Score badge + bar */}
      <div style={{ textAlign: 'center', paddingTop: 2 }}>
        <div style={{
          backgroundColor: scoreBgColor(score),
          color: 'white',
          fontWeight: 900,
          fontSize: 11,
          borderRadius: 4,
          padding: '2px 4px',
          lineHeight: 1.3,
          minWidth: 28,
          textAlign: 'center',
        }}>
          {score}
        </div>
        <div style={{
          marginTop: 4,
          height: 3,
          borderRadius: 2,
          backgroundColor: '#374151',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${score}%`,
            height: '100%',
            backgroundColor: scoreBgColor(score),
            borderRadius: 2,
          }} />
        </div>
      </div>

      {/* Job details */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: O, fontWeight: 700 }}>
            {job.id}
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'white' }}>
            {job.name || job.client?.split(' ')[0] || job.id}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9999,
            backgroundColor: st.bg, color: st.color,
            border: `1px solid ${st.color}44`,
          }}>
            {st.label}
          </span>
          <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>
            {cleanPhase(job.phase)}
          </span>
        </div>
        {risk && (
          <p style={{ fontSize: 10, color: risk.level === 'critical' ? '#ef4444' : '#f59e0b', marginBottom: 4 }}>
            {risk.level === 'critical' ? '● ' : '◐ '}{risk.reason}
          </p>
        )}
        <NextActionInput job={job} />
      </div>
    </div>
  )
}

// ── PM card ───────────────────────────────────────────────────────────────────

function PMCard({ pm, jobs, extras, isSelected, collapsed, onToggle }) {
  const zoneId   = Object.values(ZONES).find(z => z.pm === pm)?.id || 'zone-7'
  const zone     = ZONES[zoneId]

  const activeJobs = useMemo(
    () => jobs.filter(j => !['complete', 'completed'].includes(j.status)),
    [jobs]
  )

  const sortedJobs = useMemo(
    () => [...activeJobs]
      .map(j => ({ ...j, _score: scoreJob(j, extras), _risk: classifyRisk(j) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 10),
    [activeJobs, extras]
  )

  const criticalCount = useMemo(
    () => sortedJobs.filter(j => j._risk?.level === 'critical').length,
    [sortedJobs]
  )
  const warningCount = useMemo(
    () => sortedJobs.filter(j => j._risk?.level === 'warning').length,
    [sortedJobs]
  )
  const billingReadyCount = useMemo(
    () => activeJobs.filter(isBillingReady).length,
    [activeJobs]
  )

  const borderColor = criticalCount > 0 ? '#ef444455'
                    : warningCount  > 0 ? '#f59e0b44'
                    : '#37415155'

  return (
    <Card style={{ backgroundColor: '#1a1a1a', border: `1px solid ${borderColor}` }}>
      {/* Header */}
      <CardHeader
        className="pb-2 pt-3 px-4"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={onToggle}
      >
        <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: (zone?.color || O) + '22', flexShrink: 0,
          }}>
            <UserIcon size={13} style={{ color: zone?.color || O }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'white' }}>{pm}</span>
          {zone && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999,
              backgroundColor: zone.color + '22', color: zone.color,
              border: `1px solid ${zone.color}44`,
            }}>
              {zone.name}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 9999,
              backgroundColor: '#ffffff11', color: '#9ca3af',
            }}>
              {activeJobs.length} active
            </span>
            {criticalCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 900, padding: '2px 6px', borderRadius: 9999,
                backgroundColor: '#ef444422', color: '#ef4444',
                border: '1px solid #ef444444',
              }}>
                {criticalCount} CRITICAL
              </span>
            )}
            {warningCount > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 900, padding: '2px 6px', borderRadius: 9999,
                backgroundColor: '#f59e0b22', color: '#f59e0b',
                border: '1px solid #f59e0b44',
              }}>
                {warningCount} WARN
              </span>
            )}
            {collapsed
              ? <ChevronDownIcon size={14} style={{ color: '#9ca3af' }} />
              : <ChevronUpIcon   size={14} style={{ color: '#9ca3af' }} />
            }
          </div>
        </CardTitle>
      </CardHeader>

      {/* Collapsible body */}
      {!collapsed && (
        <CardContent className="px-4 pb-3 pt-0">
          {sortedJobs.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 0', color: '#22c55e' }}>
              <CheckCircleIcon size={13} />
              <span style={{ fontSize: 12 }}>No active jobs</span>
            </div>
          ) : (
            <div>
              {sortedJobs.map((j, i) => (
                <JobRow key={j._docId || j.id} job={j} rank={i + 1} />
              ))}
            </div>
          )}

          {/* Footer stats */}
          <div style={{
            display: 'flex', gap: 12, paddingTop: 8,
            borderTop: '1px solid #374151', marginTop: 4,
            flexWrap: 'wrap',
          }}>
            <StatChip icon={<TrendingUpIcon size={10} />} label={`${activeJobs.length} active`} color="#9ca3af" />
            {criticalCount > 0 && (
              <StatChip icon={<AlertCircleIcon size={10} />} label={`${criticalCount} critical`} color="#ef4444" />
            )}
            {billingReadyCount > 0 && (
              <StatChip icon={<ZapIcon size={10} />} label={`${billingReadyCount} billing-ready`} color="#22c55e" />
            )}
            {criticalCount === 0 && warningCount === 0 && (
              <StatChip icon={<CheckCircleIcon size={10} />} label="all clear" color="#22c55e" />
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function StatChip({ icon, label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
      {icon}
      <span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PMDashboard() {
  const { jobs, extras } = useData()

  const [selectedPM,    setSelectedPM]    = useState(null)
  const [searchText,    setSearchText]    = useState('')
  const [severityFilter,setSeverityFilter]= useState('All')
  const [zoneFilter,    setZoneFilter]    = useState('All')
  const [collapsed,     setCollapsed]     = useState({})

  // Non-complete jobs
  const activeJobs = useMemo(
    () => jobs.filter(j => !['complete', 'completed'].includes(j.status)),
    [jobs]
  )

  // Filter logic applied across all PM groups
  const filteredJobs = useMemo(() => {
    const q = searchText.toLowerCase()
    return activeJobs.filter(j => {
      if (q && !(j.id?.toLowerCase().includes(q) || j.name?.toLowerCase().includes(q))) return false
      if (selectedPM && j.pm !== selectedPM) return false
      if (zoneFilter !== 'All') {
        const jZone = getZoneId(j)
        if (jZone !== zoneFilter) return false
      }
      if (severityFilter !== 'All') {
        const risk = classifyRisk(j)
        if (severityFilter === 'Critical' && risk?.level !== 'critical') return false
        if (severityFilter === 'Warning'  && risk?.level !== 'warning')  return false
      }
      return true
    })
  }, [activeJobs, searchText, selectedPM, zoneFilter, severityFilter])

  // Group by PM, only for PMs that appear in data (or all 6 QBS PMs)
  const pmGroups = useMemo(() => {
    const map = {}
    QBS_PMS.forEach(pm => { map[pm] = [] })
    filteredJobs.forEach(j => {
      const pmName = j.pm
      if (pmName && QBS_PMS.includes(pmName)) {
        map[pmName].push(j)
      }
    })

    // Sort PM groups by (critical + warning count) descending
    return QBS_PMS.map(pm => ({
      pm,
      jobs: map[pm] || [],
    })).sort((a, b) => {
      const countA = a.jobs.filter(j => {
        const r = classifyRisk(j)
        return r?.level === 'critical' || r?.level === 'warning'
      }).length
      const countB = b.jobs.filter(j => {
        const r = classifyRisk(j)
        return r?.level === 'critical' || r?.level === 'warning'
      }).length
      return countB - countA
    })
  }, [filteredJobs])

  function toggleCollapse(pm) {
    setCollapsed(prev => ({ ...prev, [pm]: !prev[pm] }))
  }

  // Global counts for filter bar display
  const totalCritical = useMemo(
    () => activeJobs.filter(j => classifyRisk(j)?.level === 'critical').length,
    [activeJobs]
  )
  const totalWarning = useMemo(
    () => activeJobs.filter(j => classifyRisk(j)?.level === 'warning').length,
    [activeJobs]
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f0f0f', padding: '0 0 40px' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: O + '22', border: `1px solid ${O}44`,
        }}>
          <TargetIcon size={17} style={{ color: O }} />
        </div>
        <div>
          <h1 style={{
            fontSize: 13, fontWeight: 900, 
            textTransform: 'uppercase', color: O, margin: 0,
          }}>
            PM Hit List
          </h1>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
            {activeJobs.length} active jobs · {totalCritical} critical · {totalWarning} warning
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22c55e' }} />
          <span style={{ fontSize: 10, color: '#22c55e', letterSpacing: '0.05em', fontWeight: 600 }}>LIVE</span>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 14, padding: '10px 12px',
        backgroundColor: '#1a1a1a', borderRadius: 8, border: '1px solid #374151',
      }}>
        {/* Text search */}
        <input
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search job name or ID…"
          style={{
            background: '#111827', border: '1px solid #374151', color: 'white',
            borderRadius: 4, padding: '4px 10px', fontSize: 12, width: 180, outline: 'none',
          }}
        />

        {/* Severity filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {['All', 'Critical', 'Warning'].map(s => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                cursor: 'pointer', border: '1px solid',
                backgroundColor: severityFilter === s
                  ? (s === 'Critical' ? '#ef444422' : s === 'Warning' ? '#f59e0b22' : O + '22')
                  : 'transparent',
                color: severityFilter === s
                  ? (s === 'Critical' ? '#ef4444' : s === 'Warning' ? '#f59e0b' : O)
                  : '#9ca3af',
                borderColor: severityFilter === s
                  ? (s === 'Critical' ? '#ef444444' : s === 'Warning' ? '#f59e0b44' : O + '44')
                  : '#374151',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Zone filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            onClick={() => setZoneFilter('All')}
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
              cursor: 'pointer', border: '1px solid',
              backgroundColor: zoneFilter === 'All' ? O + '22' : 'transparent',
              color: zoneFilter === 'All' ? O : '#9ca3af',
              borderColor: zoneFilter === 'All' ? O + '44' : '#374151',
            }}
          >
            All Zones
          </button>
          {Object.values(ZONES).filter(z => z.pm).map(z => (
            <button
              key={z.id}
              onClick={() => setZoneFilter(z.id)}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                cursor: 'pointer', border: '1px solid',
                backgroundColor: zoneFilter === z.id ? z.color + '22' : 'transparent',
                color: zoneFilter === z.id ? z.color : '#9ca3af',
                borderColor: zoneFilter === z.id ? z.color + '44' : '#374151',
              }}
            >
              {z.name}
            </button>
          ))}
        </div>
      </div>

      {/* PM selector row */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        marginBottom: 16,
      }}>
        <button
          onClick={() => setSelectedPM(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 9999,
            cursor: 'pointer', border: '1px solid',
            backgroundColor: !selectedPM ? O + '22' : '#1a1a1a',
            color: !selectedPM ? O : '#9ca3af',
            borderColor: !selectedPM ? O + '55' : '#374151',
          }}
        >
          All PMs
        </button>
        {QBS_PMS.map(pm => {
          const zoneId = Object.values(ZONES).find(z => z.pm === pm)?.id
          const zone   = zoneId ? ZONES[zoneId] : null
          const pmJobs = activeJobs.filter(j => j.pm === pm)
          const crit   = pmJobs.filter(j => classifyRisk(j)?.level === 'critical').length
          return (
            <button
              key={pm}
              onClick={() => setSelectedPM(prev => prev === pm ? null : pm)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 9999,
                cursor: 'pointer', border: '1px solid',
                backgroundColor: selectedPM === pm ? (zone?.color || O) + '22' : '#1a1a1a',
                color: selectedPM === pm ? (zone?.color || O) : '#9ca3af',
                borderColor: selectedPM === pm ? (zone?.color || O) + '55' : '#374151',
              }}
            >
              <MapPinIcon size={10} />
              {pm.split(' ')[0]}
              {crit > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 900, padding: '0px 5px', borderRadius: 9999,
                  backgroundColor: '#ef444422', color: '#ef4444',
                }}>
                  {crit}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* PM cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {pmGroups.map(({ pm, jobs: pmJobs }) => (
          <PMCard
            key={pm}
            pm={pm}
            jobs={pmJobs}
            extras={extras}
            isSelected={selectedPM === pm}
            collapsed={!!collapsed[pm]}
            onToggle={() => toggleCollapse(pm)}
          />
        ))}
      </div>

    </div>
  )
}
