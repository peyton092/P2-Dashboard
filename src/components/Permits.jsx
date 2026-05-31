import { useMemo } from 'react'
import {
  ZapIcon, WrenchIcon, HammerIcon,
  FileTextIcon, ClockIcon, CheckCircleIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useData } from '../DataContext'
import { updatePermit } from '../hooks/useFirestore'
import {
  PageHeader, MetricTile, InspectionBadge, StatusBadge,
  STATUS_COLORS, LiveDot, ExportCsvButton,
} from './shared'

const PERMIT_COLOR = {
  pending:  STATUS_COLORS.mute,
  applied:  STATUS_COLORS.warning,
  approved: STATUS_COLORS.success,
  finaled:  STATUS_COLORS.success,
  denied:   STATUS_COLORS.critical,
}
const permitColor = (s) => PERMIT_COLOR[s] || STATUS_COLORS.neutral

const O = '#F47920'

export default function Permits() {
  const { jobs } = useData()
  const allPermits = useMemo(() => jobs.flatMap(j =>
    ['electrical', 'plumbing', 'hvac'].filter(t => j.permits[t]).map(t => ({
      job: j.id, address: j.address, trade: t, status: j.permits[t],
    }))
  ), [jobs])
  const approved = allPermits.filter(p => ['approved','finaled'].includes(p.status)).length
  const pending  = allPermits.filter(p => p.status === 'pending').length
  const applied  = allPermits.filter(p => p.status === 'applied').length
  const denied   = allPermits.filter(p => p.status === 'denied').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Permits"
        title="Permit board"
        subtitle="Permit status across all active jobs and trades — keep approvals moving so work doesn't stall."
        meta={
          <>
            <LiveDot />
            <span>{allPermits.length} permits</span>
            {denied > 0 && <span className="text-red-300">{denied} denied</span>}
          </>
        }
        actions={
          <ExportCsvButton
            filename="p2-permits"
            columns={[
              { label: 'Job',     get: p => p.job },
              { label: 'Address', get: p => p.address || '' },
              { label: 'Trade',   get: p => p.trade },
              { label: 'Status',  get: p => p.status || '' },
            ]}
            rows={allPermits}
            title="Export the permit list to CSV"
          />
        }
      />

      {/* KPI strip */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Permit pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Approved / Finaled"
          value={approved}
          Icon={CheckCircleIcon}
          emphasis={approved > 0 ? 'success' : 'mute'}
        />
        <MetricTile
          label="Applied / Pending"
          value={applied + pending}
          Icon={ClockIcon}
          emphasis={(applied + pending) > 0 ? 'warning' : 'mute'}
          sub="awaiting approval"
        />
        <MetricTile
          label="Total Permits"
          value={allPermits.length}
          Icon={FileTextIcon}
        />
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        {jobs.map(j => (
          <Card key={j.id} className="border-white/10">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between">
                <span><span className="" style={{ color: O }}>{j.id}</span> — {j.address}</span>
                <StatusBadge status={j.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {['electrical','plumbing','hvac'].map(t => {
                if (!j.permits[t]) return null
                const pStatus = j.permits[t]
                const PERMIT_STATUSES = ['pending','applied','approved','finaled','denied']
                return (
                  <div key={t} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      {t === 'electrical' ? <ZapIcon size={14} style={{ color: O }} /> :
                       t === 'plumbing'   ? <WrenchIcon size={14} color="#06b6d4" /> :
                                            <HammerIcon size={14} color="#3b82f6" />}
                      <span className="text-sm capitalize font-medium">{t}</span>
                    </div>
                    {j._docId ? (
                      <select
                        value={pStatus}
                        onChange={e => updatePermit(j._docId, t, e.target.value)}
                        className="text-xs font-bold px-2 py-0.5 rounded-full cursor-pointer appearance-none"
                        style={{ color: permitColor(pStatus), backgroundColor: permitColor(pStatus) + '22', border: `1px solid ${permitColor(pStatus)}44` }}
                      >
                        {PERMIT_STATUSES.map(s => (
                          <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>{s.toUpperCase()}</option>
                        ))}
                      </select>
                    ) : (
                      <InspectionBadge status={pStatus} />
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
