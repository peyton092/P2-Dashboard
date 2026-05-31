import { useState, useMemo } from 'react'
import { useData } from '../DataContext'
import { addMaterial, updateMaterial, addHistory, useHistory } from '../hooks/useFirestore'
import { exportToCsv } from '../lib/exportCsv'
import {
  PageHeader, MetricTile, DataPanel, Pill, LiveDot,
  EmptyState, AllClearState, FilterBar,
} from './shared'
import {
  MAT_STATUS_OPTIONS, MAT_STATUS_COLOR, MAT_UNITS, MAT_STATUS_TONE,
  MAT_FILTERS, MAT_FORM_INITIAL,
  matMatchesFilter, fmtMatDate, normalizeMatStatus,
  matName, matJobId, matOrdered,
  matDaysUntilNeeded, matIsOpen, matIsOverdue, matIsBlocking, matIsRecent,
  matNextAction,
} from '../lib/materials'
import {
  ActivityIcon, AlertTriangleIcon, CheckCircleIcon, DownloadIcon, HardHatIcon,
  PackageIcon, PencilIcon, PlusIcon, TriangleAlertIcon, TruckIcon,
} from 'lucide-react'

const O = '#F47920'

// ── Tab: Materials ────────────────────────────────────────────────────────────


// ── Materials tab ────────────────────────────────────────────────────────────

export default function Materials() {
  const { jobs = [], materials: MATERIALS = [] } = useData()
  const { history: HISTORY = [] } = useHistory()
  const [filter, setFilter]               = useState('all')
  const [filterJob, setFilterJob]         = useState('all')
  const [showForm, setShowForm]           = useState(false)
  const [editId, setEditId]               = useState(null)
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [form, setForm]                   = useState(MAT_FORM_INITIAL)
  const [saving, setSaving]               = useState(false)

  // ── Derived ────────────────────────────────────────────────────────────────

  const enriched = useMemo(() => MATERIALS.map(m => ({
    m,
    status:    normalizeMatStatus(m.status),
    overdue:   matIsOverdue(m),
    blocking:  matIsBlocking(m),
    open:      matIsOpen(m),
    daysUntil: matDaysUntilNeeded(m),
    recent:    matIsRecent(m),
  })), [MATERIALS])

  // KPI counts — derived from full set, not the filtered list.
  const kpis = useMemo(() => {
    const open       = enriched.filter(e => e.open).length
    const urgent     = enriched.filter(e => e.overdue).length
    const blockJobs  = new Set(enriched.filter(e => e.open).map(e => matJobId(e.m)).filter(Boolean)).size
    const delivered  = enriched.filter(e => ['Delivered', 'At Job Site'].includes(e.status)).length
    const recent     = enriched.filter(e => e.recent).length
    return { open, urgent, blockJobs, delivered, recent }
  }, [enriched])

  // Chip counts (reflect what would show under each chip BEFORE the job filter).
  const chipCounts = useMemo(() => {
    const out = {}
    MAT_FILTERS.forEach(f => { out[f.id] = enriched.filter(e => matMatchesFilter(e.m, f.id)).length })
    return out
  }, [enriched])

  // Apply filter + job, then sort: overdue first, then blocking, then open
  // by closest dateNeeded, then everything else by recency.
  const visible = useMemo(() => {
    return enriched
      .filter(e => matMatchesFilter(e.m, filter))
      .filter(e => filterJob === 'all' || matJobId(e.m) === filterJob)
      .slice()
      .sort((a, b) => {
        if (a.overdue !== b.overdue)   return a.overdue ? -1 : 1
        if (a.blocking !== b.blocking) return a.blocking ? -1 : 1
        if (a.open !== b.open)         return a.open ? -1 : 1
        const aDays = a.daysUntil ?? Infinity
        const bDays = b.daysUntil ?? Infinity
        if (aDays !== bDays) return aDays - bDays
        const aTs = a.m.createdAt?.seconds ?? 0
        const bTs = b.m.createdAt?.seconds ?? 0
        return bTs - aTs
      })
  }, [enriched, filter, filterJob])

  const filterChips = MAT_FILTERS.map(f => ({
    value: f.id,
    label: f.label,
    active: filter === f.id,
    count: chipCounts[f.id] ?? 0,
    onClick: () => setFilter(f.id),
  }))

  const hasActiveFilters = filter !== 'all' || filterJob !== 'all'

  // ── Mutations (preserved verbatim from prior implementation) ───────────────

  const handleStatusChange = async (docId, newStatus) => {
    const m = MATERIALS.find(x => x._docId === docId)
    if (!m) return
    const oldStatus = normalizeMatStatus(m.status)
    await updateMaterial(docId, { status: newStatus })
    await addHistory({
      materialDocId: docId,
      materialName:  matName(m),
      jobId:         matJobId(m),
      fromStatus:    oldStatus,
      toStatus:      newStatus,
      type:          'status_change',
    })
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const job = jobs.find(j => j.id === form.jobId)
    const data = {
      name:        form.name.trim(),
      item:        form.name.trim(),
      qty:         Number(form.qty) || 1,
      unit:        form.unit,
      jobId:       form.jobId,
      job:         form.jobId,
      jobName:     job?.client || '',
      status:      form.status,
      vendor:      form.vendor.trim(),
      dateOrdered: form.dateOrdered,
      dateNeeded:  form.dateNeeded,
      notes:       form.notes.trim(),
      cost:        0,
    }
    if (editId) {
      await updateMaterial(editId, data)
      await addHistory({ materialDocId: editId, materialName: data.name, jobId: data.jobId, type: 'edited' })
    } else {
      await addMaterial(data)
    }
    setForm(MAT_FORM_INITIAL)
    setShowForm(false)
    setEditId(null)
    setSaving(false)
  }

  const openRequest = () => {
    setForm(MAT_FORM_INITIAL)
    setEditId(null)
    setShowForm(true)
  }

  const openEdit = (m) => {
    setForm({
      name:        matName(m),
      qty:         m.qty || 1,
      unit:        m.unit || 'ea',
      jobId:       matJobId(m),
      status:      normalizeMatStatus(m.status),
      vendor:      m.vendor || '',
      dateOrdered: matOrdered(m),
      dateNeeded:  m.dateNeeded || '',
      notes:       m.notes || '',
    })
    setEditId(m._docId)
    setShowForm(true)
  }

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(MAT_FORM_INITIAL) }

  const matHistory = (docId) => HISTORY.filter(h => h.materialDocId === docId)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Materials"
        title="Materials control"
        subtitle="Order, track, and confirm everything the field needs to keep work moving."
        meta={
          <>
            <LiveDot />
            <span>{kpis.open} open</span>
            {kpis.urgent > 0 && (
              <span className="text-red-300">{kpis.urgent} overdue</span>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => exportToCsv('p2-materials', [
                { label: 'Item',         get: r => matName(r.m) },
                { label: 'Job',          get: r => matJobId(r.m) },
                { label: 'Status',       get: r => r.status },
                { label: 'Quantity',     get: r => r.m.qty ?? '' },
                { label: 'Unit',         get: r => r.m.unit || '' },
                { label: 'Vendor',       get: r => r.m.vendor || '' },
                { label: 'Ordered',      get: r => r.m.dateOrdered || '' },
                { label: 'Needed',       get: r => r.m.dateNeeded || '' },
                { label: 'Days Until',   get: r => r.daysUntil ?? '' },
                { label: 'Overdue',      get: r => r.overdue ? 'yes' : 'no' },
                { label: 'PO #',         get: r => r.m.poNum || '' },
              ], visible)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
              title="Export the current materials list to CSV"
            >
              <DownloadIcon size={13} /> Export
            </button>
            <button
              type="button"
              onClick={openRequest}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
              style={{ backgroundColor: O }}
            >
              <PlusIcon size={13} /> Request material
            </button>
          </>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Materials pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Open Requests"
          value={kpis.open}
          Icon={PackageIcon}
          emphasis={kpis.open > 0 ? 'default' : 'success'}
          sub={kpis.open > 0 ? 'Ordered or in transit' : 'Nothing pending'}
        />
        <MetricTile
          label="Urgent"
          value={kpis.urgent}
          Icon={TriangleAlertIcon}
          emphasis={kpis.urgent > 0 ? 'critical' : 'success'}
          sub={kpis.urgent > 0 ? 'Past needed-by date' : 'No overdue items'}
        />
        <MetricTile
          label="Blocking Jobs"
          value={kpis.blockJobs}
          Icon={HardHatIcon}
          emphasis={kpis.blockJobs > 0 ? 'warning' : 'success'}
          sub={kpis.blockJobs > 0 ? 'Jobs awaiting materials' : 'No materials blocking work'}
        />
        <MetricTile
          label="Delivered / Ready"
          value={kpis.delivered}
          Icon={CheckCircleIcon}
          emphasis={kpis.delivered > 0 ? 'success' : 'mute'}
          sub={kpis.delivered > 0 ? 'On site or delivered' : 'No deliveries logged'}
        />
        <MetricTile
          label="Recent Updates"
          value={kpis.recent}
          Icon={TruckIcon}
          emphasis={kpis.recent > 0 ? 'default' : 'mute'}
          sub="Last 24 hours"
        />
      </section>

      {/* Filters — chips + job select */}
      <FilterBar
        chips={filterChips}
        trailing={
          <>
            <select
              value={filterJob}
              onChange={e => setFilterJob(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[220px]"
              aria-label="Filter by job"
            >
              <option value="all">All jobs</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} — {j.client || j.name || ''}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setFilterJob('all') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Add / Edit panel — toggles open from the page header action */}
      {showForm && (
        <MaterialForm
          form={form}
          setForm={setForm}
          jobs={jobs}
          editing={!!editId}
          saving={saving}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      )}

      {/* Materials queue */}
      <DataPanel
        title="Materials Queue"
        description={
          visible.length === 0
            ? 'No materials match the current filters.'
            : `${visible.length} of ${enriched.length} item${enriched.length === 1 ? '' : 's'}`
        }
        Icon={PackageIcon}
        padding="none"
      >
        {visible.length === 0 ? (
          <div className="p-5">
            <MaterialsEmptyState filter={filter} hasJobFilter={filterJob !== 'all'} onRequest={openRequest} />
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(({ m, status, overdue, daysUntil }) => {
              const docKey = m._docId || m.id
              const hist = matHistory(m._docId)
              const showHist = expandedHistory === docKey
              return (
                <li key={docKey}>
                  <MaterialCard
                    m={m}
                    status={status}
                    overdue={overdue}
                    daysUntil={daysUntil}
                    history={hist}
                    showHistory={showHist}
                    onToggleHistory={() => setExpandedHistory(showHist ? null : docKey)}
                    onEdit={() => openEdit(m)}
                    onStatusChange={handleStatusChange}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </DataPanel>
    </div>
  )
}

function MaterialsEmptyState({ filter, hasJobFilter, onRequest }) {
  if (filter === 'urgent')    return <AllClearState title="No urgent materials" description="Nothing is past its needed-by date." />
  if (filter === 'blocking')  return <AllClearState title="No materials blocking work" description="No open items needed within 7 days." />
  if (filter === 'needed')    return <AllClearState title="Nothing needed" description="Every active material has been delivered or used." />
  if (filter === 'ordered')   return <EmptyState   title="No materials in 'Ordered' status" description="Items waiting on a supplier will appear here." />
  if (filter === 'delivered') return <EmptyState   title="No deliveries yet" description="Items marked Delivered or At Job Site will appear here." />
  if (hasJobFilter)           return <EmptyState   title="No materials for that job" description="Try clearing the job filter or request a new material." />
  return (
    <EmptyState
      Icon={PackageIcon}
      title="No materials yet"
      description="Track every material the field is waiting on. Start with the first request."
      action={
        <button
          type="button"
          onClick={onRequest}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors"
          style={{ backgroundColor: O }}
        >
          <PlusIcon size={13} /> Request material
        </button>
      }
    />
  )
}

function MaterialCard({
  m, status, overdue, daysUntil,
  history, showHistory, onToggleHistory,
  onEdit, onStatusChange,
}) {
  const tone = MAT_STATUS_TONE[status] || 'mute'
  const railColor = overdue
    ? '#ef4444'
    : (MAT_STATUS_COLOR[status] || '#6b7280')
  const action = matNextAction(m)
  const orderedDate = matOrdered(m)
  const neededDate  = m.dateNeeded
  const jobId       = matJobId(m)

  // Plain-English needed-date helper.
  const neededLabel = (() => {
    if (!neededDate) return null
    const fmt = fmtMatDate(neededDate)
    if (overdue && daysUntil !== null) return `${Math.abs(daysUntil)}d overdue`
    if (daysUntil === 0)               return 'Needed today'
    if (daysUntil === 1)               return 'Needed tomorrow'
    if (daysUntil !== null && daysUntil <= 7) return `Due in ${daysUntil}d`
    return `Needed ${fmt}`
  })()

  const neededColor =
    overdue ? '#ef4444' :
    (daysUntil !== null && daysUntil <= 7) ? '#eab308' : '#9ca3af'

  return (
    <div
      className="px-4 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-white/[0.015]"
      style={{ borderLeft: `3px solid ${railColor}` }}
    >
      {/* Header row — name, job pill, urgency tag */}
      <div className="flex items-start gap-2 mb-1.5 flex-wrap">
        {jobId && (
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {jobId}
          </span>
        )}
        <span className="text-sm font-semibold text-white truncate min-w-0 flex-1">
          {matName(m)}
        </span>
        {overdue && (
          <Pill tone="critical" size="xs" Icon={AlertTriangleIcon}>
            Overdue
          </Pill>
        )}
      </div>

      {/* Meta line — qty / vendor / dates / notes */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 mb-2">
        <span className="font-semibold text-zinc-300 tabular-nums">
          {m.qty || 0} {m.unit || 'ea'}
        </span>
        {m.vendor && (
          <span className="inline-flex items-center gap-1">
            <TruckIcon size={11} /> {m.vendor}
          </span>
        )}
        {orderedDate && (
          <span>Ordered {fmtMatDate(orderedDate)}</span>
        )}
        {neededLabel && (
          <span className="font-semibold" style={{ color: neededColor }}>
            {neededLabel}
          </span>
        )}
      </div>

      {m.notes && (
        <p className="text-[11px] text-zinc-300 italic mb-2 leading-snug truncate" title={m.notes}>
          {m.notes}
        </p>
      )}

      {/* Action / status row */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-400 shrink-0">Next</span>
          <p
            className="text-[12px] font-semibold leading-snug truncate"
            style={{ color: railColor }}
            title={action}
          >
            {action}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <MatStatusBadge status={status} docId={m._docId} onUpdate={onStatusChange} />
          <button
            type="button"
            onClick={onEdit}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            title="Edit material"
            aria-label="Edit material"
          >
            <PencilIcon size={13} />
          </button>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onToggleHistory}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              title={showHistory ? 'Hide history' : 'View history'}
              aria-label={showHistory ? 'Hide history' : 'View history'}
              aria-expanded={showHistory}
            >
              <ActivityIcon size={13} />
            </button>
          )}
        </div>

        {/* Tone-only Pill — purely visual, gives a quick read of the current status */}
        <Pill tone={tone} size="xs" className="hidden sm:inline-flex">{status}</Pill>
      </div>

      {/* History drawer */}
      {showHistory && history.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-2">History</p>
          <ul className="space-y-1.5">
            {history.slice(0, 8).map(h => (
              <MaterialHistoryRow key={h._docId} entry={h} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MaterialHistoryRow({ entry }) {
  const ts = entry.createdAt?.toDate
    ? entry.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'
  return (
    <li className="flex items-start gap-2 text-[11px] text-zinc-400">
      <span className="w-16 shrink-0 text-zinc-400">{ts}</span>
      {entry.type === 'status_change' ? (
        <span className="min-w-0">
          <span style={{ color: MAT_STATUS_COLOR[entry.fromStatus] || '#9ca3af' }}>
            {entry.fromStatus || '—'}
          </span>
          <span className="text-zinc-400 mx-1">to</span>
          <span style={{ color: MAT_STATUS_COLOR[entry.toStatus] || '#9ca3af' }}>
            {entry.toStatus || '—'}
          </span>
        </span>
      ) : (
        <span className="capitalize">{entry.type?.replace(/_/g, ' ') || 'updated'}</span>
      )}
    </li>
  )
}

function MaterialForm({ form, setForm, jobs, editing, saving, onSave, onCancel }) {
  return (
    <DataPanel
      title={editing ? 'Edit material' : 'Request material'}
      description={editing
        ? 'Update the material details and save changes.'
        : 'Capture what the field needs. Office sees the request immediately.'}
      Icon={PlusIcon}
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <FormFieldLabel>Item name *</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400"
            placeholder="e.g. 200A Main Panel — Square D"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Qty</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white"
            type="number"
            min="1"
            value={form.qty}
            onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Unit</FormFieldLabel>
          <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAT_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FormFieldLabel>Job</FormFieldLabel>
          <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 w-full">
              <SelectValue placeholder="Select job" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map(j => (
                <SelectItem key={j.id} value={j.id}>
                  {j.id} — {j.client || j.name || ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FormFieldLabel>Status</FormFieldLabel>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAT_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FormFieldLabel>Vendor</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400"
            placeholder="Graybar, Ferguson…"
            value={form.vendor}
            onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Date ordered</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white"
            type="date"
            value={form.dateOrdered}
            onChange={e => setForm(f => ({ ...f, dateOrdered: e.target.value }))}
          />
        </div>
        <div>
          <FormFieldLabel>Date needed</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white"
            type="date"
            value={form.dateNeeded}
            onChange={e => setForm(f => ({ ...f, dateNeeded: e.target.value }))}
          />
        </div>
        <div className="md:col-span-2">
          <FormFieldLabel>Notes</FormFieldLabel>
          <Input
            className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400"
            placeholder="Optional — sub assignments, location on site, etc."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ backgroundColor: O }}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Submit request'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 transition-colors"
        >
          Cancel
        </button>
        {!editing && form.name.trim() && (
          <span className="text-[11px] text-zinc-400 ml-auto">
            Material request received once you submit.
          </span>
        )}
      </div>
    </DataPanel>
  )
}

function FormFieldLabel({ children }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 block mb-1.5">
      {children}
    </span>
  )
}
