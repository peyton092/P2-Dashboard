import { useState, useMemo, useEffect } from 'react'
import { useData } from '../DataContext'
import {
  approveExtra, rejectExtra, updateExtra, addNotification, addSubmit, updateSubmit,
  useSubmitReplies, addSubmitReply, updateNotification,
} from '../hooks/useFirestore'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ClipboardIcon, PlusIcon, BellIcon, SendIcon, MessageSquareIcon,
  ChevronLeftIcon, ChevronRightIcon, CheckIcon, XIcon, AlertCircleIcon,
  CheckCircleIcon, ClockIcon, MapPinIcon, Building2Icon, LogOutIcon,
  AlertTriangleIcon, InfoIcon, HomeIcon,
} from 'lucide-react'

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

// ── Inspection phase aggregation ─────────────────────────────────────────────

const PHASE_STATUS = {
  passed:    { color: '#22c55e', label: 'Passed',     bg: '#22c55e22', Icon: CheckCircleIcon },
  failed:    { color: '#ef4444', label: 'Failed',     bg: '#ef444422', Icon: XIcon },
  pending:   { color: '#eab308', label: 'Pending',    bg: '#eab30822', Icon: ClockIcon },
  scheduled: { color: '#3b82f6', label: 'Scheduled',  bg: '#3b82f622', Icon: ClockIcon },
  'not-started': { color: '#6b7280', label: 'Not Started', bg: '#6b728022', Icon: ClockIcon },
}

// Aggregate per-trade roughIn / final into a single phase status.
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
    else if (v === 'pending-verification' || v === 'pending') hasPending = true
    else if (v === 'scheduled') hasPending = true
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

// ── Inspection Timeline component ────────────────────────────────────────────

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
              style={{
                backgroundColor: meta.bg,
                borderColor: meta.color + '55',
              }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ backgroundColor: meta.color + '33' }}
              >
                <Icon size={14} style={{ color: meta.color }} />
              </div>
              <p className="text-[10px] sm:text-xs font-bold leading-tight truncate w-full" style={{ color: meta.color }}>
                {p.label}
              </p>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground leading-tight">
                {p.status === 'passed' && p.date ? fmtDate(p.date) : meta.label}
              </p>
            </div>
            {i < phases.length - 1 && (
              <div className="self-center w-1 h-0.5 sm:w-2 bg-white/10 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Per-trade inspection pills ───────────────────────────────────────────────

function TradeInspectionPills({ insp }) {
  if (!insp) return null
  const rows = ['electrical', 'plumbing', 'hvac'].map(trade => {
    const t = insp[trade]
    if (!t) return null
    const r = t.roughIn, f = t.final
    if (!r || (r === 'n/a' && f === 'n/a')) return null
    return { trade, roughIn: r, final: f, roughInDate: t.roughInDate, finalDate: t.finalDate }
  }).filter(Boolean)

  if (rows.length === 0) return null

  const meta = (s) => {
    if (s === 'passed') return { c: '#22c55e', l: 'P' }
    if (s === 'failed') return { c: '#ef4444', l: 'F' }
    if (s === 'pending-verification' || s === 'pending') return { c: '#eab308', l: '·' }
    if (s === 'scheduled') return { c: '#3b82f6', l: 'S' }
    return { c: '#6b7280', l: '—' }
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
      {rows.map(r => (
        <div key={r.trade} className="rounded-lg bg-white/5 border border-white/10 p-1.5">
          <p className="font-bold capitalize text-[10px] mb-1 text-muted-foreground">{r.trade}</p>
          <div className="flex items-center gap-1">
            <span className="w-3.5 h-3.5 rounded-full text-[8px] flex items-center justify-center font-black"
              style={{ backgroundColor: meta(r.roughIn).c + '33', color: meta(r.roughIn).c }}>
              {meta(r.roughIn).l}
            </span>
            <span className="text-muted-foreground">R</span>
            <span className="text-muted-foreground/40 mx-0.5">·</span>
            <span className="w-3.5 h-3.5 rounded-full text-[8px] flex items-center justify-center font-black"
              style={{ backgroundColor: meta(r.final).c + '33', color: meta(r.final).c }}>
              {meta(r.final).l}
            </span>
            <span className="text-muted-foreground">F</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, extras }) {
  const [expanded, setExpanded] = useState(false)
  const jobExtras = extras.filter(e => e.job === job.id)
  const approvedTotal = jobExtras.filter(e => e.status === 'approved').reduce((s, e) => s + (e.amount || 0), 0)
  const pendingTotal  = jobExtras.filter(e => e.status === 'pending').reduce((s, e) => s + (e.amount || 0), 0)
  const pendingCount  = jobExtras.filter(e => e.status === 'pending').length

  const phaseLabel = (job.phase || 'unknown').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const lastChange = job.lastStatusChange
  const daysInPhase = daysSince(lastChange)

  const isComplete = ['complete', 'completed'].includes(job.status)
  const statusColor = isComplete ? '#22c55e' : job.status === 'blocked' ? '#ef4444' : job.status === 'at-risk' ? '#eab308' : O

  return (
    <Card className="border-white/10 overflow-hidden" style={{ borderColor: statusColor + '33' }}>
      <CardContent className="p-0">
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-black text-base leading-tight" style={{ color: O }}>{jobName(job)}</h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{job.id}</span>
              </div>
              {job.address && (
                <p className="text-xs text-muted-foreground leading-tight flex items-center gap-1">
                  <MapPinIcon size={10} className="shrink-0" /> {job.address}
                </p>
              )}
            </div>
            <span
              className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0 whitespace-nowrap"
              style={{ backgroundColor: statusColor + '22', color: statusColor, border: `1px solid ${statusColor}44` }}
            >
              {(job.status || '').replace(/-/g, ' ').toUpperCase()}
            </span>
          </div>

          {/* Phase + permit row */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/5 p-2">
              <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Phase</p>
              <p className="font-semibold truncate">{phaseLabel}</p>
              {daysInPhase != null && (
                <p className="text-[10px] text-muted-foreground">{daysInPhase}d in phase</p>
              )}
            </div>
            <div className="rounded-lg bg-white/5 p-2">
              <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Permit</p>
              <p className="font-semibold font-mono truncate">{job.permitNumber || '—'}</p>
              <p className="text-[10px] text-muted-foreground truncate">{job.county ? `${job.county} County` : (job.city || '')}</p>
            </div>
          </div>
        </div>

        {/* Inspection Timeline */}
        <div className="p-4 border-b border-white/5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Inspection Timeline</p>
          <InspectionTimeline job={job} />
        </div>

        {/* Per-trade inspections (collapsible) */}
        {job.insp && (
          <div className="p-4 border-b border-white/5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">By Trade</p>
            <TradeInspectionPills insp={job.insp} />
          </div>
        )}

        {/* Extras totals + toggle */}
        <button
          className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-3 text-left">
            <PlusIcon size={14} style={{ color: O }} />
            <div>
              <p className="text-xs font-bold">Change Orders</p>
              <p className="text-[10px] text-muted-foreground">
                {jobExtras.length === 0 ? 'No change orders' : `${jobExtras.length} total`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <div className="text-right">
                <p className="text-[9px] uppercase font-bold tracking-wider" style={{ color: '#eab308' }}>Pending</p>
                <p className="text-xs font-bold" style={{ color: '#eab308' }}>{fmt$(pendingTotal)}</p>
              </div>
            )}
            {approvedTotal > 0 && (
              <div className="text-right">
                <p className="text-[9px] uppercase font-bold tracking-wider" style={{ color: '#22c55e' }}>Approved</p>
                <p className="text-xs font-bold" style={{ color: '#22c55e' }}>{fmt$(approvedTotal)}</p>
              </div>
            )}
            <ChevronRightIcon
              size={14}
              className="text-muted-foreground transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
            />
          </div>
        </button>

        {expanded && (
          <div className="p-4 pt-0 space-y-2">
            {jobExtras.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No change orders for this job.</p>
            )}
            {jobExtras.map(co => (
              <ExtraRow key={co._docId || co.id} co={co} compact />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Extra Row (with approve/reject) ──────────────────────────────────────────

function ExtraRow({ co, compact = false }) {
  const [showReject, setShowReject] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  const status = co.status || 'pending'
  const isPending = status === 'pending'
  const sColor = status === 'approved' ? '#22c55e' : status === 'rejected' ? '#ef4444' : '#eab308'

  const handleApprove = async () => {
    if (!co._docId) {
      setErrMsg('This change order is missing a document ID — refresh the page and try again.')
      return
    }
    setBusy(true)
    setErrMsg('')
    try {
      await approveExtra(co._docId, 'QBS Coordinator')
      await addNotification({
        type: 'success',
        msg: `${co.id || 'CO'} approved by QBS — ${fmt$(co.amount)} (${co.job})`,
      })
    } catch (err) {
      console.error('[QBS] Approve failed:', err)
      setErrMsg('Could not save approval. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async () => {
    if (!co._docId || !rejectNotes.trim()) return
    setBusy(true)
    setErrMsg('')
    try {
      await updateExtra(co._docId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        rejectedBy: 'QBS Coordinator',
        rejectNotes: rejectNotes.trim(),
      })
      await addNotification({
        type: 'warn',
        msg: `${co.id || 'CO'} rejected by QBS — ${co.job}: ${rejectNotes.trim().slice(0, 80)}`,
      })
      setShowReject(false)
      setRejectNotes('')
    } catch (err) {
      console.error('[QBS] Reject failed:', err)
      setErrMsg('Could not save rejection. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className={compact ? 'p-3' : 'p-4'}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-xs font-bold" style={{ color: O }}>{co.id || '—'}</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: sColor + '22', color: sColor }}
              >
                {status.toUpperCase()}
              </span>
              {!compact && <span className="text-[10px] text-muted-foreground">{co.job}</span>}
            </div>
            <p className="text-sm leading-tight">{co.desc || 'No description'}</p>
            {co.lineItems && Array.isArray(co.lineItems) && co.lineItems.length > 0 && (
              <ul className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                {co.lineItems.map((li, idx) => (
                  <li key={idx} className="flex justify-between">
                    <span>· {li.desc}</span>
                    <span>{fmt$(li.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {co.rejectNotes && status === 'rejected' && (
              <p className="mt-2 text-[11px] text-red-400/80 italic">Rejection: {co.rejectNotes}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="font-black text-base" style={{ color: O }}>{fmt$(co.amount)}</p>
            <p className="text-[10px] text-muted-foreground">{co.date || fmtDate(co.createdAt)}</p>
          </div>
        </div>

        {isPending && !showReject && (
          <>
            <div className="flex gap-2 mt-3">
              <Button
                className="flex-1 h-9 text-xs gap-1.5 text-white"
                style={{ backgroundColor: '#22c55e' }}
                disabled={busy}
                onClick={handleApprove}
              >
                <CheckIcon size={13} /> {busy ? 'Approving…' : 'Approve'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs gap-1.5 border-white/20"
                disabled={busy}
                onClick={() => { setShowReject(true); setErrMsg('') }}
              >
                <XIcon size={13} /> Reject
              </Button>
            </div>
            {errMsg && (
              <p className="mt-2 text-[11px] text-red-400 leading-tight">{errMsg}</p>
            )}
          </>
        )}

        {isPending && showReject && (
          <div className="mt-3 space-y-2">
            <Textarea
              className="bg-white/5 border-white/20 text-xs min-h-20"
              placeholder="Reason for rejection (required)…"
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 h-9 text-xs text-white"
                style={{ backgroundColor: '#ef4444' }}
                disabled={busy || !rejectNotes.trim()}
                onClick={handleReject}
              >
                {busy ? 'Submitting…' : 'Confirm Reject'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs border-white/20"
                disabled={busy}
                onClick={() => { setShowReject(false); setRejectNotes(''); setErrMsg('') }}
              >
                Cancel
              </Button>
            </div>
            {errMsg && (
              <p className="text-[11px] text-red-400 leading-tight">{errMsg}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── QBS Submit (RFI) ─────────────────────────────────────────────────────────

function QBSSubmit({ qbsPM, jobs }) {
  const { submits } = useData()
  const [view, setView] = useState('inbox')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState({ subject: '', category: 'RFI', priority: 'Medium', body: '', jobId: '' })
  const [submitting, setSubmitting] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)

  const selected = submits.find(s => s._docId === selectedId) || null
  const { replies } = useSubmitReplies(selected?._docId)

  // Filter to QBS portal submits (relevant to this user's jobs)
  const myJobIds = new Set(jobs.map(j => j.id))
  const myPortalSubmits = submits.filter(s => s.portal === 'Builder' || s.portal === 'QBS' || (s.jobId && myJobIds.has(s.jobId)))

  const CATEGORIES = ['RFI', 'Issue', 'Question', 'Change Request', 'Approval', 'Other']
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
  const priorityColor = { Low: '#22c55e', Medium: '#eab308', High: O, Critical: '#ef4444' }
  const statusColor = { Open: '#ef4444', 'In Progress': O, Resolved: '#22c55e' }

  const handleNew = async () => {
    if (!form.subject.trim() || !form.body.trim()) return
    setSubmitting(true)
    await addSubmit({
      subject: form.subject.trim(),
      category: form.category,
      priority: form.priority,
      body: form.body.trim(),
      portal: 'Builder',
      qbsPM: qbsPM || null,
      jobId: form.jobId || null,
      status: 'Open',
    })
    setForm({ subject: '', category: 'RFI', priority: 'Medium', body: '', jobId: '' })
    setSubmitting(false)
    setView('inbox')
  }

  const handleReply = async () => {
    if (!replyText.trim() || !selected?._docId) return
    setReplying(true)
    await addSubmitReply(selected._docId, {
      body: replyText.trim(),
      author: qbsPM || 'QBS Coordinator',
      authorRole: 'builder',
    })
    if (selected.status === 'Open') {
      await updateSubmit(selected._docId, { status: 'In Progress' })
    }
    setReplyText('')
    setReplying(false)
  }

  if (view === 'thread' && selected) {
    const sc = statusColor[selected.status || 'Open']
    const pc = priorityColor[selected.priority] || '#6b7280'
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Button
            variant="outline" className="border-white/20 gap-2 shrink-0 h-9 text-xs"
            onClick={() => { setView('inbox'); setSelectedId(null) }}
          >
            <ChevronLeftIcon size={13} /> Back
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold truncate">{selected.subject}</h2>
            <p className="text-[11px] text-muted-foreground">
              {selected.category} · {selected.jobId || 'No job'} · {fmtDate(selected.createdAt)}
            </p>
          </div>
        </div>

        <Card className="border-white/10">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ backgroundColor: O + '33', color: O }}>QB</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold">{selected.qbsPM || 'QBS'}</span>
                  <span className="text-[10px] text-muted-foreground">{fmtDate(selected.createdAt)}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-auto"
                    style={{ backgroundColor: pc + '22', color: pc }}>{selected.priority}</span>
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
                  style={{
                    backgroundColor: r.authorRole === 'internal' ? '#3b82f622' : '#22c55e22',
                    color: r.authorRole === 'internal' ? '#3b82f6' : '#22c55e',
                  }}>
                  {(r.author || 'P2').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{r.author}</span>
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
            <Textarea
              className="bg-white/5 border-white/20 min-h-20 text-xs"
              placeholder="Write a reply…"
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
            />
            <Button
              className="w-full h-9 text-white text-xs gap-1.5"
              style={{ backgroundColor: O }}
              disabled={replying || !replyText.trim()}
              onClick={handleReply}
            >
              <SendIcon size={13} /> {replying ? 'Sending…' : 'Send Reply'}
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Status:</span>
          <Select
            value={selected.status || 'Open'}
            onValueChange={v => selected._docId && updateSubmit(selected._docId, { status: v })}
          >
            <SelectTrigger
              className="h-7 py-0 px-3 text-[10px] font-bold border rounded-full w-auto gap-1"
              style={{ backgroundColor: sc + '22', color: sc, borderColor: sc + '55' }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  if (view === 'new') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="border-white/20 gap-2 h-9 text-xs"
            onClick={() => setView('inbox')}>
            <ChevronLeftIcon size={13} /> Back
          </Button>
          <h2 className="text-base font-bold">New Submission</h2>
        </div>
        <Card className="border-white/10" style={{ borderColor: O + '33' }}>
          <CardContent className="p-4 space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Subject *</label>
              <Input className="bg-white/5 border-white/20 h-9 text-xs"
                placeholder="Brief summary"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Job (optional)</label>
              <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20 h-9 text-xs">
                  <SelectValue placeholder="No specific job" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No specific job</SelectItem>
                  {jobs.map(j => (
                    <SelectItem key={j.id} value={j.id}>{j.id} — {jobName(j)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Category</label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Priority</label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20 h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Message *</label>
              <Textarea className="bg-white/5 border-white/20 min-h-24 text-xs"
                placeholder="Describe in detail…"
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              />
            </div>
            <Button className="w-full h-9 text-white text-xs"
              style={{ backgroundColor: O }}
              disabled={submitting || !form.subject.trim() || !form.body.trim()}
              onClick={handleNew}>
              {submitting ? 'Submitting…' : 'Send to P2'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const openCount = myPortalSubmits.filter(s => s.status === 'Open' || !s.status).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">Submit / Inbox</h2>
          <p className="text-[11px] text-muted-foreground">{openCount} open · {myPortalSubmits.length} total</p>
        </div>
        <Button className="h-9 text-white text-xs gap-1.5"
          style={{ backgroundColor: O }}
          onClick={() => setView('new')}>
          <PlusIcon size={13} /> New
        </Button>
      </div>

      {myPortalSubmits.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquareIcon size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-xs mb-3">No submissions yet</p>
          <Button className="text-white text-xs h-9" style={{ backgroundColor: O }}
            onClick={() => setView('new')}>
            Create First Submission
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {myPortalSubmits.map(s => {
            const pc = priorityColor[s.priority] || '#6b7280'
            const sc = statusColor[s.status || 'Open']
            return (
              <button
                key={s._docId}
                className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors"
                onClick={() => { setSelectedId(s._docId); setView('thread') }}
              >
                <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: O + '22' }}>
                  <MessageSquareIcon size={12} style={{ color: O }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-semibold truncate">{s.subject}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded-full"
                      style={{ backgroundColor: pc + '22', color: pc }}>{s.priority}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {s.category} · {s.jobId || 'general'} · {fmtDate(s.createdAt)}
                  </p>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: sc + '22', color: sc }}>
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

// ── Notifications view ───────────────────────────────────────────────────────

function QBSNotifications({ notifs }) {
  const typeIcon  = { error: AlertCircleIcon, warn: AlertTriangleIcon, info: InfoIcon, success: CheckCircleIcon }
  const typeColor = { error: '#ef4444', warn: '#eab308', info: '#3b82f6', success: '#22c55e' }
  const unreadCount = notifs.filter(n => !n.read).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold">Notifications</h2>
        <p className="text-[11px] text-muted-foreground">{unreadCount} unread · {notifs.length} total</p>
      </div>
      {notifs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <BellIcon size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-xs">No notifications</p>
        </div>
      )}
      <div className="space-y-2">
        {notifs.map((n, i) => {
          const Icon = typeIcon[n.type] || InfoIcon
          const color = typeColor[n.type] || '#6b7280'
          return (
            <button
              key={n._docId || n.id || i}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-all ${n.read ? 'border-white/5 opacity-60' : 'border-white/15 bg-white/5'}`}
              onClick={() => n._docId && !n.read && updateNotification(n._docId, { read: true })}
            >
              <div className="p-1.5 rounded-lg shrink-0" style={{ backgroundColor: color + '22' }}>
                <Icon size={12} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-snug ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.msg}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {n.time || fmtDate(n.createdAt)}
                </p>
              </div>
              {!n.read && <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ backgroundColor: O }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Portal ──────────────────────────────────────────────────────────────

export default function QBSBuilderPortal({ tenantName = 'QBS', userName = '', onLogout }) {
  const { jobs, extras, notifs } = useData()

  // Read URL param for initial qbsPM (?qbsPM=Taylor%20Hensley)
  const urlPM = useMemo(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('qbsPM') || null
  }, [])

  // Build list of QBS PMs from job data
  const allPMs = useMemo(() => {
    const set = new Set()
    jobs.forEach(j => { if (j.qbsPM) set.add(j.qbsPM) })
    return ['__ALL__', ...Array.from(set).sort()]
  }, [jobs])

  // Auto-select PM by user displayName match, fall back to URL param, then __ALL__
  const initialPM = useMemo(() => {
    if (urlPM && allPMs.includes(urlPM)) return urlPM
    if (userName) {
      const match = allPMs.find(p => p.toLowerCase() === userName.toLowerCase())
      if (match) return match
    }
    return '__ALL__'
  }, [urlPM, userName, allPMs])

  const [selectedPM, setSelectedPM] = useState(initialPM)
  const [activeTab, setActiveTab] = useState('jobs')

  useEffect(() => {
    if (initialPM && initialPM !== selectedPM && selectedPM === '__ALL__' && allPMs.includes(initialPM)) {
      setSelectedPM(initialPM)
    }
  }, [initialPM]) // eslint-disable-line

  // Filter jobs by selected QBS PM
  const myJobs = useMemo(() => {
    if (selectedPM === '__ALL__') return jobs
    return jobs.filter(j => j.qbsPM === selectedPM)
  }, [jobs, selectedPM])

  const myJobIds = useMemo(() => new Set(myJobs.map(j => j.id)), [myJobs])
  const myExtras = useMemo(() => extras.filter(e => myJobIds.has(e.job)), [extras, myJobIds])

  const activeJobs = myJobs.filter(j => !['complete', 'completed'].includes(j.status))
  const completedJobs = myJobs.filter(j => ['complete', 'completed'].includes(j.status))
  const pendingExtras = myExtras.filter(e => e.status === 'pending')
  const pendingValue = pendingExtras.reduce((s, e) => s + (e.amount || 0), 0)
  const failedInsp = activeJobs.filter(j => {
    const ph = getJobInspectionTimeline(j)
    return ph.some(p => p.status === 'failed')
  })
  const unreadNotifs = notifs.filter(n => !n.read).length

  const TABS = [
    { id: 'jobs',          label: 'Jobs',          Icon: ClipboardIcon, count: 0 },
    { id: 'extras',        label: 'Extras',        Icon: PlusIcon,      count: pendingExtras.length },
    { id: 'submit',        label: 'Submit',        Icon: SendIcon,      count: 0 },
    { id: 'notifications', label: 'Alerts',        Icon: BellIcon,      count: unreadNotifs },
  ]

  return (
    <div className="dark min-h-screen bg-background flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="px-3 sm:px-6 py-3 flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: O }}>
            <Building2Icon size={16} color="#fff" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-none truncate">{tenantName}</p>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Builder Portal</p>
          </div>
          {onLogout && (
            <Button
              variant="outline"
              className="border-white/20 h-8 w-8 p-0 sm:w-auto sm:px-3 gap-1.5 shrink-0"
              onClick={onLogout}
            >
              <LogOutIcon size={13} />
              <span className="hidden sm:inline text-xs">Sign Out</span>
            </Button>
          )}
        </div>

        {/* PM selector + stats row */}
        <div className="px-3 sm:px-6 pb-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <Select value={selectedPM} onValueChange={setSelectedPM}>
            <SelectTrigger className="bg-white/5 border-white/20 h-9 text-xs w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allPMs.map(p => (
                <SelectItem key={p} value={p}>{p === '__ALL__' ? 'All QBS Jobs' : p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <StatPill label="Active" value={activeJobs.length} color={O} />
            <StatPill label="Pending COs" value={pendingExtras.length} sub={fmt$(pendingValue)} color="#eab308" />
            <StatPill label="Failed Insp" value={failedInsp.length} color="#ef4444" />
            <StatPill label="Done" value={completedJobs.length} color="#22c55e" />
          </div>
        </div>
      </header>

      {/* Desktop tabs */}
      <div className="hidden sm:flex border-b border-white/10 px-6 gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors shrink-0"
            style={{
              borderColor: activeTab === t.id ? O : 'transparent',
              color: activeTab === t.id ? O : '#9ca3af',
            }}
          >
            <t.Icon size={14} />
            {t.label}
            {t.count > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: O + '22', color: O }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="flex-1 px-3 sm:px-6 py-4 pb-24 sm:pb-6 space-y-4 max-w-3xl w-full mx-auto">
        {activeTab === 'jobs' && (
          <>
            {activeJobs.length === 0 && completedJobs.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <HomeIcon size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">No jobs assigned</p>
                <p className="text-[11px] mt-1">
                  {selectedPM === '__ALL__' ? 'No QBS jobs in the system' : `No jobs assigned to ${selectedPM}`}
                </p>
              </div>
            ) : (
              <>
                {activeJobs.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Active Jobs ({activeJobs.length})
                    </h2>
                    {activeJobs.map(j => (
                      <JobCard key={j._docId || j.id} job={j} extras={myExtras} />
                    ))}
                  </div>
                )}
                {completedJobs.length > 0 && (
                  <div className="space-y-3 pt-4">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Completed ({completedJobs.length})
                    </h2>
                    {completedJobs.map(j => (
                      <JobCard key={j._docId || j.id} job={j} extras={myExtras} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'extras' && (
          <ExtrasTab extras={myExtras} jobs={myJobs} />
        )}

        {activeTab === 'submit' && (
          <QBSSubmit qbsPM={selectedPM === '__ALL__' ? userName : selectedPM} jobs={myJobs} />
        )}

        {activeTab === 'notifications' && (
          <QBSNotifications notifs={notifs} />
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-white/10">
        <div className="grid grid-cols-4">
          {TABS.map(t => {
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="flex flex-col items-center justify-center gap-0.5 py-2.5 relative"
                style={{ color: active ? O : '#9ca3af' }}
              >
                <t.Icon size={18} />
                <span className="text-[10px] font-semibold">{t.label}</span>
                {t.count > 0 && (
                  <span
                    className="absolute top-1 right-[28%] text-[8px] font-bold px-1 py-0 rounded-full min-w-3 h-3 flex items-center justify-center"
                    style={{ backgroundColor: O, color: '#fff' }}
                  >
                    {t.count}
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

function StatPill({ label, value, sub, color }) {
  return (
    <div
      className="rounded-lg border px-2.5 py-1.5 shrink-0"
      style={{ borderColor: color + '33', backgroundColor: color + '11' }}
    >
      <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color }}>{label}</p>
      <div className="flex items-baseline gap-1">
        <p className="text-sm font-bold leading-none">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground leading-none">{sub}</p>}
      </div>
    </div>
  )
}

// ── Extras Tab (full list with grouping) ─────────────────────────────────────

function ExtrasTab({ extras, jobs }) {
  const [filter, setFilter] = useState('pending')

  const filtered = useMemo(() => {
    if (filter === 'all') return extras
    return extras.filter(e => e.status === filter)
  }, [extras, filter])

  // Group by job
  const byJob = useMemo(() => {
    const map = new Map()
    filtered.forEach(co => {
      if (!map.has(co.job)) map.set(co.job, [])
      map.get(co.job).push(co)
    })
    return Array.from(map.entries())
  }, [filtered])

  const totals = {
    pending: extras.filter(e => e.status === 'pending').reduce((s, e) => s + (e.amount || 0), 0),
    approved: extras.filter(e => e.status === 'approved').reduce((s, e) => s + (e.amount || 0), 0),
    rejected: extras.filter(e => e.status === 'rejected').reduce((s, e) => s + (e.amount || 0), 0),
  }

  const FILTERS = [
    { id: 'pending', label: 'Pending', color: '#eab308', count: extras.filter(e => e.status === 'pending').length },
    { id: 'approved', label: 'Approved', color: '#22c55e', count: extras.filter(e => e.status === 'approved').length },
    { id: 'rejected', label: 'Rejected', color: '#ef4444', count: extras.filter(e => e.status === 'rejected').length },
    { id: 'all', label: 'All', color: O, count: extras.length },
  ]

  const jobLookup = (jobId) => jobs.find(j => j.id === jobId)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold">Change Orders</h2>
        <p className="text-[11px] text-muted-foreground">
          Pending {fmt$(totals.pending)} · Approved {fmt$(totals.approved)}
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        {FILTERS.map(f => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors"
              style={{
                borderColor: active ? f.color : '#ffffff15',
                backgroundColor: active ? f.color + '22' : 'transparent',
                color: active ? f.color : '#9ca3af',
              }}
            >
              {f.label} {f.count > 0 && <span className="opacity-60">· {f.count}</span>}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <PlusIcon size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-xs">No {filter === 'all' ? '' : filter} change orders</p>
        </div>
      )}

      {byJob.map(([jobId, list]) => {
        const job = jobLookup(jobId)
        return (
          <Card key={jobId} className="border-white/10">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-sm" style={{ color: O }}>{job ? jobName(job) : jobId}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{jobId}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">{list.length} CO{list.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="space-y-2">
                {list.map(co => (
                  <ExtraRow key={co._docId || co.id} co={co} />
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
