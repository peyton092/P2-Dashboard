import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import { generateAlerts, ALERT_TYPE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL } from '../agent/alerts'
import { updateAgentAlert, addAgentAlert } from '../hooks/useFirestore'
import { ZONES } from '../agent/zones'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  AlertTriangleIcon, AlertCircleIcon, InfoIcon, CheckCircleIcon,
  XIcon, ClockIcon, BellOffIcon, RefreshCwIcon, FilterIcon, CheckIcon,
} from 'lucide-react'

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 }

function SeverityIcon({ severity, size = 14 }) {
  if (severity === 'critical') return <AlertCircleIcon size={size} color={SEVERITY_COLOR.critical} />
  if (severity === 'warning')  return <AlertTriangleIcon size={size} color={SEVERITY_COLOR.warning} />
  return <InfoIcon size={size} color={SEVERITY_COLOR.info} />
}

function StatusDot({ status }) {
  const color =
    status === 'resolved' ? '#22c55e' :
    status === 'snoozed'  ? '#f59e0b' :
    '#ef4444'
  return (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 5 }} />
  )
}

function fmtTs(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function isToday(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

export default function AlertsPage() {
  const { jobs, extras, agentAlerts } = useData()

  const [severityFilter, setSeverityFilter] = useState('all')
  const [typeFilter, setTypeFilter]         = useState('all')
  const [zoneFilter, setZoneFilter]         = useState('all')
  const [pmFilter, setPmFilter]             = useState('all')
  const [statusFilter, setStatusFilter]     = useState('active')
  const [search, setSearch]                 = useState('')
  const [rescanning, setRescanning]         = useState(false)

  // ── Merge Firestore alerts + client-generated alerts ─────────────────────────
  const merged = useMemo(() => {
    const clientAlerts = generateAlerts(jobs, extras)
    const fsIds = new Set((agentAlerts || []).map(a => a.id))

    // Start with Firestore alerts (authoritative for lifecycle)
    const result = [...(agentAlerts || [])]

    // Add client alerts that have no Firestore entry yet
    for (const ca of clientAlerts) {
      if (!fsIds.has(ca.id)) {
        result.push({ ...ca, status: 'open' })
      }
    }

    return result
  }, [agentAlerts, jobs, extras])

  // ── Unique PM list from merged alerts ────────────────────────────────────────
  const allPMs = useMemo(() => {
    const pms = new Set(merged.map(a => a.pm).filter(Boolean))
    return Array.from(pms).sort()
  }, [merged])

  // ── Filtered + sorted alerts ─────────────────────────────────────────────────
  const visible = useMemo(() => {
    let list = merged.filter(a => a.status !== 'dismissed')

    if (statusFilter === 'active')   list = list.filter(a => a.status === 'open' || a.status === 'snoozed')
    if (statusFilter === 'resolved') list = list.filter(a => a.status === 'resolved')

    if (severityFilter !== 'all') list = list.filter(a => a.severity === severityFilter)
    if (typeFilter !== 'all')     list = list.filter(a => a.type === typeFilter)
    if (zoneFilter !== 'all')     list = list.filter(a => a.zoneId === zoneFilter)
    if (pmFilter !== 'all')       list = list.filter(a => a.pm === pmFilter)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      const so = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
      if (so !== 0) return so
      const ta = a.createdAt?.seconds ?? (a.createdAt ? new Date(a.createdAt).getTime() / 1000 : 0)
      const tb = b.createdAt?.seconds ?? (b.createdAt ? new Date(b.createdAt).getTime() / 1000 : 0)
      return tb - ta
    })

    return list
  }, [merged, statusFilter, severityFilter, typeFilter, zoneFilter, pmFilter, search])

  // ── Summary stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active   = merged.filter(a => a.status === 'open' || a.status === 'snoozed')
    const critical = active.filter(a => a.severity === 'critical')
    const warning  = active.filter(a => a.severity === 'warning')
    const resolvedToday = merged.filter(a => a.status === 'resolved' && isToday(
      a.resolvedAt || (a.updatedAt?.seconds ? new Date(a.updatedAt.seconds * 1000).toISOString() : null)
    ))
    return { active: active.length, critical: critical.length, warning: warning.length, resolvedToday: resolvedToday.length }
  }, [merged])

  // ── Lifecycle mutations ───────────────────────────────────────────────────────
  async function applyAction(alert, newStatus, extra = {}) {
    const patch = { status: newStatus, ...extra }
    if (alert._docId) {
      await updateAgentAlert(alert._docId, patch)
    } else {
      await addAgentAlert({ ...alert, ...patch })
    }
  }

  function handleResolve(alert) {
    applyAction(alert, 'resolved', { resolvedAt: new Date().toISOString() })
  }

  function handleSnooze(alert) {
    applyAction(alert, 'snoozed', { snoozeUntil: new Date(Date.now() + 86400000).toISOString() })
  }

  function handleDismiss(alert) {
    applyAction(alert, 'dismissed')
  }

  // ── Re-scan ───────────────────────────────────────────────────────────────────
  async function handleRescan() {
    setRescanning(true)
    try {
      const fresh = generateAlerts(jobs, extras)
      await Promise.all(fresh.map(a => addAgentAlert({ ...a, status: a.status || 'open' })))
    } finally {
      setRescanning(false)
    }
  }

  function clearFilters() {
    setSeverityFilter('all')
    setTypeFilter('all')
    setZoneFilter('all')
    setPmFilter('all')
    setStatusFilter('active')
    setSearch('')
  }

  const hasFilters = severityFilter !== 'all' || typeFilter !== 'all' || zoneFilter !== 'all' ||
    pmFilter !== 'all' || statusFilter !== 'active' || search.trim() !== ''

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#0f0f0f', minHeight: '100vh', padding: '24px', fontFamily: 'inherit' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangleIcon size={22} color="#F47920" />
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: 0 }}>Alert Center</h1>
          <Badge style={{ background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', fontSize: 11 }}>
            {visible.length} shown
          </Badge>
        </div>
        <Button
          onClick={handleRescan}
          disabled={rescanning}
          style={{ background: '#1a1a1a', border: '1px solid #374151', color: '#9ca3af', gap: 6, display: 'flex', alignItems: 'center' }}
        >
          <RefreshCwIcon size={14} style={{ animation: rescanning ? 'spin 1s linear infinite' : 'none' }} />
          {rescanning ? 'Scanning…' : 'Re-scan Jobs'}
        </Button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Active',     value: stats.active,       color: '#F47920' },
          { label: 'Critical',         value: stats.critical,     color: '#ef4444' },
          { label: 'Warnings',         value: stats.warning,      color: '#f59e0b' },
          { label: 'Resolved Today',   value: stats.resolvedToday, color: '#22c55e' },
        ].map(s => (
          <div
            key={s.label}
            style={{ background: '#1a1a1a', border: '1px solid #374151', borderRadius: 8, padding: '14px 18px' }}
          >
            <div style={{ color: s.color, fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{s.value}</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* Filter sidebar */}
        <div style={{ width: 220, flexShrink: 0, background: '#1a1a1a', border: '1px solid #374151', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <FilterIcon size={13} color="#9ca3af" />
            <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filters</span>
            {hasFilters && (
              <button
                onClick={clearFilters}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#F47920', fontSize: 11, cursor: 'pointer', padding: 0 }}
              >
                Clear
              </button>
            )}
          </div>

          <Input
            placeholder="Search alerts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: '#111', border: '1px solid #374151', color: '#fff', fontSize: 12, marginBottom: 14, height: 32 }}
          />

          <FilterGroup label="Status" value={statusFilter} onChange={setStatusFilter} options={[
            { value: 'active',   label: 'Active' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all',      label: 'All' },
          ]} />

          <FilterGroup label="Severity" value={severityFilter} onChange={setSeverityFilter} options={[
            { value: 'all',      label: 'All' },
            { value: 'critical', label: 'Critical' },
            { value: 'warning',  label: 'Warning' },
            { value: 'info',     label: 'Info' },
          ]} />

          <FilterGroup label="Type" value={typeFilter} onChange={setTypeFilter} options={[
            { value: 'all', label: 'All' },
            ...Object.entries(ALERT_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v })),
          ]} />

          <FilterGroup label="Zone" value={zoneFilter} onChange={setZoneFilter} options={[
            { value: 'all', label: 'All Zones' },
            ...Object.values(ZONES).map(z => ({ value: z.id, label: z.name })),
          ]} />

          <FilterGroup label="PM" value={pmFilter} onChange={setPmFilter} options={[
            { value: 'all', label: 'All PMs' },
            ...allPMs.map(pm => ({ value: pm, label: pm })),
          ]} />
        </div>

        {/* Alert list */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.length === 0 && (
            <div style={{ background: '#1a1a1a', border: '1px solid #374151', borderRadius: 10, padding: '40px 24px', textAlign: 'center', color: '#4b5563' }}>
              <CheckCircleIcon size={32} style={{ margin: '0 auto 10px', display: 'block', color: '#22c55e' }} />
              <div style={{ fontSize: 14 }}>No alerts match the current filters.</div>
            </div>
          )}

          {visible.map(alert => (
            <AlertCard
              key={alert.id || alert._docId}
              alert={alert}
              onResolve={handleResolve}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function FilterGroup({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: '#6b7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              background: value === opt.value ? '#2d2d2d' : 'transparent',
              border: value === opt.value ? '1px solid #4b5563' : '1px solid transparent',
              color: value === opt.value ? '#fff' : '#9ca3af',
              borderRadius: 5,
              padding: '4px 8px',
              textAlign: 'left',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {value === opt.value && <CheckIcon size={10} color="#F47920" />}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function AlertCard({ alert, onResolve, onSnooze, onDismiss }) {
  const severityColor = SEVERITY_COLOR[alert.severity] || '#6b7280'
  const isResolved = alert.status === 'resolved'
  const isSnoozed  = alert.status === 'snoozed'
  const zoneName   = alert.zoneId ? (ZONES[alert.zoneId]?.name || alert.zoneId) : null

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #374151',
      borderRadius: 10,
      display: 'flex',
      overflow: 'hidden',
      opacity: isResolved ? 0.65 : 1,
    }}>
      {/* Left color bar */}
      <div style={{ width: 3, flexShrink: 0, background: severityColor }} />

      <div style={{ flex: 1, padding: '14px 16px' }}>
        {/* Top row: badges + status chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
            background: severityColor + '22', color: severityColor, border: `1px solid ${severityColor}55`,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <SeverityIcon severity={alert.severity} size={11} />
            {SEVERITY_LABEL[alert.severity] || alert.severity}
          </span>

          {alert.type && ALERT_TYPE_LABEL[alert.type] && (
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              background: '#1f2937', color: '#9ca3af', border: '1px solid #374151',
            }}>
              {ALERT_TYPE_LABEL[alert.type]}
            </span>
          )}

          {alert.pm && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#1f2937', color: '#a78bfa', border: '1px solid #4c1d95' }}>
              {alert.pm}
            </span>
          )}

          {zoneName && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#1f2937', color: '#67e8f9', border: '1px solid #164e63' }}>
              {zoneName}
            </span>
          )}

          <span style={{ marginLeft: 'auto', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: '#9ca3af' }}>
            <StatusDot status={alert.status} />
            {alert.status === 'open'     && 'Open'}
            {alert.status === 'snoozed'  && 'Snoozed'}
            {alert.status === 'resolved' && 'Resolved'}
          </span>
        </div>

        {/* Title */}
        <div style={{ color: '#fff', fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          {alert.title}
        </div>

        {/* Description */}
        {alert.description && (
          <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>
            {alert.description}
          </div>
        )}

        {/* Recommendation */}
        {alert.recommendation && (
          <div style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic', marginBottom: 8 }}>
            {alert.recommendation}
          </div>
        )}

        {/* Timestamps for resolved/snoozed */}
        {isResolved && alert.resolvedAt && (
          <div style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <CheckCircleIcon size={11} /> Resolved {fmtTs(alert.resolvedAt)}
          </div>
        )}
        {isSnoozed && alert.snoozeUntil && (
          <div style={{ fontSize: 11, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <ClockIcon size={11} /> Snoozed until {fmtTs(alert.snoozeUntil)}
          </div>
        )}

        {/* Actions */}
        {!isResolved && (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => onResolve(alert)}
              style={{
                background: '#14532d', border: '1px solid #166534', color: '#86efac',
                borderRadius: 5, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <CheckIcon size={12} /> Resolve
            </button>
            {!isSnoozed && (
              <button
                onClick={() => onSnooze(alert)}
                style={{
                  background: '#451a03', border: '1px solid #78350f', color: '#fcd34d',
                  borderRadius: 5, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <BellOffIcon size={12} /> Snooze 24h
              </button>
            )}
            <button
              onClick={() => onDismiss(alert)}
              style={{
                background: '#1a1a1a', border: '1px solid #374151', color: '#6b7280',
                borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <XIcon size={12} /> Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
