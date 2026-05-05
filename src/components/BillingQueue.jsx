import { useState } from 'react'
import { useData } from '../DataContext'
import { updateJob } from '../hooks/useFirestore'
import { ZONES, getZoneId } from '../agent/zones'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DollarSignIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon,
  TrendingUpIcon, RefreshCwIcon, CheckIcon, XIcon, FilterIcon,
  DownloadIcon,
} from 'lucide-react'

const O = '#F47920'

// ── Billing readiness helpers ─────────────────────────────────────────────────

function inspPassed(job, trade, phase) {
  return job.insp?.[trade]?.[phase] === 'passed'
}

function anyFinalPassed(job) {
  return (
    inspPassed(job, 'electrical', 'final') ||
    inspPassed(job, 'plumbing',   'final') ||
    inspPassed(job, 'hvac',       'final')
  )
}

function anyRoughPassed(job) {
  return (
    inspPassed(job, 'electrical', 'roughIn') ||
    inspPassed(job, 'plumbing',   'roughIn') ||
    inspPassed(job, 'hvac',       'roughIn')
  )
}

function isBillingReady(job) {
  const bs = job.billingStatus
  if (bs === 'invoiced' || bs === 'paid') return false
  const st = job.status
  if (st === 'complete' || st === 'completed') return false
  return anyFinalPassed(job) || anyRoughPassed(job)
}

function getMilestone(job) {
  if (anyFinalPassed(job)) return 'Final Inspection'
  return 'Rough-In'
}

function getBillingPct(job) {
  return anyFinalPassed(job) ? 0.30 : 0.70
}

function getContractValue(job) {
  return job.contractValue || 18000
}

function getBillableAmount(job) {
  return getContractValue(job) * getBillingPct(job)
}

// ── Passed inspection badges ──────────────────────────────────────────────────

const INSP_LABELS = [
  { trade: 'electrical', phase: 'roughIn', label: 'E rough' },
  { trade: 'plumbing',   phase: 'roughIn', label: 'P rough' },
  { trade: 'hvac',       phase: 'roughIn', label: 'H rough' },
  { trade: 'electrical', phase: 'final',   label: 'E final' },
  { trade: 'plumbing',   phase: 'final',   label: 'P final' },
  { trade: 'hvac',       phase: 'final',   label: 'H final' },
]

function PassedBadges({ job }) {
  const passed = INSP_LABELS.filter(x => inspPassed(job, x.trade, x.phase))
  if (!passed.length) return <span style={{ color: '#6b7280', fontSize: 12 }}>—</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {passed.map(x => (
        <span
          key={x.label}
          style={{
            background: x.phase === 'final' ? '#1e3a5f' : '#14532d',
            color:      x.phase === 'final' ? '#93c5fd' : '#86efac',
            border:     `1px solid ${x.phase === 'final' ? '#3b82f6' : '#22c55e'}`,
            borderRadius: 4, padding: '1px 5px', fontSize: 11, whiteSpace: 'nowrap',
          }}
        >
          {x.label}
        </span>
      ))}
    </div>
  )
}

// ── Currency formatter ────────────────────────────────────────────────────────

const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US')

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  return (
    <Card style={{ background: '#1a1a1a', border: '1px solid #374151', flex: 1, minWidth: 180 }}>
      <CardContent style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>{label}</p>
            <p style={{ color: color || '#f9fafb', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</p>
            {sub && <p style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>{sub}</p>}
          </div>
          <Icon size={20} style={{ color: color || '#6b7280', marginTop: 2 }} />
        </div>
      </CardContent>
    </Card>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function BillingRow({ job }) {
  const zoneId   = getZoneId(job)
  const zone     = ZONES[zoneId] || ZONES['zone-7']
  const milestone = getMilestone(job)
  const billable  = getBillableAmount(job)
  const contract  = getContractValue(job)
  const isFinal   = milestone === 'Final Inspection'

  const [invoiceVal, setInvoiceVal] = useState(job.invoiceNum || '')
  const [saving, setSaving]         = useState(false)
  const [marking, setMarking]       = useState(false)
  const [holding, setHolding]       = useState(false)

  async function handleInvoiceBlur() {
    if (!job._docId) return
    if (invoiceVal === (job.invoiceNum || '')) return
    setSaving(true)
    try { await updateJob(job._docId, { invoiceNum: invoiceVal }) }
    finally { setSaving(false) }
  }

  async function handleMarkInvoiced() {
    if (!job._docId) return
    setMarking(true)
    try { await updateJob(job._docId, { billingStatus: 'invoiced' }) }
    finally { setMarking(false) }
  }

  async function handleHold() {
    if (!job._docId) return
    setHolding(true)
    try { await updateJob(job._docId, { billingStatus: 'hold' }) }
    finally { setHolding(false) }
  }

  const isInvoiced = job.billingStatus === 'invoiced'
  const isHold     = job.billingStatus === 'hold'

  return (
    <tr style={{ borderBottom: '1px solid #1f2937' }}>
      {/* Job ID */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'monospace', color: O, fontSize: 13, fontWeight: 700 }}>{job.id}</span>
      </td>

      {/* Job name */}
      <td style={{ padding: '10px 12px' }}>
        <span style={{ color: '#f9fafb', fontWeight: 600, fontSize: 13 }}>{job.name || job.client?.split(' ')[0] || '—'}</span>
      </td>

      {/* PM */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#d1d5db', fontSize: 13 }}>{job.pm || '—'}</span>
      </td>

      {/* Zone */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: zone.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#d1d5db', fontSize: 12 }}>{zone.name}</span>
        </span>
      </td>

      {/* Milestone */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <span style={{
          background: isFinal ? '#1e3a5f' : '#14532d',
          color:      isFinal ? '#93c5fd' : '#86efac',
          border:     `1px solid ${isFinal ? '#3b82f6' : '#22c55e'}`,
          borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600,
        }}>
          {isFinal ? 'Final 30%' : 'Rough-In 70%'}
        </span>
      </td>

      {/* Billable */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
        <span style={{ color: O, fontWeight: 700, fontSize: 14 }}>{fmt(billable)}</span>
      </td>

      {/* Contract */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
        <span style={{ color: '#9ca3af', fontSize: 13 }}>{fmt(contract)}</span>
      </td>

      {/* Inspections passed */}
      <td style={{ padding: '10px 12px' }}>
        <PassedBadges job={job} />
      </td>

      {/* Billing status */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        {isInvoiced && (
          <span style={{ background: '#14532d', color: '#86efac', border: '1px solid #22c55e', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
            Invoiced
          </span>
        )}
        {isHold && (
          <span style={{ background: '#451a03', color: '#fdba74', border: '1px solid #f97316', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
            On Hold
          </span>
        )}
        {!isInvoiced && !isHold && (
          <span style={{ background: '#1c1917', color: '#a8a29e', border: '1px solid #57534e', borderRadius: 5, padding: '2px 8px', fontSize: 12 }}>
            {job.billingStatus || 'not-invoiced'}
          </span>
        )}
      </td>

      {/* Invoice # */}
      <td style={{ padding: '10px 12px' }}>
        <input
          value={invoiceVal}
          onChange={e => setInvoiceVal(e.target.value)}
          onBlur={handleInvoiceBlur}
          placeholder="Invoice #"
          style={{
            background: '#111827', border: '1px solid #374151', borderRadius: 5,
            color: '#f9fafb', padding: '4px 8px', fontSize: 12, width: 90,
            outline: 'none',
          }}
        />
        {saving && <span style={{ color: '#6b7280', fontSize: 10, marginLeft: 4 }}>saving…</span>}
      </td>

      {/* Actions */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        {isInvoiced ? (
          <span style={{
            background: '#14532d', color: '#86efac', border: '1px solid #22c55e',
            borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <CheckIcon size={12} /> Invoiced
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleMarkInvoiced}
              disabled={marking}
              style={{
                background: marking ? '#374151' : '#F47920', color: '#fff',
                border: 'none', borderRadius: 5, padding: '4px 10px',
                fontSize: 12, fontWeight: 600, cursor: marking ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <CheckIcon size={12} /> {marking ? '…' : 'Mark Invoiced'}
            </button>
            <button
              onClick={handleHold}
              disabled={holding || isHold}
              style={{
                background: 'transparent', color: '#9ca3af',
                border: '1px solid #374151', borderRadius: 5, padding: '4px 10px',
                fontSize: 12, cursor: holding || isHold ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, opacity: isHold ? 0.5 : 1,
              }}
            >
              <XIcon size={12} /> {holding ? '…' : 'Hold'}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BillingQueue() {
  const { jobs = [] } = useData()

  const [filterPM, setFilterPM]           = useState('all')
  const [filterMilestone, setFilterMilestone] = useState('all')
  const [sortBy, setSortBy]               = useState('amount')

  // All billing-ready jobs
  const readyJobs = jobs.filter(isBillingReady)

  // Summary stats
  const totalBillable  = readyJobs.reduce((s, j) => s + getBillableAmount(j), 0)
  const roughCount     = readyJobs.filter(j => getMilestone(j) === 'Rough-In').length
  const finalCount     = readyJobs.filter(j => getMilestone(j) === 'Final Inspection').length

  // PM list for filter
  const uniquePMs = ['all', ...Array.from(new Set(readyJobs.map(j => j.pm).filter(Boolean))).sort()]

  // Filtered + sorted
  let display = [...readyJobs]
  if (filterPM !== 'all')        display = display.filter(j => j.pm === filterPM)
  if (filterMilestone !== 'all') display = display.filter(j => getMilestone(j) === filterMilestone)

  display.sort((a, b) => {
    if (sortBy === 'amount') return getBillableAmount(b) - getBillableAmount(a)
    if (sortBy === 'pm')     return (a.pm || '').localeCompare(b.pm || '')
    if (sortBy === 'zone')   return getZoneId(a).localeCompare(getZoneId(b))
    if (sortBy === 'name')   return (a.name || '').localeCompare(b.name || '')
    return 0
  })

  const selectStyle = {
    background: '#111827', border: '1px solid #374151', borderRadius: 6,
    color: '#d1d5db', padding: '6px 10px', fontSize: 13, cursor: 'pointer', outline: 'none',
  }

  return (
    <div style={{ padding: '24px 28px', color: '#f9fafb', maxWidth: 1600 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DollarSignIcon size={22} style={{ color: O }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#f9fafb' }}>Billing Queue</h2>
          <span style={{
            background: '#1a1a1a', border: '1px solid #374151', borderRadius: 12,
            padding: '2px 10px', fontSize: 12, color: '#9ca3af',
          }}>
            {display.length} jobs
          </span>
        </div>
        <button
          style={{
            background: 'transparent', border: '1px solid #374151', borderRadius: 6,
            color: '#9ca3af', padding: '6px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
          }}
          title="Export CSV — coming soon"
        >
          <DownloadIcon size={14} /> Export
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <SummaryCard icon={AlertCircleIcon} label="Billing Ready"          value={readyJobs.length}  color={O} />
        <SummaryCard icon={TrendingUpIcon}  label="Total Est. Billable"    value={fmt(totalBillable)} color='#22c55e' sub="across all ready jobs" />
        <SummaryCard icon={ClockIcon}       label="Rough-In Milestone"     value={roughCount}         sub="70% billing" />
        <SummaryCard icon={CheckCircleIcon} label="Final Milestone"        value={finalCount}         sub="30% billing" color='#3b82f6' />
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <FilterIcon size={14} style={{ color: '#6b7280' }} />

        <select value={filterPM} onChange={e => setFilterPM(e.target.value)} style={selectStyle}>
          <option value="all">All PMs</option>
          {uniquePMs.filter(p => p !== 'all').map(pm => (
            <option key={pm} value={pm}>{pm}</option>
          ))}
        </select>

        <select value={filterMilestone} onChange={e => setFilterMilestone(e.target.value)} style={selectStyle}>
          <option value="all">All Milestones</option>
          <option value="Rough-In">Rough-In</option>
          <option value="Final Inspection">Final Inspection</option>
        </select>

        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selectStyle}>
          <option value="amount">Sort: Billable Amount</option>
          <option value="pm">Sort: PM</option>
          <option value="zone">Sort: Zone</option>
          <option value="name">Sort: Job Name</option>
        </select>

        {(filterPM !== 'all' || filterMilestone !== 'all') && (
          <button
            onClick={() => { setFilterPM('all'); setFilterMilestone('all') }}
            style={{
              background: 'transparent', border: '1px solid #374151', borderRadius: 6,
              color: '#9ca3af', padding: '6px 10px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table or empty state */}
      {display.length === 0 ? (
        <div style={{
          background: '#1a1a1a', border: '1px solid #374151', borderRadius: 10,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <CheckCircleIcon size={36} style={{ color: '#22c55e', marginBottom: 12 }} />
          <p style={{ color: '#86efac', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>All jobs are up to date on billing</p>
          <p style={{ color: '#6b7280', fontSize: 13 }}>No jobs ready to invoice at this time.</p>
        </div>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #374151', borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#111827', borderBottom: '1px solid #374151' }}>
                {[
                  'Job ID', 'Name', 'PM', 'Zone', 'Milestone',
                  'Billable', 'Contract', 'Inspections', 'Status',
                  'Invoice #', 'Actions',
                ].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 12px', color: '#9ca3af', fontWeight: 600,
                      textAlign: i >= 5 && i <= 6 ? 'right' : 'left',
                      fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.map(job => (
                <BillingRow key={job._docId || job.id} job={job} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      <p style={{ marginTop: 14, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        Send to Abby / Randi for invoicing. Contact:{' '}
        <a href="mailto:billing@p2electrical.com" style={{ color: O, textDecoration: 'none' }}>
          billing@p2electrical.com
        </a>
      </p>
    </div>
  )
}
