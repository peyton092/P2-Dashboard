import {
  ZapIcon, WrenchIcon, HammerIcon,
  FileTextIcon, ClockIcon, CheckCircleIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useData } from '../DataContext'
import { updatePermit } from '../hooks/useFirestore'
import { StatCard, InspBadge, JobBadge, iMeta } from './shared'

// Phase 20 — extracted from src/App.jsx. Behavior preserved exactly. The
// local SectionHeader is intentionally inlined here (it differs from the
// modern shared/headers SectionHeader and is only used by legacy tabs).

const O = '#F47920'

function SectionHeader({ title, sub, action }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export default function Permits() {
  const { jobs } = useData()
  const allPermits = jobs.flatMap(j =>
    ['electrical', 'plumbing', 'hvac'].filter(t => j.permits[t]).map(t => ({
      job: j.id, address: j.address, trade: t, status: j.permits[t],
    }))
  )
  const approved = allPermits.filter(p => ['approved','finaled'].includes(p.status)).length
  const pending  = allPermits.filter(p => p.status === 'pending').length
  const applied  = allPermits.filter(p => p.status === 'applied').length

  return (
    <div className="space-y-6">
      <SectionHeader title="Permits" sub="Permit status across all active jobs and trades" />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Approved / Finaled" value={approved} Icon={CheckCircleIcon} />
        <StatCard label="Applied / Pending"  value={applied + pending} sub="awaiting approval" Icon={ClockIcon} />
        <StatCard label="Total Permits"      value={allPermits.length} Icon={FileTextIcon} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {jobs.map(j => (
          <Card key={j.id} className="border-white/10">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between">
                <span><span className="" style={{ color: O }}>{j.id}</span> — {j.address}</span>
                <JobBadge status={j.status} />
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
                        style={{ color: iMeta(pStatus).color, backgroundColor: iMeta(pStatus).color + '22', border: `1px solid ${iMeta(pStatus).color}44` }}
                      >
                        {PERMIT_STATUSES.map(s => (
                          <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>{s.toUpperCase()}</option>
                        ))}
                      </select>
                    ) : (
                      <InspBadge status={pStatus} />
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
