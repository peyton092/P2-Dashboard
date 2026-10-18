import {
  ZapIcon, WrenchIcon, HammerIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useData } from '../use-data'
import { updatePermit } from '../hooks/useFirestore'
import { SectionHeader, StatBand, StatusBadge, PermitBadge } from './shared'
import { BRAND, withAlpha } from '@/lib/tokens'
import { PERMIT_STATUS, TRADE, statusColor, statusLabel } from '../lib/status'

// Extracted from src/App.jsx in Phase 20. Behavior preserved exactly.

// The statuses a person can pick for a permit, in the order of the vocabulary.
const PERMIT_STATUSES = Object.keys(PERMIT_STATUS)

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
      <SectionHeader title="Permits" description="Permit status across all active jobs and trades" />

      <StatBand
        stats={[
          { label: 'Approved / Finaled', value: approved },
          { label: 'Applied / Pending', value: applied + pending, sub: 'awaiting approval' },
          { label: 'Total Permits', value: allPermits.length },
        ]}
      />

      <div className="grid md:grid-cols-2 gap-4">
        {jobs.map(j => (
          <Card key={j.id} className="border-white/10">
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between">
                <span><span className="" style={{ color: BRAND }}>{j.id}</span> — {j.address}</span>
                <StatusBadge status={j.status} size="xs" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {['electrical','plumbing','hvac'].map(t => {
                if (!j.permits[t]) return null
                const pStatus = j.permits[t]
                const permitColor = statusColor(PERMIT_STATUS, pStatus)
                return (
                  <div key={t} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      {t === 'electrical' ? <ZapIcon size={14} color={statusColor(TRADE, t)} /> :
                       t === 'plumbing'   ? <WrenchIcon size={14} color={statusColor(TRADE, t)} /> :
                                            <HammerIcon size={14} color={statusColor(TRADE, t)} />}
                      <span className="text-sm capitalize font-medium">{t}</span>
                    </div>
                    {j._docId ? (
                      <select
                        value={pStatus}
                        onChange={e => updatePermit(j._docId, t, e.target.value)}
                        className="text-xs font-bold px-2 py-0.5 rounded-full cursor-pointer appearance-none"
                        style={{ color: permitColor, backgroundColor: withAlpha(permitColor, 0.13), border: `1px solid ${withAlpha(permitColor, 0.27)}` }}
                      >
                        {PERMIT_STATUSES.map(s => (
                          <option key={s} value={s} style={{ backgroundColor: '#111', color: '#fff' }}>{statusLabel(PERMIT_STATUS, s)}</option>
                        ))}
                      </select>
                    ) : (
                      <PermitBadge status={pStatus} size="xs" />
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
