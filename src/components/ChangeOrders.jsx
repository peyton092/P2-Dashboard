import { useState } from 'react'
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
  CheckCircleIcon, ClockIcon, AlertCircleIcon, FileTextIcon,
  DollarSignIcon, RefreshCwIcon, PencilIcon, DownloadIcon,
} from 'lucide-react'
import { generateCOPdf } from '../lib/generateCOPdf'

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

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, Icon, color }) {
  return (
    <div className="rounded-xl p-4 border border-white/10" style={{ backgroundColor: 'oklch(0.165 0 0)' }}>
      <div className="flex items-center justify-between mb-3">
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <p className="text-2xl font-black" style={{ color: color || 'white' }}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || '#6b7280'
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color, backgroundColor: color + '22' }}>
      {(status || 'unknown').toUpperCase()}
    </span>
  )
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
          <h2 className="text-2xl font-black" style={{ color: O }}>{form.coNumber}</h2>
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
                    <td className="px-3 py-2 text-right font-mono text-sm font-semibold" style={{ color: O }}>
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
                <span className="font-mono">{fmt$(subtotal)}</span>
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
                <span className="font-mono text-muted-foreground">{fmt$(markup)}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-white/20 mt-1">
                <span className="font-black text-base">TOTAL</span>
                <span className="font-black text-xl font-mono" style={{ color: O }}>{fmt$(total)}</span>
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
  const { jobs: JOBS, extras: EXTRAS } = useData()
  const [view, setView] = useState('list')
  const [editingCO, setEditingCO] = useState(null)
  const [form, setForm] = useState(null)
  const [jobFilter, setJobFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [saving, setSaving] = useState(false)

  // Sort newest first (by date then by coNumber)
  const allCOs = [...EXTRAS].sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '')
    if (d !== 0) return d
    return (b.coNumber || b.id || '').localeCompare(a.coNumber || a.id || '')
  })

  const filtered = allCOs.filter(co => {
    if (jobFilter !== 'all' && co.job !== jobFilter) return false
    if (statusFilter !== 'all') {
      const s = co.status || 'pending'
      if (s !== statusFilter) return false
    }
    return true
  })

  const totalApproved = EXTRAS
    .filter(e => e.status === 'Approved' || e.status === 'approved')
    .reduce((s, e) => s + (e.total || e.amount || 0), 0)
  const totalPending = EXTRAS
    .filter(e => e.status === 'Sent to Builder' || e.status === 'pending')
    .reduce((s, e) => s + (e.total || e.amount || 0), 0)
  const draftCount = EXTRAS.filter(e => e.status === 'Draft').length
  const sentCount = EXTRAS.filter(e => e.status === 'Sent to Builder').length

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

      const cleanLines = form.lineItems.map(({ _id, ...li }) => ({
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

  // List view
  const allStatuses = [...new Set(EXTRAS.map(e => e.status || 'pending').filter(Boolean))]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black" style={{ color: O }}>Extras / Change Orders</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Professional change orders with line items</p>
        </div>
        <Button onClick={startNew} style={{ backgroundColor: O }} className="text-white gap-2">
          <PlusIcon size={14} /> New CO
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Approved"       value={fmt$(totalApproved)} Icon={CheckCircleIcon} color="#22c55e" />
        <StatCard label="Pending"        value={fmt$(totalPending)}  Icon={ClockIcon}       color="#eab308" />
        <StatCard label="Drafts"         value={draftCount}          Icon={FileTextIcon}    sub="change orders" />
        <StatCard label="Sent to Builder" value={sentCount}          Icon={SendIcon}        color="#3b82f6" sub="awaiting response" />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={jobFilter} onValueChange={setJobFilter}>
          <SelectTrigger className="w-44 bg-white/5 border-white/20">
            <SelectValue placeholder="All Jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Jobs</SelectItem>
            {JOBS.map(j => <SelectItem key={j.id} value={j.id}>{j.id} — {j.name || j.address}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-white/5 border-white/20">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {allStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="border-white/10">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-xs">
                  <th className="text-left p-4 font-medium">CO #</th>
                  <th className="text-left p-4 font-medium">Job</th>
                  <th className="text-left p-4 font-medium">Description</th>
                  <th className="text-right p-4 font-medium">Subtotal</th>
                  <th className="text-right p-4 font-medium">Markup</th>
                  <th className="text-right p-4 font-medium">Total</th>
                  <th className="text-center p-4 font-medium">Status</th>
                  <th className="text-left p-4 font-medium">Date</th>
                  <th className="p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground text-sm">No change orders found</td>
                  </tr>
                )}
                {filtered.map((co, i) => {
                  const isNew = !!co.lineItems
                  const coNum = co.coNumber || co.id || `—`
                  const desc = co.desc || co.lineItems?.[0]?.desc || '—'
                  const total = co.total ?? co.amount ?? 0
                  const subtotal = co.subtotal ?? co.amount ?? 0
                  const markupAmt = co.markup ?? 0
                  const markupPct = co.markupPct ?? null
                  return (
                    <tr key={co._docId || i} className="hover:bg-white/5 transition-colors group">
                      <td className="p-4 font-mono font-bold" style={{ color: O }}>{coNum}</td>
                      <td className="p-4 font-mono text-xs bg-white/5">{co.job}</td>
                      <td className="p-4 text-muted-foreground max-w-xs truncate">{desc}</td>
                      <td className="p-4 text-right font-mono text-sm">{isNew ? fmt$(subtotal) : '—'}</td>
                      <td className="p-4 text-right font-mono text-sm text-muted-foreground">
                        {isNew ? `${fmt$(markupAmt)}${markupPct != null ? ` (${markupPct}%)` : ''}` : '—'}
                      </td>
                      <td className="p-4 text-right font-mono font-semibold" style={{ color: O }}>{fmt$(total)}</td>
                      <td className="p-4 text-center"><StatusBadge status={co.status || 'pending'} /></td>
                      <td className="p-4 text-muted-foreground text-xs">{co.date || '—'}</td>
                      <td className="p-4">
                        {isNew && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={() => generateCOPdf(co, jobLabel(JOBS, co.job))}
                              className="p-1.5 rounded hover:bg-white/10 transition-colors"
                              title="Download PDF"
                            >
                              <DownloadIcon size={12} className="text-muted-foreground" />
                            </button>
                            <button
                              onClick={() => openEdit(co)}
                              className="p-1.5 rounded hover:bg-white/10 transition-colors"
                              title="Edit"
                            >
                              <PencilIcon size={12} className="text-muted-foreground" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
