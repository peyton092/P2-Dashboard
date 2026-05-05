import { useMemo, useState } from 'react'
import { addDoc, updateDoc, doc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useData } from '../DataContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  PlusIcon, XIcon, SendIcon, SaveIcon, ChevronLeftIcon,
  CheckCircleIcon, ClockIcon, FileTextIcon,
  DollarSignIcon, PencilIcon, DownloadIcon,
  FilePenLineIcon, FileCheckIcon,
} from 'lucide-react'
import { generateCOPdf } from '../lib/generateCOPdf'
import {
  PageHeader,
  MetricTile,
  DataPanel,
  Pill,
  EmptyState,
  AllClearState,
  LoadingState,
  FilterBar,
  ResponsiveTable,
  TableHeader,
  TableRow,
  TableCell,
} from './shared'

const O = '#F47920'
const UNITS = ['EA', 'LF', 'SF', 'HR', 'LS']
const CO_STATUSES = ['Draft', 'Sent to Builder', 'Approved', 'Rejected']

const STATUS_COLOR = {
  'Draft':           '#6b7280',
  'Sent to Builder': '#3b82f6',
  'Approved':        '#22c55e',
  'Rejected':        '#ef4444',
  'pending':         '#eab308',
  'approved':        '#22c55e',
  'rejected':        '#ef4444',
}

function fmt$(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function newLine() {
  return { _id: Math.random(), desc: '', qty: 1, unit: 'EA', unitPrice: '', extPrice: 0 }
}

function genCONumber(extras) {
  const year = new Date().getFullYear()
  const prefix = `CO-${year}-`
  const nums = (extras || [])
    .filter(e => e.coNumber?.startsWith(prefix))
    .map(e => parseInt(e.coNumber.slice(prefix.length)) || 0)
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function calcTotals(lineItems, markupPct) {
  const subtotal = lineItems.reduce((s, li) => s + (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0), 0)
  const markup = subtotal * (parseFloat(markupPct) || 0) / 100
  return { subtotal, markup, total: subtotal + markup }
}

function emptyForm(coNumber) {
  return { coNumber, job: '', date: todayStr(), status: 'Draft', lineItems: [newLine()], markupPct: 15, notes: '' }
}

// ── Status pill (uses Phase 1 primitive) ──────────────────────────────────────

function COStatusPill({ status, size = 'xs' }) {
  const tone =
    status === 'Approved' || status === 'approved' ? 'success'  :
    status === 'Rejected' || status === 'rejected' ? 'critical' :
    status === 'Sent to Builder'                   ? 'info'     :
    status === 'Draft'                             ? 'mute'     :
    status === 'pending'                           ? 'warning'  :
    'mute'
  const label = status || 'Draft'
  return <Pill tone={tone} size={size}>{label}</Pill>
}

// ── Operational helpers ──────────────────────────────────────────────────────

const TODAY_MS = Date.now()

function coAgeDays(co) {
  // Prefer `sentAt` for sent COs, fall back to `date`, then `createdAt`.
  const sentTs = co.sentAt?.toDate?.() || (co.sentAt ? new Date(co.sentAt) : null)
  const dateTs = co.date ? new Date(co.date) : null
  const createdTs = co.createdAt?.toDate?.() || (co.createdAt ? new Date(co.createdAt) : null)
  const t = sentTs || dateTs || createdTs
  if (!t || isNaN(t.getTime())) return null
  return Math.floor((TODAY_MS - t.getTime()) / 86400000)
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const isDraft     = (e) => e.status === 'Draft'
const isSubmitted = (e) => e.status === 'Sent to Builder'
const isApproved  = (e) => e.status === 'Approved' || e.status === 'approved'
const isRejected  = (e) => e.status === 'Rejected' || e.status === 'rejected'
const APPROVAL_REQUIRED_THRESHOLD = 3   // days a CO can sit "Sent to Builder" before requiring follow-up

const sumOf = (list) => list.reduce((s, e) => s + Number(e.total ?? e.amount ?? 0), 0)

function nextActionFor(co) {
  if (isDraft(co))     return { text: 'Submit for approval',         tone: 'brand'    }
  if (isSubmitted(co)) {
    const age = coAgeDays(co)
    if (age != null && age >= 7) return { text: 'Escalate — long pending',     tone: 'critical' }
    if (age != null && age >= APPROVAL_REQUIRED_THRESHOLD) {
      return { text: 'Follow up with builder', tone: 'warning' }
    }
    return { text: 'Awaiting builder approval', tone: 'info' }
  }
  if (isApproved(co))  return { text: 'Approved, ready to bill',     tone: 'success'  }
  if (isRejected(co))  return { text: 'Needs revision',              tone: 'critical' }
  return { text: 'Review CO', tone: 'mute' }
}

function fmtCompact(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000)     return `$${Math.round(v / 1_000).toLocaleString()}K`
  return `$${v.toLocaleString()}`
}

// ── CO Form ───────────────────────────────────────────────────────────────────

function jobLabel(jobs, jobId) {
  const j = jobs.find(j => j.id === jobId)
  return j ? `${j.id} — ${j.name || j.address || ''}` : jobId
}

function COForm({ form, setForm, jobs, onSave, onCancel, saving, isEditing }) {
  const { subtotal, markup, total } = calcTotals(form.lineItems, form.markupPct)

  function setLine(idx, field, val) {
    setForm(f => ({
      ...f,
      lineItems: f.lineItems.map((li, i) => {
        if (i !== idx) return li
        const u = { ...li, [field]: val }
        u.extPrice = (parseFloat(u.qty) || 0) * (parseFloat(u.unitPrice) || 0)
        return u
      }),
    }))
  }

  const canSave = form.job && form.lineItems.some(li => li.desc.trim())

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronLeftIcon size={18} />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-semibold" style={{ color: O }}>{form.coNumber}</h2>
          <p className="text-sm text-muted-foreground">Change Order</p>
        </div>
        <div className="flex gap-2">
          {isEditing && (
            <Button
              variant="outline"
              className="gap-2 border-white/20 hover:bg-white/10"
              onClick={() => generateCOPdf(form, jobLabel(jobs, form.job))}
              title="Download PDF"
            >
              <DownloadIcon size={14} /> PDF
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2 border-white/20 hover:bg-white/10"
            onClick={() => onSave(false)}
            disabled={saving || !canSave}
          >
            <SaveIcon size={14} /> Save Draft
          </Button>
          <Button
            className="gap-2 text-white"
            style={{ backgroundColor: O }}
            onClick={() => onSave(true)}
            disabled={saving || !canSave}
          >
            <SendIcon size={14} /> {saving ? 'Sending…' : 'Send to Builder'}
          </Button>
        </div>
      </div>

      {/* Meta row */}
      <Card className="border-white/10">
        <CardContent className="p-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Job *</label>
              <Select value={form.job} onValueChange={v => setForm(f => ({ ...f, job: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20 w-full">
                  <SelectValue placeholder="Select job…" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map(j => (
                    <SelectItem key={j.id} value={j.id}>{j.id} — {j.name || j.address}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">CO Date</label>
              <Input
                type="date"
                className="bg-white/5 border-white/20"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CO_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card className="border-white/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Line Items</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-white/20 hover:bg-white/10 text-xs"
              onClick={() => setForm(f => ({ ...f, lineItems: [...f.lineItems, newLine()] }))}
            >
              <PlusIcon size={12} /> Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-white/10 text-muted-foreground text-xs">
                  <th className="text-left px-4 py-2 font-medium" style={{ minWidth: 260 }}>Description</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ width: 80 }}>Qty</th>
                  <th className="text-center px-3 py-2 font-medium" style={{ width: 80 }}>Unit</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ width: 110 }}>Unit Price</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ width: 110 }}>Extended</th>
                  <th className="px-3 py-2" style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {form.lineItems.map((li, idx) => (
                  <tr key={li._id}>
                    <td className="px-4 py-2">
                      <Input
                        className="bg-white/5 border-white/20 text-sm h-8"
                        placeholder="Describe the work…"
                        value={li.desc}
                        onChange={e => setLine(idx, 'desc', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className="bg-white/5 border-white/20 text-sm h-8 text-right"
                        type="number"
                        min="0"
                        step="0.01"
                        value={li.qty}
                        onChange={e => setLine(idx, 'qty', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select value={li.unit} onValueChange={v => setLine(idx, 'unit', v)}>
                        <SelectTrigger className="bg-white/5 border-white/20 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                        <Input
                          className="bg-white/5 border-white/20 text-sm h-8 text-right pl-5"
                          type="number"
                          min="0"
                          step="0.01"
                          value={li.unitPrice}
                          onChange={e => setLine(idx, 'unitPrice', e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold" style={{ color: O }}>
                      {fmt$(li.extPrice)}
                    </td>
                    <td className="px-3 py-2">
                      {form.lineItems.length > 1 && (
                        <button
                          onClick={() => setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))}
                          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <XIcon size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-white/10 p-4">
            <div className="ml-auto" style={{ maxWidth: 340 }}>
              <div className="flex justify-between text-sm py-1.5 text-muted-foreground">
                <span>Subtotal</span>
                <span className="">{fmt$(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 text-sm gap-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>Markup</span>
                  <div className="relative flex items-center">
                    <Input
                      className="bg-white/5 border-white/20 h-7 text-xs text-right w-16"
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={form.markupPct}
                      onChange={e => setForm(f => ({ ...f, markupPct: e.target.value }))}
                    />
                    <span className="ml-1 text-muted-foreground text-xs">%</span>
                  </div>
                </div>
                <span className="text-muted-foreground">{fmt$(markup)}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-white/20 mt-1">
                <span className="font-semibold text-base">TOTAL</span>
                <span className="font-semibold text-xl" style={{ color: O }}>{fmt$(total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Notes / Justification</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            className="bg-white/5 border-white/20 min-h-24 resize-y"
            placeholder="Describe why this change order is needed, scope changes, owner-requested additions, field conditions, etc."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}

// ── CO List ───────────────────────────────────────────────────────────────────

export default function ChangeOrders() {
  const { jobs: JOBS, extras: ALL_EXTRAS, loading } = useData()
  const [view, setView] = useState('list')
  const [editingCO, setEditingCO] = useState(null)
  const [form, setForm] = useState(null)
  const [jobFilter, setJobFilter] = useState('all')
  const [filter, setFilter]       = useState('all')
  const [saving, setSaving] = useState(false)

  // Sort newest first (by date then by coNumber). Memoized so identity stays
  // stable across renders unless the extras feed changes.
  const EXTRAS = useMemo(() => [...ALL_EXTRAS].sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '')
    if (d !== 0) return d
    return (b.coNumber || b.id || '').localeCompare(a.coNumber || a.id || '')
  }), [ALL_EXTRAS])

  function startNew() {
    const coNumber = genCONumber(EXTRAS)
    setForm(emptyForm(coNumber))
    setEditingCO(null)
    setView('form')
  }

  function openEdit(co) {
    if (!co.lineItems) return
    setForm({
      ...co,
      lineItems: co.lineItems.map(li => ({ ...li, _id: Math.random() })),
    })
    setEditingCO(co)
    setView('form')
  }

  async function saveCO(sendToBuilder) {
    if (!form.job || !form.lineItems.some(li => li.desc.trim())) return
    setSaving(true)
    try {
      const { subtotal, markup, total } = calcTotals(form.lineItems, form.markupPct)
      const status = sendToBuilder ? 'Sent to Builder' : (form.status === 'Sent to Builder' ? 'Sent to Builder' : 'Draft')

      // The constructed object below names every saved field explicitly, so
      // the UI-only `_id` (used as a React key on the form rows) never lands
      // in Firestore. No destructuring needed — the explicit shape is the
      // contract.
      const cleanLines = form.lineItems.map(li => ({
        desc: li.desc,
        qty: parseFloat(li.qty) || 0,
        unit: li.unit || 'EA',
        unitPrice: parseFloat(li.unitPrice) || 0,
        extPrice: (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0),
      }))

      const firstLine = cleanLines.find(l => l.desc)?.desc || ''
      const data = {
        coNumber: form.coNumber,
        job: form.job,
        date: form.date,
        status,
        lineItems: cleanLines,
        subtotal,
        markupPct: parseFloat(form.markupPct) || 15,
        markup,
        total,
        notes: form.notes || '',
        qbs: sendToBuilder,
        amount: total,
        desc: `${form.coNumber}${firstLine ? ` — ${firstLine}` : ''}`,
        ...(sendToBuilder ? { sentAt: serverTimestamp() } : {}),
      }

      if (editingCO?._docId) {
        await updateDoc(doc(db, 'extras', editingCO._docId), data)
      } else {
        await addDoc(collection(db, 'extras'), { ...data, createdAt: serverTimestamp() })
      }
      setView('list')
      setForm(null)
      setEditingCO(null)
    } finally {
      setSaving(false)
    }
  }

  // Loading branch — only shown on the very first paint before Firestore lands.
  if (loading && EXTRAS.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Change Orders"
          title="Approval control & revenue protection"
          subtitle="Loading change order pipeline…"
        />
        <LoadingState label="Loading change orders…" />
      </div>
    )
  }

  if (view === 'form' && form) {
    return (
      <COForm
        form={form}
        setForm={setForm}
        jobs={JOBS}
        onSave={saveCO}
        onCancel={() => { setView('list'); setForm(null); setEditingCO(null) }}
        saving={saving}
        isEditing={!!editingCO}
      />
    )
  }

  // List view ─────────────────────────────────────────────────────────────────

  const drafts            = EXTRAS.filter(isDraft)
  const submitted         = EXTRAS.filter(isSubmitted)
  const approved          = EXTRAS.filter(isApproved)
  const rejected          = EXTRAS.filter(isRejected)
  const approvalRequired  = submitted.filter(co => {
    const age = coAgeDays(co)
    return age != null && age >= APPROVAL_REQUIRED_THRESHOLD
  })

  const totals = {
    drafts:           sumOf(drafts),
    submitted:        sumOf(submitted),
    approvalRequired: sumOf(approvalRequired),
    approved:         sumOf(approved),
    rejected:         sumOf(rejected),
  }

  const FILTERS = [
    { id: 'all',              label: 'All',               count: EXTRAS.length },
    { id: 'Draft',            label: 'Draft',             count: drafts.length },
    { id: 'Sent to Builder',  label: 'Submitted',         count: submitted.length },
    { id: 'Approval required', label: 'Approval required', count: approvalRequired.length },
    { id: 'Approved',         label: 'Approved',          count: approved.length },
    { id: 'Rejected',         label: 'Rejected',          count: rejected.length },
  ]

  // Apply filter to the working list (overrides `statusFilter` legacy state).
  const display = (() => {
    let list = EXTRAS
    if (filter === 'all') {
      // pass-through
    } else if (filter === 'Approval required') {
      list = approvalRequired
    } else if (filter === 'Draft')           list = drafts
    else if (filter === 'Sent to Builder')  list = submitted
    else if (filter === 'Approved')         list = approved
    else if (filter === 'Rejected')         list = rejected

    if (jobFilter !== 'all') list = list.filter(co => co.job === jobFilter)
    return list
  })()

  // Job lookup map for builder/PM/job-name resolution.
  const jobMap = JOBS.reduce((m, j) => (m.set(j.id, j), m), new Map())

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Change Orders"
        title="Approval control & revenue protection"
        subtitle="Track every CO from draft to approved billable. Work should not start until approved."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
              <span className="tracking-wider text-[10px] uppercase" style={{ color: '#22c55e' }}>Live</span>
            </span>
            <span>{EXTRAS.length} change orders total</span>
            {approvalRequired.length > 0 && (
              <span className="text-amber-300">{approvalRequired.length} need follow-up</span>
            )}
          </>
        }
        actions={
          <Button
            onClick={startNew}
            style={{ backgroundColor: O }}
            className="text-white gap-2 font-bold"
          >
            <PlusIcon size={14} /> New CO
          </Button>
        }
      />

      {/* KPI strip — 5 tiles */}
      <section
        className="grid gap-2 sm:gap-3"
        aria-label="Change order pipeline"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        <MetricTile
          label="Drafts"
          value={drafts.length}
          Icon={FilePenLineIcon}
          sub={drafts.length > 0 ? `${fmtCompact(totals.drafts)} drafted` : 'Nothing in draft'}
        />
        <MetricTile
          label="Submitted"
          value={submitted.length}
          Icon={SendIcon}
          emphasis={submitted.length > 0 ? 'default' : 'mute'}
          sub={submitted.length > 0 ? `${fmtCompact(totals.submitted)} awaiting builder` : 'No COs in flight'}
        />
        <MetricTile
          label="Approval Required"
          value={approvalRequired.length}
          Icon={ClockIcon}
          emphasis={approvalRequired.length > 0 ? 'warning' : 'success'}
          sub={
            approvalRequired.length > 0
              ? `${APPROVAL_REQUIRED_THRESHOLD}+ days pending`
              : 'No follow-ups needed'
          }
        />
        <MetricTile
          label="Approved Value"
          value={fmtCompact(totals.approved)}
          Icon={FileCheckIcon}
          emphasis="success"
          sub={`${approved.length} approved CO${approved.length === 1 ? '' : 's'}`}
        />
        <MetricTile
          label="Rejected"
          value={rejected.length}
          Icon={XIcon}
          emphasis={rejected.length > 0 ? 'critical' : 'success'}
          sub={
            rejected.length > 0
              ? `${fmtCompact(totals.rejected)} needs revision`
              : 'No rejections'
          }
        />
      </section>

      {/* Filters */}
      <FilterBar
        chips={FILTERS.map(f => ({
          value: f.id,
          label: f.label,
          active: filter === f.id,
          count: f.count,
          onClick: () => setFilter(f.id),
        }))}
        trailing={
          <>
            <select
              value={jobFilter}
              onChange={e => setJobFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[220px]"
            >
              <option value="all">All Jobs</option>
              {JOBS.map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} — {j.name || j.address}
                </option>
              ))}
            </select>
            {(filter !== 'all' || jobFilter !== 'all') && (
              <button
                type="button"
                onClick={() => { setFilter('all'); setJobFilter('all') }}
                className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-300 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        }
      />

      {/* Main queue */}
      <DataPanel
        title="Change Order Queue"
        description={
          display.length === 0
            ? 'No change orders match the current filters.'
            : `${display.length} of ${EXTRAS.length} shown`
        }
        Icon={FilePenLineIcon}
        padding="none"
      >
        {display.length === 0 ? (
          <div className="p-5">
            <COEmptyState filter={filter} hasJobFilter={jobFilter !== 'all'} onNew={startNew} />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block px-3 sm:px-4 pb-3 pt-1">
              <ResponsiveTable>
                <TableHeader
                  columns={[
                    { key: 'co',     label: 'CO #',         width: '10%' },
                    { key: 'job',    label: 'Job · Customer', width: '20%' },
                    { key: 'desc',   label: 'Description',  width: '20%' },
                    { key: 'amount', label: 'Amount',       align: 'right', width: '10%' },
                    { key: 'status', label: 'Status',       width: '10%' },
                    { key: 'pm',     label: 'PM',           width: '10%' },
                    { key: 'aging',  label: 'Aging',        width: '8%' },
                    { key: 'next',   label: 'Required action', width: '12%' },
                  ]}
                />
                <tbody>
                  {display.map((co, i) => (
                    <CORow
                      key={co._docId || i}
                      co={co}
                      job={jobMap.get(co.job)}
                      onEdit={openEdit}
                      onPdf={() => generateCOPdf(co, jobLabel(JOBS, co.job))}
                    />
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>

            {/* Mobile cards */}
            <ul className="md:hidden p-3 space-y-2">
              {display.map((co, i) => (
                <li key={co._docId || i}>
                  <COCard
                    co={co}
                    job={jobMap.get(co.job)}
                    onEdit={openEdit}
                    onPdf={() => generateCOPdf(co, jobLabel(JOBS, co.job))}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </DataPanel>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function COEmptyState({ filter, hasJobFilter, onNew }) {
  if (hasJobFilter || filter === 'all') {
    return (
      <EmptyState
        Icon={FilePenLineIcon}
        title={hasJobFilter ? 'No COs for that job' : 'No change orders yet'}
        description={hasJobFilter
          ? 'Adjust the filters or create a new change order for this job.'
          : 'Draft a CO when scope changes — protect revenue before work starts.'}
        action={
          <Button onClick={onNew} style={{ backgroundColor: '#F47920' }} className="text-white gap-2">
            <PlusIcon size={13} /> New CO
          </Button>
        }
      />
    )
  }
  if (filter === 'Draft')             return <AllClearState title="No drafts in flight" description="All COs have moved past draft." />
  if (filter === 'Sent to Builder')   return <AllClearState title="No COs awaiting approval" description="Either nothing's been sent or every CO has a decision." />
  if (filter === 'Approval required') return <AllClearState title="No follow-ups needed" description={`No CO has been waiting more than ${3} days.`} />
  if (filter === 'Approved')          return <EmptyState Icon={FileCheckIcon} title="No approved COs yet" description="Approved change orders will appear here, ready to bill." />
  if (filter === 'Rejected')          return <AllClearState title="No rejections" description="No change orders need revision." />
  return <EmptyState title="No change orders" />
}

function tonesToColor(tone) {
  return (
    tone === 'critical' ? '#ef4444' :
    tone === 'warning'  ? '#eab308' :
    tone === 'success'  ? '#22c55e' :
    tone === 'info'     ? '#3b82f6' :
    tone === 'brand'    ? O :
    '#9ca3af'
  )
}

function CORow({ co, job, onEdit, onPdf }) {
  const isNew     = !!co.lineItems
  const coNum     = co.coNumber || co.id || '—'
  const desc      = co.desc || co.lineItems?.[0]?.desc || '—'
  const total     = co.total ?? co.amount ?? 0
  const next      = nextActionFor(co)
  const age       = coAgeDays(co)
  const builder   = job?.client || job?.qbsPM || '—'
  const jobName   = job?.name || job?.address || co.job
  const ageTone   =
    age == null ? 'neutral' :
    (isSubmitted(co) && age >= 7) ? 'critical' :
    (isSubmitted(co) && age >= APPROVAL_REQUIRED_THRESHOLD) ? 'warning' :
    'neutral'

  return (
    <TableRow
      className={
        isRejected(co) ? 'ring-1 ring-red-500/20'
        : (isSubmitted(co) && age != null && age >= APPROVAL_REQUIRED_THRESHOLD) ? 'ring-1 ring-amber-500/15'
        : ''
      }
    >
      <TableCell first className="font-bold" style={{ color: O }}>
        {coNum}
      </TableCell>
      <TableCell className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
            {co.job}
          </span>
          <span className="font-semibold text-zinc-100 truncate">{jobName}</span>
        </div>
        <p className="text-[11px] text-zinc-400 truncate mt-0.5">{builder}</p>
      </TableCell>
      <TableCell className="text-zinc-200 max-w-[24rem] truncate" title={desc}>
        {desc}
      </TableCell>
      <TableCell align="right" className="font-bold tabular-nums" style={{ color: total > 0 ? O : '#9ca3af' }}>
        {total > 0 ? '$' + Math.round(total).toLocaleString() : '—'}
      </TableCell>
      <TableCell><COStatusPill status={co.status || 'Draft'} /></TableCell>
      <TableCell className="text-zinc-200 truncate">{job?.pm || '—'}</TableCell>
      <TableCell>
        {age == null
          ? <span className="text-zinc-500 text-xs">—</span>
          : <Pill tone={ageTone} size="xs">{age}d</Pill>}
      </TableCell>
      <TableCell last>
        <div className="flex flex-col items-stretch gap-1.5">
          <p
            className="text-[11px] font-semibold leading-snug"
            style={{ color: tonesToColor(next.tone) }}
            title={next.text}
          >
            {next.text}
          </p>
          {isRejected(co) && co.rejectNotes && (
            <p className="text-[10px] text-zinc-400 italic line-clamp-2" title={co.rejectNotes}>
              “{co.rejectNotes}”
            </p>
          )}
          <div className="flex items-center gap-1 justify-end">
            {isNew && (
              <button
                type="button"
                onClick={onPdf}
                className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
                title="Download PDF"
              >
                <DownloadIcon size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onEdit(co)}
              className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
              title={isNew ? 'Edit / re-send' : 'Edit'}
              disabled={!isNew}
              style={!isNew ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              <PencilIcon size={13} />
            </button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

function COCard({ co, job, onEdit, onPdf }) {
  const isNew    = !!co.lineItems
  const coNum    = co.coNumber || co.id || '—'
  const desc     = co.desc || co.lineItems?.[0]?.desc || '—'
  const total    = co.total ?? co.amount ?? 0
  const next     = nextActionFor(co)
  const age      = coAgeDays(co)
  const builder  = job?.client || job?.qbsPM || '—'
  const jobName  = job?.name || job?.address || co.job
  const accent   = tonesToColor(next.tone)

  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <header className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: O }}>{coNum}</p>
          <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">
            {co.job}
          </span>
          <p className="text-base font-bold text-white mt-1.5 truncate">{jobName}</p>
          <p className="text-[11px] text-zinc-400 truncate">
            {builder}{job?.pm ? ` · PM ${job.pm}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums" style={{ color: total > 0 ? O : '#9ca3af' }}>
            {total > 0 ? '$' + Math.round(total).toLocaleString() : '—'}
          </p>
          {age != null && (
            <p className="text-[10px] text-zinc-400">{age}d old</p>
          )}
        </div>
      </header>

      <p className="text-sm text-zinc-200 line-clamp-2 mb-3">{desc}</p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <COStatusPill status={co.status || 'Draft'} />
        {co.date && <Pill tone="neutral" size="xs">Dated {fmtDateShort(co.date)}</Pill>}
      </div>

      {isRejected(co) && co.rejectNotes && (
        <div className="rounded-lg border border-red-500/30 px-3 py-2 mb-3" style={{ backgroundColor: '#ef44440a' }}>
          <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: '#ef4444' }}>
            Rejection note
          </p>
          <p className="text-[11px] text-zinc-200 italic">“{co.rejectNotes}”</p>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-white/5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">Required action</p>
        <p className="text-sm font-semibold leading-snug" style={{ color: accent }}>
          {next.text}
        </p>
        <div className="flex items-center justify-end gap-1.5 mt-3">
          {isNew && (
            <button
              type="button"
              onClick={onPdf}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-white/10 text-zinc-200 hover:text-white hover:border-white/30 transition-colors"
              title="Download PDF"
            >
              <DownloadIcon size={12} /> PDF
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(co)}
            disabled={!isNew}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: O }}
          >
            <PencilIcon size={12} /> {isDraft(co) ? 'Submit for approval' : isRejected(co) ? 'Revise & resend' : 'Edit'}
          </button>
        </div>
      </div>
    </article>
  )
}
