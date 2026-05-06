import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpIcon } from 'lucide-react'

// Legacy stat card — used by Architecture and Permits inline tabs that
// haven't been redesigned with `MetricTile` yet. Behavior preserved exactly.
// Moved out of src/App.jsx in Phase 19.

const O = '#F47920' // Brand orange — kept local to avoid coupling to App.jsx.

export function StatCard({ label, value, sub, trend, Icon }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{label}</p>
          {Icon && <div className="p-2 rounded-lg" style={{ backgroundColor: O + '22' }}><Icon size={16} style={{ color: O }} /></div>}
        </div>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
        {trend !== undefined && (
          <div className="flex items-center gap-1 mt-2">
            <ArrowUpIcon size={11} style={{ color: trend ? '#22c55e' : '#ef4444', transform: trend ? 'none' : 'rotate(180deg)' }} />
            <span className="text-xs" style={{ color: trend ? '#22c55e' : '#ef4444' }}>
              {trend ? '+8%' : '-3%'} vs last month
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
