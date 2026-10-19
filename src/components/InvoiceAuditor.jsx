import { useId, useState, useMemo } from 'react'
import { useData } from '../use-data'
import { useSupplierInvoices, addSupplierInvoice, updateSupplierInvoice } from '../hooks/useFirestore'
import { useMutation } from '../hooks/useMutation'
import { toLocalDateStr } from '../lib/dates'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  PlusIcon, XIcon, AlertTriangleIcon, CheckCircleIcon,
  DollarSignIcon, FileTextIcon, ChevronDownIcon, ChevronUpIcon,
  ShieldAlertIcon, ReceiptIcon, SearchIcon, PencilIcon,
} from 'lucide-react'
import { BRAND, withAlpha } from '@/lib/tokens'
import { SEVERITY, statusLabel, statusTone, toneHex, toneText } from '../lib/status'

const KNOWN_VENDORS = ['Graybar', 'Ferguson', 'Johnstone', 'ADT Supply', 'Other']
const UNITS = ['EA', 'LF', 'SF', 'HR', 'LS', 'BOX', 'ROLL', 'STICK']
const STATUS_OPTIONS = ['pending-review', 'approved', 'disputed', 'paid']

// The tone of each status. Its chip is tinted with the tone and its words are in the tone's
// text color, which reads at 4.5 to 1 on the tint where the critical red and the mute gray
// do not.
const STATUS_META = {
  'pending-review': { label: 'Pending Review', tone: 'warning' },
  'approved':       { label: 'Approved',       tone: 'success' },
  'disputed':       { label: 'Disputed',       tone: 'critical' },
  'paid':           { label: 'Paid',           tone: 'mute' },
}

const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function newLine() {
  return { _id: Math.random(), desc: '', qty: 1, unit: 'EA', unitPrice: '', extPrice: 0 }
}

// ── Audit Engine ──────────────────────────────────────────────────────────────

function auditInvoice(invoice, allInvoices, materials) {
  const flags = []

  // Duplicate invoice number from same vendor
  const dup = allInvoices.find(inv =>
    inv._docId !== invoice._docId &&
    inv.invoiceNum === invoice.invoiceNum &&
    inv.vendor === invoice.vendor
  )
  if (dup) {
    flags.push({
      type: 'duplicate',
      severity: 'critical',
      message: `Duplicate invoice #${invoice.invoiceNum} from ${invoice.vendor} already exists`,
    })
  }

  // Match each line item against materials for this job+vendor
  const jobMats = (materials || []).filter(
    m => m.job === invoice.jobId && m.vendor === invoice.vendor
  )

  ;(invoice.lineItems || []).forEach(li => {
    if (!li.desc || !li.unitPrice) return
    const unitPrice = parseFloat(li.unitPrice) || 0
    if (unitPrice === 0) return

    // Try to find a matching material by keyword matching
    const descLower = li.desc.toLowerCase()
    const matched = jobMats.find(m => {
      const itemWords = m.item.toLowerCase().split(/\s+/)
      return itemWords.some(w => w.length > 3 && descLower.includes(w))
    })

    if (matched) {
      const expectedCost = matched.cost || 0
      if (expectedCost > 0) {
        const variance = ((unitPrice - expectedCost) / expectedCost) * 100
        if (variance > 15) {
          flags.push({
            type: 'price-variance',
            severity: variance > 30 ? 'critical' : 'warning',
            message: `"${li.desc}": billed ${fmt$(unitPrice)} vs PO ${fmt$(expectedCost)} (+${variance.toFixed(0)}%)`,
          })
        }
      }
    }
  })

  // No job assigned
  if (!invoice.jobId) {
    flags.push({ type: 'no-job', severity: 'warning', message: 'Invoice not assigned to a job, so it cannot be checked against POs' })
  }

  // Very high total (>$15k) — manual review flag
  if ((invoice.total || 0) > 15000 && invoice.status === 'pending-review') {
    flags.push({ type: 'high-value', severity: 'warning', message: `High value invoice (${fmt$(invoice.total)}) needs manager approval before payment` })
  }

  return flags
}

// The audit flags of an invoice. Each one is led by how serious it is, in words, so the
// color of the row is not the only thing that says so.
function FlagList({ flags }) {
  return (
    <ul className="space-y-1.5">
      {flags.map((f, i) => {
        const tone = statusTone(SEVERITY, f.severity)
        return (
          <li key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg border text-xs"
            style={{ borderColor: withAlpha(toneHex(tone), 0.27), backgroundColor: withAlpha(toneHex(tone), 0.03), color: toneText(tone) }}>
            <ShieldAlertIcon size={12} className="shrink-0 mt-0.5" />
            <span><span className="font-bold">{statusLabel(SEVERITY, f.severity)}:</span> {f.message}</span>
          </li>
        )
      })}
    </ul>
  )
}

// How many flags an invoice has and how many of them are critical, such as 2 flags, 1 critical.
function flagWords(flags) {
  const critical = flags.filter(f => f.severity === 'critical').length
  return `${flags.length} flag${flags.length === 1 ? '' : 's'}${critical > 0 ? `, ${critical} critical` : ''}`
}

// ── New Invoice Form ──────────────────────────────────────────────────────────

function InvoiceForm({ jobs, allInvoices, materials, onClose }) {
  const [form, setForm] = useState({
    vendor: '',
    invoiceNum: '',
    invoiceDate: toLocalDateStr(),
    jobId: '',
    lineItems: [newLine()],
    notes: '',
    status: 'pending-review',
  })
  const { run, busy: saving } = useMutation()
  // What the form itself found missing before it wrote anything. A write that fails is
  // told by the toast.
  const [error, setError] = useState('')

  const total = (form.lineItems || []).reduce((s, li) =>
    s + (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0), 0)

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

  const previewFlags = useMemo(() => {
    if (!form.invoiceNum) return []
    return auditInvoice({ ...form, total, _docId: '__new__' }, allInvoices, materials)
  }, [form, total, allInvoices, materials])

  async function handleSave() {
    if (!form.vendor || !form.invoiceNum || !form.invoiceDate) {
      setError('Vendor, invoice #, and date are required.')
      return
    }
    if (!form.lineItems.some(li => li.desc.trim())) {
      setError('Add at least one line item.')
      return
    }
    setError('')
    const { ok } = await run(() => {
      const cleanLines = form.lineItems.map(({ _id, ...li }) => ({
        desc: li.desc,
        qty: parseFloat(li.qty) || 0,
        unit: li.unit || 'EA',
        unitPrice: parseFloat(li.unitPrice) || 0,
        extPrice: (parseFloat(li.qty) || 0) * (parseFloat(li.unitPrice) || 0),
      }))
      const flags = auditInvoice({ ...form, total, lineItems: cleanLines, _docId: '__new__' }, allInvoices, materials)
      return addSupplierInvoice({
        vendor: form.vendor,
        invoiceNum: form.invoiceNum,
        invoiceDate: form.invoiceDate,
        jobId: form.jobId || null,
        lineItems: cleanLines,
        total,
        notes: form.notes || '',
        status: flags.some(f => f.severity === 'critical') ? 'pending-review' : form.status,
        flags: flags.map(({ _id, ...f }) => f),
      })
    }, {
      success: 'Invoice saved.',
      error: 'Could not save the invoice. Try again.',
      queue: true,
    })
    // A refused invoice leaves the form with what was typed, so it can be saved again.
    if (ok) onClose()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <IconButton label="Close the invoice form" onClick={onClose}>
          <XIcon size={16} />
        </IconButton>
        <h2 className="text-lg font-semibold" style={{ color: BRAND }}>New Supplier Invoice</h2>
      </div>

      {/* Meta */}
      <Card className="border-white/10">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Vendor" required>
              <Select value={form.vendor} onValueChange={v => setForm(f => ({ ...f, vendor: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20">
                  <SelectValue placeholder="Select vendor…" />
                </SelectTrigger>
                <SelectContent>
                  {KNOWN_VENDORS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Invoice #" required>
              <Input className="bg-white/5 border-white/20" placeholder="INV-12345"
                value={form.invoiceNum} onChange={e => setForm(f => ({ ...f, invoiceNum: e.target.value }))} />
            </Field>
            <Field label="Invoice date" required>
              <Input type="date" className="bg-white/5 border-white/20"
                value={form.invoiceDate} onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} />
            </Field>
            <Field label="Job (optional)">
              <Select value={form.jobId || ''} onValueChange={v => setForm(f => ({ ...f, jobId: v || null }))}>
                <SelectTrigger className="bg-white/5 border-white/20">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.id} — {j.name || j.client}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Live audit flags */}
      {previewFlags.length > 0 && <FlagList flags={previewFlags} />}

      {/* Line items */}
      <Card className="border-white/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Line Items</CardTitle>
            <Button size="sm" variant="outline" className="border-white/20 text-xs gap-1"
              onClick={() => setForm(f => ({ ...f, lineItems: [...f.lineItems, newLine()] }))}>
              <PlusIcon size={11} /> Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-white/10 text-muted-foreground text-xs">
                  <th className="text-left px-4 py-2 font-medium" style={{ minWidth: 240 }}>Description</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ width: 80 }}>Qty</th>
                  <th className="text-center px-3 py-2 font-medium" style={{ width: 80 }}>Unit</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ width: 110 }}>Unit Price</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ width: 110 }}>Extended</th>
                  <th className="px-3 py-2" style={{ width: 36 }}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {form.lineItems.map((li, idx) => (
                  <tr key={li._id}>
                    <td className="px-4 py-2">
                      <Input aria-label={`Description of line ${idx + 1}`} className="bg-white/5 border-white/20 h-8 text-sm" placeholder="Item description…"
                        value={li.desc} onChange={e => setLine(idx, 'desc', e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Quantity of line ${idx + 1}`} className="bg-white/5 border-white/20 h-8 text-sm text-right" type="number" min="0" step="0.01"
                        value={li.qty} onChange={e => setLine(idx, 'qty', e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <Select value={li.unit} onValueChange={v => setLine(idx, 'unit', v)}>
                        <SelectTrigger aria-label={`Unit of line ${idx + 1}`} className="bg-white/5 border-white/20 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="relative">
                        <span aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                        <Input aria-label={`Unit price of line ${idx + 1}`} className="bg-white/5 border-white/20 h-8 text-sm text-right pl-5" type="number" min="0" step="0.01"
                          value={li.unitPrice} onChange={e => setLine(idx, 'unitPrice', e.target.value)} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold" style={{ color: BRAND }}>
                      {fmt$(li.extPrice)}
                    </td>
                    <td className="px-3 py-2">
                      {form.lineItems.length > 1 && (
                        <IconButton label={`Remove line ${idx + 1}`}
                          onClick={() => setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))}
                          className="text-muted-foreground hover:text-red-400">
                          <XIcon size={12} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/10 p-4 flex justify-end">
            <div className="flex justify-between items-center gap-12">
              <span className="text-sm text-muted-foreground">TOTAL</span>
              <span className="text-xl font-semibold" style={{ color: BRAND }}>{fmt$(total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Field label="Notes or dispute reason">
        <Textarea className="bg-white/5 border-white/20 min-h-16 resize-none" placeholder="Optional notes…"
          value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </Field>

      {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-3">
        <Button variant="brand" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Invoice'}
        </Button>
        <Button variant="outline" className="border-white/20" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Invoice Row ───────────────────────────────────────────────────────────────

function InvoiceRow({ inv, jobs, allInvoices, materials }) {
  const { run } = useMutation()
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()

  const meta = STATUS_META[inv.status] || STATUS_META['pending-review']
  const job = jobs.find(j => j.id === inv.jobId)

  // Re-run audit live against current materials (may have changed since save)
  const liveFlags = useMemo(
    () => auditInvoice(inv, allInvoices, materials),
    [inv, allInvoices, materials]
  )

  // The dot says by its color how serious the worst flag is, and the words beside it say the
  // same: how many flags and how many are critical, or, to a screen reader, No flags.
  const flagTone = liveFlags.some(f => f.severity === 'critical') ? 'critical' : liveFlags.length > 0 ? 'warning' : 'success'

  // The whole row header is the button that opens the row: it says whether the row is open
  // and names the detail it opens. It holds words only, laid out with spans.
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-white/5 cursor-pointer transition-colors"
      >
        <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: toneHex(flagTone) }} />

        <span className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
          <span className="block min-w-0">
            <span className="block text-sm font-bold truncate">{inv.vendor}</span>
            <span className="block text-xs text-muted-foreground">#{inv.invoiceNum}</span>
          </span>
          <span className="hidden sm:block text-xs text-muted-foreground">{inv.invoiceDate || 'No date'}</span>
          <span className="hidden sm:block text-xs">
            {inv.jobId
              ? <span className="px-1.5 py-0.5 rounded bg-white/10">{inv.jobId}</span>
              : <span className="text-muted-foreground">No job</span>}
          </span>
          <span className="block text-sm font-semibold" style={{ color: BRAND }}>{fmt$(inv.total)}</span>
          <span className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{ color: toneText(meta.tone), backgroundColor: withAlpha(toneHex(meta.tone), 0.13) }}>
              {meta.label}
            </span>
            {liveFlags.length > 0 ? (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: withAlpha(toneHex(flagTone), 0.13), color: toneText(flagTone) }}>
                {flagWords(liveFlags)}
              </span>
            ) : <span className="sr-only">No flags</span>}
          </span>
        </span>

        <span aria-hidden="true" className="text-muted-foreground shrink-0">
          {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </span>
      </button>

      {expanded && (
        <div id={detailId} className="px-4 pb-4 space-y-3 bg-white/3">
          {liveFlags.length > 0 && <FlagList flags={liveFlags} />}

          {/* Line items table */}
          {(inv.lineItems || []).length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-right px-3 py-2 font-medium">Qty</th>
                    <th className="text-center px-3 py-2 font-medium">Unit</th>
                    <th className="text-right px-3 py-2 font-medium">Unit Price</th>
                    <th className="text-right px-3 py-2 font-medium">Extended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {inv.lineItems.map((li, i) => (
                    <tr key={i} className="hover:bg-white/5">
                      <td className="px-3 py-2">{li.desc}</td>
                      <td className="px-3 py-2 text-right">{li.qty}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{li.unit}</td>
                      <td className="px-3 py-2 text-right">{fmt$(li.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-semibold" style={{ color: BRAND }}>{fmt$(li.extPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {inv.notes && (
            <p className="text-xs text-muted-foreground italic">{inv.notes}</p>
          )}

          {/* Status update + job info */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xs text-muted-foreground">Status:</span>
              <Select
                value={inv.status || 'pending-review'}
                onValueChange={v => inv._docId && run(() => updateSupplierInvoice(inv._docId, { status: v }), {
                  success: `Status set to ${(STATUS_META[v]?.label || v).toLowerCase()}.`,
                  error: 'Could not change the status. Try again.',
                  queue: true,
                })}
              >
                <SelectTrigger aria-label={`Status of invoice ${inv.invoiceNum}`} className="h-7 text-xs px-2 bg-white/5 border-white/20 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_META[s]?.label || s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {job && (
              <span className="text-xs text-muted-foreground">
                Job: <span className="font-medium text-foreground">{job.name || job.client} ({job.id})</span>
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Added {inv.createdAt?.toDate?.()?.toLocaleDateString?.() || ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function InvoiceAuditor() {
  const { jobs, materials, scope } = useData()
  const { invoices, loading } = useSupplierInvoices(scope)
  const [showForm, setShowForm] = useState(false)
  const [vendorFilter, setVendorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const allVendors = [...new Set(invoices.map(i => i.vendor).filter(Boolean))]

  const filtered = invoices.filter(inv => {
    if (vendorFilter !== 'all' && inv.vendor !== vendorFilter) return false
    if (statusFilter !== 'all' && (inv.status || 'pending-review') !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        (inv.vendor || '').toLowerCase().includes(q) ||
        (inv.invoiceNum || '').toLowerCase().includes(q) ||
        (inv.jobId || '').toLowerCase().includes(q) ||
        (inv.lineItems || []).some(li => (li.desc || '').toLowerCase().includes(q))
      )
    }
    return true
  })

  // Stats
  const pendingCount    = invoices.filter(i => i.status === 'pending-review').length
  const disputedCount   = invoices.filter(i => i.status === 'disputed').length
  const flaggedCount    = invoices.filter(i => (i.flags || []).length > 0).length
  const totalPending    = invoices.filter(i => i.status === 'pending-review').reduce((s, i) => s + (i.total || 0), 0)
  const totalDisputed   = invoices.filter(i => i.status === 'disputed').reduce((s, i) => s + (i.total || 0), 0)
  const totalApproved   = invoices.filter(i => i.status === 'approved' || i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0)

  if (showForm) {
    return (
      <InvoiceForm
        jobs={jobs}
        allInvoices={invoices}
        materials={materials}
        onClose={() => setShowForm(false)}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold" style={{ color: BRAND }}>Supplier Invoice Auditor</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Audit supplier invoices against POs · flag price variances, duplicates &amp; discrepancies
          </p>
        </div>
        <Button variant="brand" className="gap-2" onClick={() => setShowForm(true)}>
          <PlusIcon size={14} /> New Invoice
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Pending Review',  value: pendingCount,  sub: fmt$(totalPending),   color: toneHex('warning'),  Icon: FileTextIcon     },
          { label: 'Disputed',        value: disputedCount, sub: fmt$(totalDisputed),  color: toneHex('critical'), Icon: ShieldAlertIcon  },
          { label: 'Audit Flags',     value: flaggedCount,  sub: 'invoices w/ flags',  color: BRAND,              Icon: AlertTriangleIcon },
          { label: 'Approved / Paid', value: invoices.filter(i => i.status === 'approved' || i.status === 'paid').length,
            sub: fmt$(totalApproved), color: toneHex('success'), Icon: CheckCircleIcon },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4 border border-white/10" style={{ backgroundColor: withAlpha(s.color, 0.03) }}>
            <div className="flex items-center gap-2 mb-2">
              <s.Icon size={13} style={{ color: s.color }} />
              <span className="text-xs text-muted-foreground uppercase tracking-widest">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search invoices" className="pl-8 bg-white/5 border-white/20 h-9 text-sm" placeholder="Search vendor, invoice #, job…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger aria-label="Filter by vendor" className="w-40 bg-white/5 border-white/20 h-9 text-sm">
            <SelectValue placeholder="All Vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {allVendors.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filter by status" className="w-40 bg-white/5 border-white/20 h-9 text-sm">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{STATUS_META[s]?.label || s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Invoice List */}
      <Card className="border-white/10 overflow-hidden">
        {/* Column headers */}
        <div className="hidden sm:grid sm:grid-cols-5 gap-2 px-4 py-2 border-b border-white/10 text-xs text-muted-foreground font-medium">
          <span>Vendor / Invoice #</span>
          <span>Date</span>
          <span>Job</span>
          <span>Total</span>
          <span>Status</span>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 rounded-full border-2 animate-spin"
                style={{ borderColor: withAlpha(BRAND, 0.2), borderTopColor: BRAND }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ReceiptIcon size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm mb-3">
                {invoices.length === 0 ? 'No invoices yet — add your first one above' : 'No invoices match the current filters'}
              </p>
              {invoices.length === 0 && (
                <Button variant="brand" className="gap-2 text-xs" onClick={() => setShowForm(true)}>
                  <PlusIcon size={12} /> Add First Invoice
                </Button>
              )}
            </div>
          ) : (
            filtered.map(inv => (
              <InvoiceRow
                key={inv._docId}
                inv={inv}
                jobs={jobs}
                allInvoices={invoices}
                materials={materials}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Audit legend */}
      <Card className="border-white/10 bg-white/5">
        <CardContent className="pt-3 pb-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Audit Rules</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
            {[
              { dot: '#ef4444', text: 'Duplicate invoice # from same vendor → critical flag' },
              { dot: '#ef4444', text: 'Unit price >30% above PO cost → critical flag' },
              { dot: '#eab308', text: 'Unit price 15–30% above PO cost → warning flag' },
              { dot: '#eab308', text: 'Invoice not assigned to a job → warning flag' },
              { dot: '#eab308', text: 'High-value invoice (>$15k) unreviewed → warning flag' },
              { dot: '#22c55e', text: 'No flags → invoice is clean' },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.dot }} />
                {r.text}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
