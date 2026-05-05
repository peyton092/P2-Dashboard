import { useMemo } from 'react'
import { useData } from '../DataContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
} from 'recharts'

const O = '#F47920'

const PHASE_COLORS = ['#3b82f6', O, '#22c55e']
const INSP_COLORS  = { passed: '#22c55e', failed: '#ef4444', scheduled: '#eab308', pending: '#6b7280', blocked: '#3b82f6' }

const fmtDollar = (n) => `$${Number(n || 0).toLocaleString()}`

const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-white/10 px-3 py-2 text-xs shadow-xl"
      style={{ backgroundColor: 'oklch(0.18 0 0)' }}>
      {label && <p className="font-semibold mb-1 text-white">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.fill || '#fff' }}>
          {p.name}: <span className="font-bold">{typeof p.value === 'number' && p.name?.includes('$') ? fmtDollar(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
      className="text-xs font-bold" style={{ fill: '#fff', fontSize: 11 }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function Analytics() {
  const { jobs = [], extras = [], loading } = useData()

  if (loading && jobs.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-full border-2 animate-spin"
            style={{ borderColor: O + '33', borderTopColor: O }} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: O }}>Analytics</h1>
            <p className="text-sm text-muted-foreground">Loading portfolio data…</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/5 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // ── 1. Job Phase Distribution ───────────────────────────────────────────────
  const phaseData = useMemo(() => {
    const bins = { 'Rough-In': 0, 'Mid Phase': 0, 'Final Phase': 0 }
    jobs.forEach(j => {
      const p = j.progress ?? 0
      if (p < 34)       bins['Rough-In']++
      else if (p < 67)  bins['Mid Phase']++
      else              bins['Final Phase']++
    })
    return Object.entries(bins).map(([name, value]) => ({ name, value }))
  }, [jobs])

  // ── 2. Sub Performance ─────────────────────────────────────────────────────
  const subData = useMemo(() => {
    const map = {}
    jobs.forEach(j => {
      const trades = j.subs || {}
      const insp   = j.insp  || {}
      ;['electrical', 'plumbing', 'hvac'].forEach(trade => {
        const sub = trades[trade]
        if (!sub || sub === 'null') return
        if (!map[sub]) map[sub] = { name: sub, jobs: 0, passed: 0, total: 0 }
        map[sub].jobs++
        const stages = Object.values(insp[trade] || {})
        stages.forEach(s => {
          if (s === 'n/a') return
          map[sub].total++
          if (s === 'passed') map[sub].passed++
        })
      })
    })
    return Object.values(map)
      .map(s => ({ ...s, passRate: s.total ? Math.round((s.passed / s.total) * 100) : 0 }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 8)
  }, [jobs])

  // ── 3. Inspection Pass Rate Donut ──────────────────────────────────────────
  const inspData = useMemo(() => {
    const counts = { passed: 0, failed: 0, scheduled: 0, pending: 0, blocked: 0 }
    jobs.forEach(j => {
      const insp = j.insp || {}
      Object.values(insp).forEach(trade => {
        Object.values(trade || {}).forEach(s => {
          if (s && s !== 'n/a' && counts[s] !== undefined) counts[s]++
        })
      })
    })
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value, key: name }))
  }, [jobs])

  // ── 4. Extras Conversion ───────────────────────────────────────────────────
  const extrasData = useMemo(() => {
    if (extras.length > 0) {
      const map = {}
      extras.forEach(e => {
        const label = e.job || e.jobId || 'Unknown'
        if (!map[label]) map[label] = { name: label, approved: 0, pending: 0 }
        const amt = Number(e.amount) || 0
        if (e.status === 'approved' || e.status === 'sent-to-qbs') map[label].approved += amt
        else if (e.status === 'pending' || !e.status)              map[label].pending  += amt
      })
      return Object.values(map).sort((a, b) => (b.approved + b.pending) - (a.approved + a.pending)).slice(0, 10)
    }
    // Fall back to job.extras dollar totals
    return jobs
      .filter(j => (j.extras || 0) > 0)
      .map(j => ({ name: j.name || j.id, approved: j.extras || 0, pending: 0 }))
      .sort((a, b) => b.approved - a.approved)
      .slice(0, 10)
  }, [jobs, extras])

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalJobs   = jobs.length
  const activeJobs  = jobs.filter(j => !['complete', 'completed'].includes(j.status)).length
  const avgProgress = totalJobs ? Math.round(jobs.reduce((s, j) => s + (j.progress || 0), 0) / totalJobs) : 0
  const totalExtras = extras.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: O }}>Analytics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Portfolio overview across {totalJobs} jobs</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Jobs',     value: activeJobs  },
          { label: 'Avg Progress',    value: `${avgProgress}%` },
          { label: 'Total Jobs',      value: totalJobs   },
          { label: 'Total Extras',    value: fmtDollar(totalExtras) },
        ].map(({ label, value }) => (
          <Card key={label} className="border-white/10 bg-white/5">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
              <p className="text-2xl font-semibold" style={{ color: O }}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 1: Phase Pie + Insp Donut */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Phase Distribution */}
        <Card className="border-white/10 bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-white/80">Job Phase Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={phaseData} cx="50%" cy="50%" outerRadius={90}
                  dataKey="value" labelLine={false} label={<PieLabel />}>
                  {phaseData.map((_, i) => (
                    <Cell key={i} fill={PHASE_COLORS[i % PHASE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Inspection Pass Rate Donut */}
        <Card className="border-white/10 bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-white/80">Inspection Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={inspData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                  dataKey="value" labelLine={false} label={<PieLabel />}>
                  {inspData.map((entry) => (
                    <Cell key={entry.key} fill={INSP_COLORS[entry.key] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Sub Performance */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-white/80">Sub Performance — Inspection Pass Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={subData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false}
                domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <Tooltip content={<DarkTooltip />} />
              <Bar dataKey="passRate" name="Pass Rate %" fill={O} radius={[4, 4, 0, 0]} maxBarSize={48}>
                <LabelList dataKey="jobs" position="top"
                  style={{ fill: '#9ca3af', fontSize: 10 }}
                  formatter={v => `${v}j`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-1">Bar height = pass rate. Top label = job count.</p>
        </CardContent>
      </Card>

      {/* Row 3: Extras Conversion */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-white/80">Extras by Job</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={extrasData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<DarkTooltip />} />
              <Bar dataKey="approved" name="Approved $" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} maxBarSize={48} />
              <Bar dataKey="pending"  name="Pending $"  stackId="a" fill="#eab308" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#22c55e' }} /> Approved</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#eab308' }} /> Pending</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
