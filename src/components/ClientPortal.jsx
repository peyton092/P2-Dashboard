import { useState, useMemo, useRef } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { useData } from '../DataContext'
import {
  approveExtra, updateExtra, addNotification, useJobFiles,
  addSubmit, useSubmitReplies, addSubmitReply, updateSubmit, addJobFile,
} from '../hooks/useFirestore'
import { generateInvoicePdf } from '../lib/generateInvoicePdf'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  HomeIcon, FilePenLineIcon, ReceiptIcon, ImageIcon,
  CheckIcon, XIcon, CheckCircleIcon, ClockIcon, MapPinIcon,
  LogOutIcon, ActivityIcon, BadgeCheckIcon, TriangleAlertIcon,
  GaugeIcon, DownloadIcon, FileTextIcon, CameraIcon,
  MessageSquareIcon, SendIcon, PlusIcon, ChevronLeftIcon,
  CalendarClockIcon, UploadIcon, CreditCardIcon,
} from 'lucide-react'
import Brand from './brand/Brand'
import { DataPanel, Pill, EmptyState, AllClearState } from './shared'

const O = '#F47920'

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (n) => `$${Number(n || 0).toLocaleString()}`
const jobName = (j) => j.name || (j.client || '').split(' ')[0] || j.id

const TODAY = new Date()
const daysSince = (date) => {
  if (!date) return null
  try {
    const d = date?.toDate ? date.toDate() : new Date(date)
    if (isNaN(d.getTime())) return null
    return Math.floor((TODAY - d) / 86400000)
  } catch { return null }
}

const fmtDate = (d) => {
  if (!d) return ''
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d)
    if (isNaN(dt.getTime())) return ''
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '' }
}

// ── Inspection phase aggregation (client-facing, read-only) ──────────────────

const PHASE_STATUS = {
  passed:        { color: '#22c55e', label: 'Passed',      bg: '#22c55e22', Icon: CheckCircleIcon },
  failed:        { color: '#ef4444', label: 'In rework',   bg: '#ef444422', Icon: XIcon },
  pending:       { color: '#eab308', label: 'In progress', bg: '#eab30822', Icon: ClockIcon },
  'not-started': { color: '#6b7280', label: 'Upcoming',    bg: '#6b728022', Icon: ClockIcon },
}

function aggregatePhaseStatus(insp, key) {
  if (!insp) return { status: 'not-started', date: null }
  const trades = ['electrical', 'plumbing', 'hvac']
  let hasFailed = false, hasPassed = false, hasPending = false, latestPassDate = null
  trades.forEach(t => {
    const v = insp[t]?.[key]
    const dateKey = key === 'roughIn' ? 'roughInDate' : key === 'final' ? 'finalDate' : null
    const d = dateKey ? insp[t]?.[dateKey] : null
    if (v === 'failed') hasFailed = true
    else if (v === 'passed') {
      hasPassed = true
      if (d && (!latestPassDate || d > latestPassDate)) latestPassDate = d
    }
    else if (v === 'pending-verification' || v === 'pending' || v === 'scheduled') hasPending = true
  })
  if (hasFailed) return { status: 'failed', date: null }
  if (hasPassed) return { status: 'passed', date: latestPassDate }
  if (hasPending) return { status: 'pending', date: null }
  return { status: 'not-started', date: null }
}

function getServiceReleaseStatus(job) {
  const phase = (job.phase || '').toLowerCase()
  if (phase.includes('service-release-passed') || phase === 'complete') {
    return { status: 'passed', date: job.serviceReleaseDate || null }
  }
  if (phase.includes('service-release-failed')) return { status: 'failed', date: null }
  if (phase.includes('service-release')) return { status: 'pending', date: null }
  if (phase === 'rough-in-passed') return { status: 'pending', date: null }
  return { status: 'not-started', date: null }
}

function getJobInspectionTimeline(job) {
  return [
    { key: 'roughIn',        label: 'Rough-In',        ...aggregatePhaseStatus(job.insp, 'roughIn') },
    { key: 'serviceRelease', label: 'Service Release', ...getServiceReleaseStatus(job) },
    { key: 'final',          label: 'Final',           ...aggregatePhaseStatus(job.insp, 'final') },
  ]
}

function clientStatus(job) {
  if (['complete', 'completed'].includes(job.status)) return { tone: 'success',  text: 'Complete',        color: '#22c55e' }
  if (job.status === 'blocked')      return { tone: 'critical', text: 'Needs attention', color: '#ef4444' }
  if (job.status === 'at-risk')      return { tone: 'warning',  text: 'Watch list',      color: '#eab308' }
  if (job.status === 'needs-action') return { tone: 'warning',  text: 'Action needed',   color: '#eab308' }
  return { tone: 'success', text: 'On track', color: O }
}

function nextMilestoneFor(job) {
  const phases = getJobInspectionTimeline(job)
  const next = phases.find(p => p.status !== 'passed' && p.status !== 'not-started')
  if (next) {
    if (next.status === 'failed')  return `${next.label} — being reworked`
    if (next.status === 'pending') return `${next.label} — in progress`
  }
  const notStarted = phases.find(p => p.status === 'not-started')
  if (notStarted) return `${notStarted.label} — upcoming`
  if (phases.every(p => p.status === 'passed')) return 'All inspections complete'
  return 'In progress'
}

// ── Inspection Timeline ──────────────────────────────────────────────────────

function InspectionTimeline({ job }) {
  const phases = getJobInspectionTimeline(job)
  return (
    <div className="flex items-stretch gap-1 sm:gap-2">
      {phases.map((p, i) => {
        const meta = PHASE_STATUS[p.status]
        const Icon = meta.Icon
        return (
          <div key={p.key} className="flex items-stretch flex-1 min-w-0">
            <div
              className="flex flex-col items-center text-center gap-1 px-2 py-2 rounded-lg flex-1 border min-w-0"
              style={{ backgroundColor: meta.bg, borderColor: meta.color + '55' }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: meta.color + '33' }}>
                <Icon size={14} style={{ color: meta.color }} />
              </div>
              <p className="text-[10px] sm:text-xs font-bold leading-tight truncate w-full" style={{ color: meta.color }}>{p.label}</p>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground leading-tight">
                {p.status === 'passed' && p.date ? fmtDate(p.date) : meta.label}
              </p>
            </div>
            {i < phases.length - 1 && <div className="self-center w-1 h-0.5 sm:w-2 bg-white/10 shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

// ── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ job, extras }) {
  const jobExtras = extras.filter(e => e.job === job.id)
  const pendingCount = jobExtras.filter(e => e.status === 'pending').length
  const phaseLabel = (job.phase || 'unknown').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const daysInPhase = daysSince(job.lastStatusChange)
  const milestone = nextMilestoneFor(job)
  const status = clientStatus(job)

  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.025] overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: status.color }}
    >
      <header className="px-4 sm:px-5 pt-4 pb-3 border-b border-white/5">
        {pendingCount > 0 && (
          <div className="inline-flex items-center gap-1.5 mb-2.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
            style={{ backgroundColor: '#eab30822', color: '#eab308', border: '1px solid #eab30844' }}>
            <TriangleAlertIcon size={11} strokeWidth={2.25} />
            Awaiting your approval · {pendingCount}
          </div>
        )}
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base text-white leading-tight">{jobName(job)}</h3>
              <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">{job.id}</span>
            </div>
            {job.address && (
              <p className="text-xs text-zinc-400 leading-tight flex items-center gap-1 mt-1">
                <MapPinIcon size={11} className="shrink-0" />
                <span className="truncate">{job.address}{job.city ? `, ${job.city}` : ''}</span>
              </p>
            )}
          </div>
          <Pill tone={status.tone} size="xs">{status.text}</Pill>
        </div>

        <div className="mt-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Next milestone</p>
          <p className="text-sm font-semibold text-zinc-100 leading-snug mt-0.5">{milestone}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2.5 text-[11px]">
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
            <p className="text-zinc-400 text-[10px] uppercase tracking-wide font-bold">Current Phase</p>
            <p className="font-semibold text-zinc-100 truncate">{phaseLabel}</p>
            {daysInPhase != null && <p className="text-[10px] text-zinc-400">{daysInPhase}d in phase</p>}
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
            <p className="text-zinc-400 text-[10px] uppercase tracking-wide font-bold">Your P2 Contact</p>
            <p className="font-semibold text-zinc-100 truncate">{job.pm || 'TBD'}</p>
            {job.lead && <p className="text-[10px] text-zinc-400 truncate">Lead: {job.lead}</p>}
          </div>
        </div>
      </header>

      <section className="px-4 sm:px-5 py-4">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-2.5">Inspection Timeline</p>
        <InspectionTimeline job={job} />
      </section>
    </article>
  )
}

// ── Change Order row (approve / request revision) ────────────────────────────

function ExtraRow({ co, clientName }) {
  const [showReject, setShowReject] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  const status = co.status || 'pending'
  const isPending = status === 'pending'

  const handleApprove = async () => {
    if (!co._docId) { setErrMsg('This change order is missing an ID — refresh and try again.'); return }
    setBusy(true); setErrMsg('')
    try {
      await approveExtra(co._docId, clientName || 'Client')
      await addNotification({ type: 'success', msg: `${co.id || 'CO'} approved by ${clientName || 'client'} — ${fmt$(co.amount)} (${co.job})` })
    } catch (err) {
      console.error('[Client] Approve failed:', err)
      setErrMsg('Could not save approval. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  const handleReject = async () => {
    if (!co._docId || !rejectNotes.trim()) return
    setBusy(true); setErrMsg('')
    try {
      await updateExtra(co._docId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        rejectedBy: clientName || 'Client',
        rejectNotes: rejectNotes.trim(),
      })
      await addNotification({ type: 'warn', msg: `${co.id || 'CO'} rejected by ${clientName || 'client'} — ${co.job}: ${rejectNotes.trim().slice(0, 80)}` })
      setShowReject(false); setRejectNotes('')
    } catch (err) {
      console.error('[Client] Reject failed:', err)
      setErrMsg('Could not save your request. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  const stateLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Needs revision' : 'Awaiting your approval'
  const stateTone  = status === 'approved' ? 'success'  : status === 'rejected' ? 'critical'       : 'warning'

  return (
    <div className="rounded-xl border bg-white/[0.025] overflow-hidden"
      style={{ borderColor: status === 'pending' ? '#eab30844' : status === 'rejected' ? '#ef444444' : status === 'approved' ? '#22c55e44' : 'rgba(255,255,255,0.10)' }}>
      <div className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-bold" style={{ color: O }}>{co.id || co.coNumber || '—'}</span>
              <Pill tone={stateTone} size="xs">{stateLabel}</Pill>
              <span className="text-[10px] text-zinc-400">{co.job}</span>
            </div>
            <p className="text-sm text-zinc-100 leading-snug">{co.desc || 'No description'}</p>
            {Array.isArray(co.lineItems) && co.lineItems.length > 0 && (
              <ul className="mt-2 text-[11px] text-zinc-400 space-y-0.5">
                {co.lineItems.map((li, idx) => (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="truncate">· {li.desc}</span>
                    <span className="tabular-nums shrink-0">{fmt$(li.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {co.rejectNotes && status === 'rejected' && (
              <div className="mt-2.5 rounded-lg border border-red-500/30 px-3 py-2" style={{ backgroundColor: '#ef44440a' }}>
                <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: '#ef4444' }}>Your revision request</p>
                <p className="text-[11px] text-zinc-200 italic">“{co.rejectNotes}”</p>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="font-semibold text-base tabular-nums" style={{ color: O }}>{fmt$(co.amount)}</p>
            <p className="text-[10px] text-zinc-400">{co.date || fmtDate(co.createdAt)}</p>
          </div>
        </div>

        {isPending && !showReject && (
          <>
            <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-400 mb-1.5 mt-3">Review change order</p>
            <div className="flex gap-2">
              <Button className="flex-1 h-10 text-xs gap-1.5 text-white font-bold" style={{ backgroundColor: '#22c55e' }} disabled={busy} onClick={handleApprove}>
                <CheckIcon size={14} /> {busy ? 'Approving…' : 'Approve'}
              </Button>
              <Button variant="outline" className="flex-1 h-10 text-xs gap-1.5 border-white/20 hover:bg-white/[0.05] text-zinc-200" disabled={busy} onClick={() => { setShowReject(true); setErrMsg('') }}>
                <XIcon size={14} /> Request revision
              </Button>
            </div>
            {errMsg && <p className="mt-2 text-[11px] text-red-400 leading-tight">{errMsg}</p>}
          </>
        )}

        {isPending && showReject && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-300">Tell P2 what needs to change</p>
            <Textarea className="bg-white/[0.04] border-white/20 text-xs text-zinc-100 min-h-20 placeholder:text-zinc-500"
              placeholder="What should be revised? (required)" value={rejectNotes} onChange={e => setRejectNotes(e.target.value)} />
            <div className="flex gap-2">
              <Button className="flex-1 h-10 text-xs text-white font-bold" style={{ backgroundColor: '#ef4444' }} disabled={busy || !rejectNotes.trim()} onClick={handleReject}>
                {busy ? 'Submitting…' : 'Send revision request'}
              </Button>
              <Button variant="outline" className="flex-1 h-10 text-xs border-white/20 hover:bg-white/[0.05] text-zinc-200" disabled={busy} onClick={() => { setShowReject(false); setRejectNotes(''); setErrMsg('') }}>
                Cancel
              </Button>
            </div>
            {errMsg && <p className="text-[11px] text-red-400 leading-tight">{errMsg}</p>}
          </div>
        )}

        {!isPending && status === 'approved' && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: '#22c55e' }}>
            <CheckCircleIcon size={12} /> Approved
          </div>
        )}
      </div>
    </div>
  )
}

// ── Invoice row ──────────────────────────────────────────────────────────────

const BILLING_META = {
  paid:           { label: 'Paid',                  tone: 'success' },
  invoiced:       { label: 'Invoice submitted',     tone: 'info'    },
  'partial-pay':  { label: 'Partial payment',       tone: 'warning' },
  'not-invoiced': { label: 'Not yet invoiced',      tone: 'neutral' },
}

function InvoiceRow({ job }) {
  const meta = BILLING_META[job.billingStatus] || BILLING_META['not-invoiced']
  const hasInvoice = Boolean(job.invoiceNum)
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.025]">
      <div className="shrink-0 flex items-center justify-center rounded-lg" style={{ width: 36, height: 36, backgroundColor: '#3b82f622', color: '#3b82f6' }}>
        <ReceiptIcon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-zinc-100 truncate">{jobName(job)}</p>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">{job.id}</span>
        </div>
        <p className="text-[11px] text-zinc-400">
          {hasInvoice ? `Invoice ${job.invoiceNum}${job.invoiceDate ? ` · ${job.invoiceDate}` : ''}` : 'No invoice issued yet'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Pill tone={meta.tone} size="xs">{meta.label}</Pill>
        {job.paymentUrl && job.billingStatus !== 'paid' && (
          <a href={job.paymentUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-bold text-white" style={{ backgroundColor: '#22c55e' }}>
            <CreditCardIcon size={13} /> Pay now
          </a>
        )}
        {hasInvoice && (
          <Button variant="outline" className="h-8 px-2.5 text-[11px] gap-1.5 border-white/20 hover:bg-white/[0.05] text-zinc-200" onClick={() => generateInvoicePdf(job)}>
            <DownloadIcon size={13} /> PDF
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Files / photos for a single job ──────────────────────────────────────────

function isImage(file) {
  const t = (file.type || file.contentType || '').toLowerCase()
  if (t.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name || file.url || '')
}

function JobFiles({ job }) {
  const { files, loading } = useJobFiles(job._docId)
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const photos = files.filter(isImage)
  const docs   = files.filter(f => !isImage(f))

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !job._docId) return
    setUploading(true); setUploadErr('')
    try {
      const path = `jobs/${job._docId}/client-uploads/${Date.now()}-${file.name}`
      const sref = storageRef(storage, path)
      await uploadBytes(sref, file)
      const url = await getDownloadURL(sref)
      await addJobFile(job._docId, {
        name: file.name,
        url,
        type: file.type || 'application/octet-stream',
        size: file.size,
        source: 'client-upload',
      })
    } catch (err) {
      console.error('[Client] Upload failed:', err)
      setUploadErr('Upload failed — check the file size or contact P2.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.025]">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="font-bold text-sm text-white truncate">{jobName(job)}</p>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">{job.id}</span>
          <div className="ml-auto shrink-0">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            <Button variant="outline" className="h-7 px-2 text-[11px] gap-1.5 border-white/20 text-zinc-200" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <UploadIcon size={12} /> {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
        {uploadErr && <p className="text-[11px] text-red-400">{uploadErr}</p>}

        {loading ? (
          <p className="text-xs text-zinc-400 py-2">Loading files…</p>
        ) : files.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-4 text-center">
            <CameraIcon size={18} className="mx-auto mb-1.5 text-zinc-500" />
            <p className="text-xs text-zinc-400">No photos or documents shared yet.</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Jobsite photos appear here once CompanyCam sync is enabled.</p>
          </div>
        ) : (
          <>
            {photos.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-1.5 flex items-center gap-1">
                  <ImageIcon size={11} /> Photos · {photos.length}
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {photos.map(p => (
                    <a key={p._docId} href={p.url} target="_blank" rel="noopener noreferrer"
                      className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5 block">
                      <img src={p.url} alt={p.name || 'Jobsite photo'} className="w-full h-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {docs.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-1.5 flex items-center gap-1">
                  <FileTextIcon size={11} /> Documents · {docs.length}
                </p>
                <div className="space-y-1.5">
                  {docs.map(d => (
                    <a key={d._docId} href={d.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                      <FileTextIcon size={14} className="shrink-0 text-zinc-400" />
                      <span className="text-xs text-zinc-200 truncate flex-1">{d.name || 'Document'}</span>
                      <DownloadIcon size={13} className="shrink-0 text-zinc-400" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Messages / RFI ───────────────────────────────────────────────────────────

function ClientMessages({ jobs, clientName }) {
  const { submits } = useData()
  const [view, setView] = useState('inbox')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState({ subject: '', category: 'Question', body: '', jobId: '' })
  const [submitting, setSubmitting] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)

  const selected = submits.find(s => s._docId === selectedId) || null
  const { replies } = useSubmitReplies(selected?._docId)

  // DataContext already scopes submits to this client's jobs.
  const myMessages = submits

  const CATEGORIES = ['Question', 'Schedule', 'Change Request', 'Issue', 'Other']
  const statusColor = { Open: '#ef4444', 'In Progress': O, Resolved: '#22c55e' }

  const handleNew = async () => {
    if (!form.subject.trim() || !form.body.trim() || !form.jobId) return
    setSubmitting(true)
    await addSubmit({
      subject: form.subject.trim(),
      category: form.category,
      priority: 'Medium',
      body: form.body.trim(),
      portal: 'Client',
      clientName: clientName || null,
      jobId: form.jobId,
      status: 'Open',
    })
    setForm({ subject: '', category: 'Question', body: '', jobId: '' })
    setSubmitting(false)
    setView('inbox')
  }

  const handleReply = async () => {
    if (!replyText.trim() || !selected?._docId) return
    setReplying(true)
    await addSubmitReply(selected._docId, {
      body: replyText.trim(),
      author: clientName || 'Client',
      authorRole: 'client',
    })
    if (selected.status === 'Open') await updateSubmit(selected._docId, { status: 'In Progress' })
    setReplyText('')
    setReplying(false)
  }

  if (view === 'thread' && selected) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" className="border-white/20 gap-2 shrink-0 h-9 text-xs" onClick={() => { setView('inbox'); setSelectedId(null) }}>
            <ChevronLeftIcon size={13} /> Back
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-white truncate">{selected.subject}</h2>
            <p className="text-[11px] text-zinc-400">{selected.category} · {selected.jobId || 'No job'} · {fmtDate(selected.createdAt)}</p>
          </div>
          <Pill tone={selected.status === 'Resolved' ? 'success' : selected.status === 'In Progress' ? 'brand' : 'critical'} size="xs">{selected.status || 'Open'}</Pill>
        </div>

        <Card className="border-white/10">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: O + '33', color: O }}>
                {(clientName || 'You').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold">{selected.clientName || clientName || 'You'}</span>
                  <span className="text-[10px] text-muted-foreground">{fmtDate(selected.createdAt)}</span>
                </div>
                <p className="text-xs whitespace-pre-wrap">{selected.body}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {replies.map(r => (
          <Card key={r._docId} className={`border-white/10 ${r.authorRole === 'internal' ? 'ml-6' : ''}`}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: r.authorRole === 'internal' ? '#3b82f622' : '#22c55e22', color: r.authorRole === 'internal' ? '#3b82f6' : '#22c55e' }}>
                  {(r.author || 'P2').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{r.author}{r.authorRole === 'internal' ? ' · P2' : ''}</span>
                    <span className="text-[10px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
                  </div>
                  <p className="text-xs whitespace-pre-wrap">{r.body}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card className="border-white/10">
          <CardContent className="p-3 space-y-2">
            <Textarea className="bg-white/5 border-white/20 min-h-20 text-xs" placeholder="Write a reply…" value={replyText} onChange={e => setReplyText(e.target.value)} />
            <Button className="w-full h-9 text-white text-xs gap-1.5" style={{ backgroundColor: O }} disabled={replying || !replyText.trim()} onClick={handleReply}>
              <SendIcon size={13} /> {replying ? 'Sending…' : 'Send reply'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (view === 'new') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="border-white/20 gap-2 h-9 text-xs" onClick={() => setView('inbox')}>
            <ChevronLeftIcon size={13} /> Back
          </Button>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Contact P2</p>
            <h2 className="text-lg font-semibold tracking-tight text-white mt-0.5">New message</h2>
          </div>
        </div>
        <Card className="border-white/10" style={{ borderColor: O + '33' }}>
          <CardContent className="p-4 space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Project *</label>
              <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20 h-9 text-xs"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>
                  {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.id} — {jobName(j)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Subject *</label>
              <Input className="bg-white/5 border-white/20 h-9 text-xs" placeholder="Brief summary" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Category</label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Message *</label>
              <Textarea className="bg-white/5 border-white/20 min-h-24 text-xs" placeholder="How can P2 help?" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            </div>
            <Button className="w-full h-9 text-white text-xs" style={{ backgroundColor: O }} disabled={submitting || !form.subject.trim() || !form.body.trim() || !form.jobId} onClick={handleNew}>
              {submitting ? 'Sending…' : 'Send to P2'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const openCount = myMessages.filter(s => s.status === 'Open' || !s.status).length

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Contact P2</p>
          <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Messages</h2>
          <p className="text-xs text-zinc-400 mt-1">{openCount} open · {myMessages.length} total</p>
        </div>
        <Button className="h-9 text-white text-xs gap-1.5 font-bold shrink-0" style={{ backgroundColor: O }} onClick={() => setView('new')} disabled={jobs.length === 0}>
          <PlusIcon size={13} /> New message
        </Button>
      </div>

      {myMessages.length === 0 ? (
        <EmptyState
          Icon={MessageSquareIcon}
          title="No messages yet"
          description="Send your P2 team a question, schedule request, or issue about your project and the conversation appears here."
          action={jobs.length > 0 ? (
            <Button className="text-white text-xs h-9 font-bold gap-1.5" style={{ backgroundColor: O }} onClick={() => setView('new')}>
              <PlusIcon size={13} /> Start a message
            </Button>
          ) : null}
        />
      ) : (
        <div className="space-y-2">
          {myMessages.map(s => {
            const sc = statusColor[s.status || 'Open']
            return (
              <button key={s._docId} className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/25 transition-colors"
                onClick={() => { setSelectedId(s._docId); setView('thread') }}>
                <div className="shrink-0 flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, backgroundColor: O + '22', color: O }}>
                  <MessageSquareIcon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{s.subject}</p>
                  <p className="text-[11px] text-zinc-400">{s.category} · {s.jobId || 'general'} · {fmtDate(s.createdAt)}</p>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0" style={{ backgroundColor: sc + '22', color: sc, border: `1px solid ${sc}44` }}>
                  {s.status || 'Open'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Schedule (milestone timeline) ────────────────────────────────────────────

function fmtFullDate(d) {
  if (!d) return null
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d)
    if (isNaN(dt.getTime())) return null
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return null }
}

function ScheduleCard({ job }) {
  const phases = getJobInspectionTimeline(job)
  const isComplete = ['complete', 'completed'].includes(job.status)
  const milestones = [
    { label: 'Project start', date: job.start, status: job.start ? 'passed' : 'not-started' },
    ...phases.map(p => ({ label: p.label, date: p.date, status: p.status })),
    { label: 'Target completion', date: job.target, status: isComplete ? 'passed' : 'not-started' },
  ]

  return (
    <Card className="border-white/10 bg-white/[0.025]">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <p className="font-bold text-sm text-white truncate">{jobName(job)}</p>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">{job.id}</span>
        </div>
        <ol className="relative ml-1.5">
          {milestones.map((m, i) => {
            const meta = PHASE_STATUS[m.status] || PHASE_STATUS['not-started']
            const last = i === milestones.length - 1
            const dateStr = fmtFullDate(m.date)
            return (
              <li key={m.label + i} className="relative pl-6 pb-4 last:pb-0">
                {!last && <span className="absolute left-[5px] top-3 bottom-0 w-px bg-white/10" />}
                <span className="absolute left-0 top-1 w-3 h-3 rounded-full border-2" style={{ borderColor: meta.color, backgroundColor: meta.color + '44' }} />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-100">{m.label}</p>
                  <span className="text-[10px] font-bold uppercase tracking-wide shrink-0" style={{ color: meta.color }}>{meta.label}</span>
                </div>
                <p className="text-[11px] text-zinc-400">{dateStr || (m.status === 'passed' ? 'Done' : 'Date TBD')}</p>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

// ── Stat tile ────────────────────────────────────────────────────────────────

function PortalStat({ label, value, sub, Icon, accent }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 truncate">{label}</p>
        {Icon && <Icon size={13} strokeWidth={2} style={{ color: accent }} className="shrink-0" />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl font-semibold tabular-nums leading-none" style={{ color: accent }}>{value}</p>
        {sub && <p className="text-[10px] text-zinc-400 leading-none truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main Portal ──────────────────────────────────────────────────────────────

export default function ClientPortal({ clientName = 'Client', userName = '', onLogout }) {
  const { jobs, extras, submits = [] } = useData()
  const [activeTab, setActiveTab] = useState('projects')
  const [projectFilter, setProjectFilter] = useState('__ALL__')

  const visibleJobs = useMemo(() => {
    if (projectFilter === '__ALL__') return jobs
    return jobs.filter(j => j.id === projectFilter)
  }, [jobs, projectFilter])

  const jobIds = useMemo(() => new Set(visibleJobs.map(j => j.id)), [visibleJobs])
  const visibleExtras = useMemo(() => extras.filter(e => jobIds.has(e.job)), [extras, jobIds])

  const activeJobs    = visibleJobs.filter(j => !['complete', 'completed'].includes(j.status))
  const completedJobs = visibleJobs.filter(j => ['complete', 'completed'].includes(j.status))
  const pendingExtras = visibleExtras.filter(e => e.status === 'pending')
  const pendingValue  = pendingExtras.reduce((s, e) => s + (e.amount || 0), 0)
  const openInvoices  = visibleJobs.filter(j => j.invoiceNum && j.billingStatus !== 'paid').length
  const openMessages  = submits.filter(s => s.status === 'Open' || !s.status).length

  const TABS = [
    { id: 'projects',  label: 'Projects',  Icon: HomeIcon,          count: 0 },
    { id: 'schedule',  label: 'Schedule',  Icon: CalendarClockIcon, count: 0 },
    { id: 'extras',    label: 'Approvals', Icon: FilePenLineIcon,   count: pendingExtras.length },
    { id: 'invoices',  label: 'Invoices',  Icon: ReceiptIcon,       count: 0 },
    { id: 'files',     label: 'Photos',    Icon: ImageIcon,         count: 0 },
    { id: 'messages',  label: 'Messages',  Icon: MessageSquareIcon, count: openMessages },
  ]

  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="px-4 sm:px-8 pt-4 pb-3 flex items-center gap-3 sm:gap-4">
          <Brand size={32} tone="light" className="shrink-0" />
          <div className="hidden sm:block w-px h-7 bg-white/10" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Client Portal</p>
            <p className="font-bold text-base text-white leading-tight truncate mt-0.5">{clientName}</p>
          </div>
          {onLogout && (
            <Button variant="outline" className="border-white/15 h-9 w-9 p-0 sm:w-auto sm:px-3 gap-1.5 shrink-0 hover:bg-white/[0.05] text-zinc-200" onClick={onLogout}>
              <LogOutIcon size={13} />
              <span className="hidden sm:inline text-xs">Sign out</span>
            </Button>
          )}
        </div>

        {/* Project selector + stat tiles */}
        <div className="px-4 sm:px-8 pb-4 grid gap-3 sm:grid-cols-[260px_1fr]">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="bg-white/[0.04] border-white/10 text-zinc-100 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All my projects</SelectItem>
              {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.id} — {jobName(j)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <PortalStat label="Active"           value={activeJobs.length}    Icon={ActivityIcon}    accent={O} />
            <PortalStat label="Awaiting approval" value={pendingExtras.length} Icon={FilePenLineIcon} accent={pendingExtras.length > 0 ? '#eab308' : '#9ca3af'} sub={pendingExtras.length > 0 ? fmt$(pendingValue) : undefined} />
            <PortalStat label="Open invoices"    value={openInvoices}         Icon={ReceiptIcon}     accent={openInvoices > 0 ? '#3b82f6' : '#9ca3af'} />
            <PortalStat label="Completed"        value={completedJobs.length} Icon={BadgeCheckIcon}  accent="#22c55e" />
          </div>
        </div>
      </header>

      {/* Desktop tabs */}
      <div className="hidden sm:flex border-b border-white/10 px-8 gap-1 overflow-x-auto">
        {TABS.map(t => {
          const active = activeTab === t.id
          return (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-colors shrink-0"
              style={{ borderColor: active ? O : 'transparent', color: active ? O : '#9ca3af' }}>
              <t.Icon size={14} strokeWidth={active ? 2.25 : 2} />
              {t.label}
              {t.count > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: O + '22', color: O }}>{t.count}</span>}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <main className="flex-1 px-4 sm:px-8 py-5 pb-28 sm:pb-8 space-y-5 max-w-3xl w-full mx-auto">
        {activeTab === 'projects' && (
          visibleJobs.length === 0 ? (
            <EmptyState Icon={HomeIcon} title="No projects yet" description="Your projects will appear here once P2 assigns them to your account." />
          ) : (
            <>
              {activeJobs.length > 0 && (
                <DataPanel
                  title="Project overview"
                  description={pendingExtras.length > 0
                    ? `${pendingExtras.length} change order${pendingExtras.length === 1 ? '' : 's'} awaiting your approval`
                    : `${activeJobs.length} active project${activeJobs.length === 1 ? '' : 's'}`}
                  Icon={GaugeIcon}
                  badge={pendingExtras.length > 0 ? <Pill tone="warning" size="xs">Action needed</Pill> : <Pill tone="success" size="xs">On track</Pill>}
                >
                  <div className="space-y-3">
                    {activeJobs.map(j => <ProjectCard key={j._docId || j.id} job={j} extras={visibleExtras} />)}
                  </div>
                </DataPanel>
              )}
              {completedJobs.length > 0 && (
                <section className="space-y-3 pt-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Completed</h2>
                    <Pill tone="success" size="xs">{completedJobs.length}</Pill>
                  </div>
                  {completedJobs.map(j => <ProjectCard key={j._docId || j.id} job={j} extras={visibleExtras} />)}
                </section>
              )}
            </>
          )
        )}

        {activeTab === 'schedule' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Schedule</p>
              <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Project milestones</h2>
              <p className="text-xs text-zinc-400 mt-1">Start, inspection milestones, and target completion for each project.</p>
            </div>
            {visibleJobs.length === 0 ? (
              <EmptyState Icon={CalendarClockIcon} title="No schedule yet" description="Milestones appear here once your projects are underway." />
            ) : (
              <div className="space-y-3">
                {visibleJobs.map(j => <ScheduleCard key={j._docId || j.id} job={j} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'extras' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Change Orders</p>
              <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Review &amp; approve</h2>
              <p className="text-xs text-zinc-400 mt-1">
                {pendingExtras.length} awaiting · {fmt$(pendingValue)} pending
              </p>
            </div>
            {visibleExtras.length === 0 ? (
              <EmptyState Icon={FilePenLineIcon} title="No change orders" description="When P2 sends a change order for your review, it will appear here." />
            ) : pendingExtras.length === 0 ? (
              <>
                <AllClearState title="No approvals pending" description="No change orders are waiting for your decision right now." />
                <div className="space-y-2">
                  {visibleExtras.map(co => <ExtraRow key={co._docId || co.id} co={co} clientName={userName || clientName} />)}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {visibleExtras.map(co => <ExtraRow key={co._docId || co.id} co={co} clientName={userName || clientName} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Billing</p>
              <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Invoices &amp; payments</h2>
              <p className="text-xs text-zinc-400 mt-1">{openInvoices} open · {visibleJobs.length} project{visibleJobs.length === 1 ? '' : 's'}</p>
            </div>
            {visibleJobs.length === 0 ? (
              <EmptyState Icon={ReceiptIcon} title="No invoices" description="Invoices for your projects will appear here." />
            ) : (
              <div className="space-y-2">
                {visibleJobs.map(j => <InvoiceRow key={j._docId || j.id} job={j} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'files' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: O }}>Documentation</p>
              <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Photos &amp; documents</h2>
              <p className="text-xs text-zinc-400 mt-1">Jobsite photos and project documents shared by P2.</p>
            </div>
            {visibleJobs.length === 0 ? (
              <EmptyState Icon={ImageIcon} title="Nothing shared yet" description="Photos and documents for your projects will appear here." />
            ) : (
              <div className="space-y-3">
                {visibleJobs.map(j => <JobFiles key={j._docId || j.id} job={j} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <ClientMessages jobs={visibleJobs} clientName={userName || clientName} />
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-white/10"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
          {TABS.map(t => {
            const active = activeTab === t.id
            return (
              <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                className="flex flex-col items-center justify-center gap-0.5 py-2.5 relative transition-colors"
                style={{ color: active ? O : '#9ca3af' }}>
                <t.Icon size={20} strokeWidth={active ? 2.25 : 2} />
                <span className="text-[10px] font-semibold leading-none">{t.label}</span>
                {t.count > 0 && (
                  <span className="absolute top-1 right-[26%] text-[9px] text-white font-black rounded-full flex items-center justify-center"
                    style={{ backgroundColor: O, minWidth: 14, height: 14, padding: '0 3px' }}>
                    {t.count > 99 ? '99+' : t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
