import { useState, useMemo } from 'react'
import { useData } from '../use-data'
import {
  approveExtra, rejectExtra, addSubmit, updateSubmit,
  useSubmitReplies, addSubmitReply, updateNotification,
} from '../hooks/useFirestore'
import { extraState } from '../lib/extraStatus'
import { daysSince, toDate } from '../lib/dates'
import { useNow } from '../hooks/useNow'
import { useMutation } from '../hooks/useMutation'
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
  CheckCircleIcon, ClockIcon, MapPinIcon, LogOutIcon,
  InfoIcon, HomeIcon,
  // Phase 6 — preferred lucide names for builder-facing surface
  ActivityIcon, GaugeIcon, FilePenLineIcon, BadgeCheckIcon,
  TriangleAlertIcon, ReceiptIcon, UserCheckIcon,
} from 'lucide-react'
import Brand from './brand/Brand'
import {
  DataPanel,
  Pill,
  EmptyState,
  AllClearState,
} from './shared'
import { BRAND, withAlpha, SEMANTIC, TONE_FOREGROUND } from '@/lib/tokens'
import {
  CO_STATUS, INSPECTION_STATUS, PHASE,
  normalizeCoStatus, statusColor, statusLabel, statusTone, toneHex, toneText,
} from '../lib/status'

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (n) => `$${Number(n || 0).toLocaleString()}`
const jobName = (j) => j.name || (j.client || '').split(' ')[0] || j.id

const fmtDate = (d) => {
  if (!d) return ''
  try {
    const dt = toDate(d)
    if (!dt) return ''
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '' }
}

// ── Inspection phase aggregation ─────────────────────────────────────────────

// The icon of each phase result. Its words and color are in status.js.
const PHASE_ICON = {
  passed:        CheckCircleIcon,
  failed:        XIcon,
  pending:       ClockIcon,
  scheduled:     ClockIcon,
  'not-started': ClockIcon,
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
    { key: 'roughIn',        label: statusLabel(PHASE, 'rough-in'),        ...aggregatePhaseStatus(job.insp, 'roughIn') },
    { key: 'serviceRelease', label: statusLabel(PHASE, 'service-release'), ...getServiceReleaseStatus(job) },
    { key: 'final',          label: statusLabel(PHASE, 'final'),           ...aggregatePhaseStatus(job.insp, 'final') },
  ]
}

// ── Inspection Timeline component ────────────────────────────────────────────

function InspectionTimeline({ job }) {
  const phases = getJobInspectionTimeline(job)
  return (
    <div className="flex items-stretch gap-1 sm:gap-2">
      {phases.map((p, i) => {
        const color = statusColor(INSPECTION_STATUS, p.status)
        const Icon = PHASE_ICON[p.status]
        return (
          <div key={p.key} className="flex items-stretch flex-1 min-w-0">
            <div
              className="flex flex-col items-center text-center gap-1 px-2 py-2 rounded-lg flex-1 border min-w-0"
              style={{
                backgroundColor: withAlpha(color, 0.13),
                borderColor: withAlpha(color, 0.33),
              }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ backgroundColor: withAlpha(color, 0.2) }}
              >
                <Icon size={14} style={{ color }} />
              </div>
              <p className="text-[10px] sm:text-xs font-bold leading-tight truncate w-full" style={{ color: toneText(statusTone(INSPECTION_STATUS, p.status)) }}>
                {p.label}
              </p>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground leading-tight">
                {p.status === 'passed' && p.date ? fmtDate(p.date) : statusLabel(INSPECTION_STATUS, p.status)}
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

// One mark of the per trade pills, for one phase of one trade. A result that is in
// gets its letter in a circle of the status color: P passed, F failed, S
// scheduled, B blocked. A result not in yet (pending, pending verification, not
// started) gets a dot in a circle. A phase that does not apply is plain text, n/a,
// with no circle. What a mark means is in its letter or its words, never in its
// color alone, and a letter or a dot is a picture named by the words of its status,
// which a pointer shows as a title. The letters are 8 pixels, so they are in the
// text color of the tone (toneText): a result not in yet is in the neutral gray,
// never the dimmer mute.
const INSPECTION_LETTER = { passed: 'P', failed: 'F', scheduled: 'S', blocked: 'B' }

function InspectionMark({ status }) {
  const color = statusColor(INSPECTION_STATUS, status)
  const text = toneText(statusTone(INSPECTION_STATUS, status))
  if (status === 'n/a') {
    return (
      <span className="min-w-3.5 h-3.5 text-[8px] flex items-center justify-center font-black" style={{ color: text }}>
        n/a
      </span>
    )
  }
  const words = statusLabel(INSPECTION_STATUS, status)
  return (
    <span role="img" aria-label={words} title={words}
      className="w-3.5 h-3.5 rounded-full text-[8px] flex items-center justify-center font-black"
      style={{ backgroundColor: withAlpha(color, 0.2), color: text }}>
      {INSPECTION_LETTER[status] ?? '·'}
    </span>
  )
}

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

  return (
    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
      {rows.map(r => (
        <div key={r.trade} className="rounded-lg bg-white/5 border border-white/10 p-1.5">
          <p className="font-bold capitalize text-[10px] mb-1 text-muted-foreground">{r.trade}</p>
          <div className="flex items-center gap-1">
            <InspectionMark status={r.roughIn} />
            <span className="text-muted-foreground">R</span>
            <span className="text-muted-foreground/40 mx-0.5">·</span>
            <InspectionMark status={r.final} />
            <span className="text-muted-foreground">F</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Job Card ─────────────────────────────────────────────────────────────────

// Builder-facing project status. Maps internal status enums to a single,
// trustworthy phrase that a GC or developer would expect to read.
function builderStatus(job) {
  const isComplete = ['complete', 'completed'].includes(job.status)
  if (isComplete)                  return { tone: 'success',  text: 'Complete',         color: SEMANTIC.success }
  if (job.status === 'blocked')    return { tone: 'critical', text: 'Needs attention',  color: SEMANTIC.critical }
  if (job.status === 'at-risk')    return { tone: 'warning',  text: 'Watch list',       color: SEMANTIC.warning }
  if (job.status === 'needs-action') return { tone: 'warning', text: 'Action needed',   color: SEMANTIC.warning }
  return                           { tone: 'success', text: 'Project on track', color: BRAND }
}

// Read the inspection timeline and produce a "next milestone" sentence —
// purely UI-side derivation, no schema changes.
function nextMilestoneFor(job) {
  const phases = getJobInspectionTimeline(job)
  // Find the first non-passed phase in order rough-in → service release → final.
  const next = phases.find(p => p.status !== 'passed' && p.status !== 'not-started')
  if (next) {
    if (next.status === 'failed')    return `${next.label} — needs rework`
    if (next.status === 'scheduled') return `${next.label} — inspection scheduled`
    if (next.status === 'pending')   return `${next.label} — awaiting verification`
  }
  const notStarted = phases.find(p => p.status === 'not-started')
  if (notStarted) return `${notStarted.label} — not yet scheduled`
  if (phases.every(p => p.status === 'passed')) return 'All inspections complete'
  return 'In progress'
}

function JobCard({ job, extras, now }) {
  const [expanded, setExpanded] = useState(false)
  const jobExtras = extras.filter(e => e.job === job.id)
  const approvedTotal = jobExtras.filter(e => extraState(e) === 'approved').reduce((s, e) => s + (e.amount || 0), 0)
  const pendingTotal  = jobExtras.filter(e => extraState(e) === 'pending').reduce((s, e) => s + (e.amount || 0), 0)
  const pendingCount  = jobExtras.filter(e => extraState(e) === 'pending').length

  const phaseLabel = (job.phase || 'unknown').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const daysInPhase = daysSince(job.lastStatusChange, now)
  const milestone = nextMilestoneFor(job)
  const status = builderStatus(job)
  const hasInvoice = Boolean(job.invoiceNum && job.invoiceDate)

  return (
    <article
      className="rounded-xl border border-white/10 bg-white/[0.025] overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: status.color }}
    >
      {/* Header */}
      <header className="px-4 sm:px-5 pt-4 pb-3 border-b border-white/5">
        {pendingCount > 0 && (
          <div
            className="inline-flex items-center gap-1.5 mb-2.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
            style={{ backgroundColor: withAlpha(SEMANTIC.warning, 0.13), color: SEMANTIC.warning, border: `1px solid ${withAlpha(SEMANTIC.warning, 0.27)}` }}
          >
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
                <span className="truncate">{job.address}</span>
              </p>
            )}
          </div>
          <Pill tone={status.tone} size="xs">{status.text}</Pill>
        </div>

        {/* Next milestone */}
        <div className="mt-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Next milestone</p>
          <p className="text-sm font-semibold text-zinc-100 leading-snug mt-0.5">{milestone}</p>
        </div>

        {/* Phase + permit + P2 contact */}
        <div className="grid grid-cols-2 gap-2 mt-2.5 text-[11px]">
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
            <p className="text-zinc-400 text-[10px] uppercase tracking-wide font-bold">Current Phase</p>
            <p className="font-semibold text-zinc-100 truncate">{phaseLabel}</p>
            {daysInPhase != null && (
              <p className="text-[10px] text-zinc-400">{daysInPhase}d in phase</p>
            )}
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2">
            <p className="text-zinc-400 text-[10px] uppercase tracking-wide font-bold">P2 Contact</p>
            <p className="font-semibold text-zinc-100 truncate">{job.pm || 'TBD'}</p>
            {job.lead && (
              <p className="text-[10px] text-zinc-400 truncate">Lead: {job.lead}</p>
            )}
          </div>
        </div>
      </header>

      {/* Inspection Timeline */}
      <section className="px-4 sm:px-5 py-4 border-b border-white/5">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-2.5">Inspection Timeline</p>
        <InspectionTimeline job={job} />
      </section>

      {/* Per-trade inspections */}
      {job.insp && (
        <section className="px-4 sm:px-5 py-4 border-b border-white/5">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-2.5">Per-Trade Status</p>
          <TradeInspectionPills insp={job.insp} />
        </section>
      )}

      {/* Invoice / pay-application visibility */}
      {(hasInvoice || job.billingStatus) && (
        <section className="px-4 sm:px-5 py-3 border-b border-white/5 flex items-center gap-3">
          <div
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 32, height: 32, backgroundColor: withAlpha(SEMANTIC.info, 0.13), color: SEMANTIC.info }}
          >
            <ReceiptIcon size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Pay application</p>
            <p className="text-sm font-semibold text-zinc-100 truncate">
              {job.billingStatus === 'paid'
                ? 'Paid'
                : job.billingStatus === 'invoiced'
                  ? `Invoice ${job.invoiceNum || ''} submitted${job.invoiceDate ? ` · ${job.invoiceDate}` : ''}`
                  : job.billingStatus === 'partial-pay'
                    ? `Partial payment received · invoice ${job.invoiceNum || ''}`
                    : 'Pending milestone'}
            </p>
          </div>
        </section>
      )}

      {/* Change orders toggle + summary */}
      <button
        type="button"
        className="w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.04] transition-colors"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 text-left min-w-0">
          <div
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 32, height: 32, backgroundColor: withAlpha(BRAND, 0.13), color: BRAND }}
          >
            <FilePenLineIcon size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-100">Change Orders</p>
            <p className="text-[11px] text-zinc-400 truncate">
              {jobExtras.length === 0
                ? 'No change orders for this project'
                : pendingCount > 0
                  ? `${pendingCount} awaiting your approval`
                  : `${jobExtras.length} on file`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: SEMANTIC.warning }}>Pending</p>
              <p className="text-sm font-bold tabular-nums" style={{ color: SEMANTIC.warning }}>{fmt$(pendingTotal)}</p>
            </div>
          )}
          {approvedTotal > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: SEMANTIC.success }}>Approved</p>
              <p className="text-sm font-bold tabular-nums" style={{ color: SEMANTIC.success }}>{fmt$(approvedTotal)}</p>
            </div>
          )}
          <ChevronRightIcon
            size={16}
            className="text-zinc-400 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 sm:px-5 pb-4 pt-0 space-y-2">
          {jobExtras.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-3">
              No change orders submitted for this project.
            </p>
          ) : (
            jobExtras.map(co => (
              <ExtraRow key={co._docId || co.id} co={co} compact />
            ))
          )}
        </div>
      )}
    </article>
  )
}

// ── Extra Row (with approve/reject) ──────────────────────────────────────────

function ExtraRow({ co, compact = false }) {
  const { run, busy } = useMutation()
  const [showReject, setShowReject] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [errMsg, setErrMsg] = useState('')

  const state = extraState(co)
  const isPending = state === 'pending'
  // The total shown here is the one sent with a decision: the function refuses it
  // when the stored total has changed since.
  const total = co.total ?? co.amount ?? 0

  // The approval, the notification and the history entry are all written by the
  // Cloud Function, which also checks that this person may act on the change order.
  // A refusal is told in a toast and, since the buttons stay where they were, on the row.
  const handleApprove = async () => {
    if (!co._docId) {
      setErrMsg('This change order is missing an ID. Refresh and try again.')
      return
    }
    setErrMsg('')
    const { ok, error } = await run(() => approveExtra(co._docId, total), {
      success: `${co.id || 'The change order'} approved for ${fmt$(total)}.`,
      error: 'Could not save approval. Check your connection and try again.',
    })
    if (!ok) setErrMsg(error)
  }

  const handleReject = async () => {
    if (!co._docId || !rejectNotes.trim()) return
    setErrMsg('')
    const { ok, error } = await run(() => rejectExtra(co._docId, rejectNotes.trim(), total), {
      success: `Revision requested. P2 has been notified about ${co.id || 'this change order'}.`,
      error: 'Could not save rejection. Check your connection and try again.',
    })
    if (ok) {
      setShowReject(false)
      setRejectNotes('')
    } else {
      setErrMsg(error)
    }
  }

  // The pill says where the change order stands, in the words every screen uses.
  // What the builder is asked to do is said above it and on the buttons below.
  // One waiting for the builder reads as a warning here, because the decision is
  // theirs; every other screen shows it in the tone of the vocabulary.
  const coStatus = normalizeCoStatus(co.status)
  const stateLabel = statusLabel(CO_STATUS, coStatus)
  const stateTone = state === 'pending' ? 'warning' : statusTone(CO_STATUS, coStatus)

  return (
    <div
      className="rounded-xl border bg-white/[0.025] overflow-hidden"
      style={{
        borderColor: state === 'draft' ? 'rgba(255,255,255,0.10)' : withAlpha(toneHex(stateTone), 0.27),
      }}
    >
      <div className={compact ? 'p-3' : 'p-4'}>
        {isPending && (
          <p
            className="text-[10px] font-bold uppercase tracking-wider mb-2"
            style={{ color: SEMANTIC.warning }}
          >
            Awaiting your approval
          </p>
        )}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-bold" style={{ color: BRAND }}>{co.id || co.coNumber || '—'}</span>
              <Pill tone={stateTone} size="xs">{stateLabel}</Pill>
              {!compact && <span className="text-[10px] text-zinc-400">{co.job}</span>}
            </div>
            <p className="text-sm text-zinc-100 leading-snug">{co.desc || 'No description'}</p>
            {co.lineItems && Array.isArray(co.lineItems) && co.lineItems.length > 0 && (
              <ul className="mt-2 text-[11px] text-zinc-400 space-y-0.5">
                {co.lineItems.map((li, idx) => (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="truncate">· {li.desc}</span>
                    <span className="tabular-nums shrink-0">{fmt$(li.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {co.rejectNotes && state === 'rejected' && (
              <div className="mt-2.5 rounded-lg border border-red-500/30 px-3 py-2"
                style={{ backgroundColor: withAlpha(SEMANTIC.critical, 0.04) }}
              >
                <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: SEMANTIC.critical }}>
                  Reason for revision
                </p>
                <p className="text-[11px] text-zinc-200 italic">“{co.rejectNotes}”</p>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="font-semibold text-base tabular-nums" style={{ color: BRAND }}>{fmt$(total)}</p>
            <p className="text-[10px] text-zinc-400">{co.date || fmtDate(co.createdAt)}</p>
          </div>
        </div>

        {isPending && !showReject && (
          <>
            <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-400 mb-1.5 mt-3">
              Review change order
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1 h-10 text-xs gap-1.5 font-bold"
                style={{ backgroundColor: SEMANTIC.success, color: TONE_FOREGROUND.success }}
                disabled={busy}
                onClick={handleApprove}
              >
                <CheckIcon size={14} /> {busy ? 'Approving…' : 'Approve change order'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-10 text-xs gap-1.5 border-white/20 hover:bg-white/[0.05] text-zinc-200"
                disabled={busy}
                onClick={() => { setShowReject(true); setErrMsg('') }}
              >
                <XIcon size={14} /> Request revision
              </Button>
            </div>
            {errMsg && (
              <p className="mt-2 text-[11px] text-red-400 leading-tight">{errMsg}</p>
            )}
          </>
        )}

        {isPending && showReject && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-300">
              Tell P2 what needs to change
            </p>
            <Textarea
              className="bg-white/[0.04] border-white/20 text-xs text-zinc-100 min-h-20 placeholder:text-zinc-400"
              placeholder="What should be revised? (required)"
              maxLength={1000}
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 h-10 text-xs font-bold"
                style={{ backgroundColor: SEMANTIC.critical, color: TONE_FOREGROUND.critical }}
                disabled={busy || !rejectNotes.trim()}
                onClick={handleReject}
              >
                {busy ? 'Submitting…' : 'Send revision request'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-10 text-xs border-white/20 hover:bg-white/[0.05] text-zinc-200"
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

        {!isPending && state === 'approved' && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: SEMANTIC.success }}>
            <CheckCircleIcon size={12} /> Approved · ready to bill
          </div>
        )}
      </div>
    </div>
  )
}

// ── QBS Submit (RFI) ─────────────────────────────────────────────────────────

function QBSSubmit({ qbsPM, jobs }) {
  const { submits, scope } = useData()
  const { run: runSend, busy: submitting } = useMutation()
  const { run: runReply, busy: replying } = useMutation()
  const { run: runStatus } = useMutation()
  const [view, setView] = useState('inbox')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState({ subject: '', category: 'RFI', priority: 'Medium', body: '', jobId: '' })
  const [replyText, setReplyText] = useState('')

  const selected = submits.find(s => s._docId === selectedId) || null
  const { replies } = useSubmitReplies(selected?._docId)

  // Filter to QBS portal submits (relevant to this user's jobs)
  const myJobIds = new Set(jobs.map(j => j.id))
  const myPortalSubmits = submits.filter(s => s.portal === 'Builder' || s.portal === 'QBS' || (s.jobId && myJobIds.has(s.jobId)))

  const CATEGORIES = ['RFI', 'Issue', 'Question', 'Change Request', 'Approval', 'Other']
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
  const priorityColor = { Low: SEMANTIC.success, Medium: SEMANTIC.warning, High: BRAND, Critical: SEMANTIC.critical }
  const ticketColor = { Open: SEMANTIC.critical, 'In Progress': BRAND, Resolved: SEMANTIC.success }

  const handleNew = async () => {
    if (!form.subject.trim() || !form.body.trim()) return
    const { ok } = await runSend(() => addSubmit({
      subject: form.subject.trim(),
      category: form.category,
      priority: form.priority,
      body: form.body.trim(),
      portal: 'Builder',
      qbsPM: qbsPM || null,
      jobId: form.jobId || null,
      status: 'Open',
      // A builder may create a submission that carries their own tenant and
      // lists no client. It keeps that tenant: the stamping trigger gives it its
      // job's clients only when the job is in the same tenant.
      tenantId: scope.tenantId,
      clientUids: [],
    }), {
      success: 'Message sent to P2.',
      error: 'Could not send your message. Try again.',
      queue: true,
    })
    // A refused message leaves the form ready to send again.
    if (ok) {
      setForm({ subject: '', category: 'RFI', priority: 'Medium', body: '', jobId: '' })
      setView('inbox')
    }
  }

  // A reply is two writes: the reply, and then moving an open message to In Progress. The
  // box is cleared once the reply is in, and the second write says so on its own if it fails.
  const handleReply = async () => {
    if (!replyText.trim() || !selected?._docId) return
    const { ok } = await runReply(() => addSubmitReply(selected._docId, {
      body: replyText.trim(),
      author: qbsPM || 'QBS Coordinator',
      authorRole: 'builder',
    }), {
      success: 'Reply sent.',
      error: 'Could not send your reply. Try again.',
      queue: true,
    })
    if (!ok) return
    setReplyText('')
    if (selected.status === 'Open') {
      await runReply(() => updateSubmit(selected._docId, { status: 'In Progress' }), {
        error: 'The reply was sent, but the message did not move to In Progress.',
        queue: true,
      })
    }
  }

  if (view === 'thread' && selected) {
    const sc = ticketColor[selected.status || 'Open']
    const pc = priorityColor[selected.priority] || SEMANTIC.mute
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
            <h2 className="text-base font-bold text-white truncate">{selected.subject}</h2>
            <p className="text-[11px] text-zinc-400">
              {selected.category} · {selected.jobId || 'No job'} · {fmtDate(selected.createdAt)}
            </p>
          </div>
        </div>

        <Card className="border-white/10">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ backgroundColor: withAlpha(BRAND, 0.2), color: BRAND }}>QB</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold">{selected.qbsPM || 'QBS'}</span>
                  <span className="text-[10px] text-muted-foreground">{fmtDate(selected.createdAt)}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-auto"
                    style={{ backgroundColor: withAlpha(pc, 0.13), color: pc }}>{selected.priority}</span>
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
                    backgroundColor: r.authorRole === 'internal' ? withAlpha(SEMANTIC.info, 0.13) : withAlpha(SEMANTIC.success, 0.13),
                    color: r.authorRole === 'internal' ? SEMANTIC.info : SEMANTIC.success,
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
              variant="brand"
              className="w-full h-9 text-xs gap-1.5"
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
            onValueChange={v => selected._docId && runStatus(() => updateSubmit(selected._docId, { status: v }), {
              success: `Status set to ${v.toLowerCase()}.`,
              error: 'Could not change the status. Try again.',
              queue: true,
            })}
          >
            <SelectTrigger
              aria-label="Status"
              className="h-7 py-0 px-3 text-[10px] font-bold border rounded-full w-auto gap-1"
              style={{ backgroundColor: withAlpha(sc, 0.13), color: sc, borderColor: withAlpha(sc, 0.33) }}
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
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>
              Contact P2
            </p>
            <h2 className="text-lg font-semibold tracking-tight text-white mt-0.5">New message</h2>
          </div>
        </div>
        <Card className="border-white/10" style={{ borderColor: withAlpha(BRAND, 0.2) }}>
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
                <SelectTrigger aria-label="Job (optional)" className="bg-white/5 border-white/20 h-9 text-xs">
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
                  <SelectTrigger aria-label="Category" className="bg-white/5 border-white/20 h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">Priority</label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger aria-label="Priority" className="bg-white/5 border-white/20 h-9 text-xs"><SelectValue /></SelectTrigger>
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
            <Button variant="brand" className="w-full h-9 text-xs"
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
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>
            Contact P2
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Messages & RFIs</h2>
          <p className="text-xs text-zinc-400 mt-1">
            {openCount} open · {myPortalSubmits.length} total
          </p>
        </div>
        <Button
          variant="brand"
          className="h-9 text-xs gap-1.5 font-bold shrink-0"
          onClick={() => setView('new')}
        >
          <PlusIcon size={13} /> New message
        </Button>
      </div>

      {myPortalSubmits.length === 0 ? (
        <EmptyState
          Icon={MessageSquareIcon}
          title="No messages yet"
          description="Send your P2 contact an RFI, question, or change request and the thread appears here."
          action={
            <Button
              variant="brand"
              className="text-xs h-9 font-bold gap-1.5"
              onClick={() => setView('new')}
            >
              <PlusIcon size={13} /> Create first message
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {myPortalSubmits.map(s => {
            const pc = priorityColor[s.priority] || SEMANTIC.mute
            const sc = ticketColor[s.status || 'Open']
            return (
              <button
                type="button"
                key={s._docId}
                className="w-full text-left flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/25 transition-colors"
                onClick={() => { setSelectedId(s._docId); setView('thread') }}
              >
                <div className="shrink-0 flex items-center justify-center rounded-lg"
                  style={{ width: 32, height: 32, backgroundColor: withAlpha(BRAND, 0.13), color: BRAND }}
                >
                  <MessageSquareIcon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-100 truncate">{s.subject}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                      style={{ backgroundColor: withAlpha(pc, 0.13), color: pc, border: `1px solid ${withAlpha(pc, 0.27)}` }}
                    >
                      {s.priority}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {s.category} · {s.jobId || 'general'} · {fmtDate(s.createdAt)}
                  </p>
                </div>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
                  style={{ backgroundColor: withAlpha(sc, 0.13), color: sc, border: `1px solid ${withAlpha(sc, 0.27)}` }}
                >
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
  const { run } = useMutation()
  const typeIcon  = { error: AlertCircleIcon, warn: TriangleAlertIcon, info: InfoIcon, success: CheckCircleIcon }
  const typeColor = { error: SEMANTIC.critical, warn: SEMANTIC.warning, info: SEMANTIC.info, success: SEMANTIC.success }
  const unreadCount = notifs.filter(n => !n.read).length

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>
          Project updates
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-white mt-1">All updates</h2>
        <p className="text-xs text-zinc-400 mt-1">
          {unreadCount} unread · {notifs.length} total
        </p>
      </div>
      {notifs.length === 0 ? (
        <EmptyState
          Icon={BellIcon}
          title="No project updates"
          description="You'll see updates here when activity happens on your projects — invoice submissions, inspection results, change-order responses."
        />
      ) : (
        <div className="space-y-2">
          {notifs.map((n, i) => {
            const Icon = typeIcon[n.type] || InfoIcon
            const color = typeColor[n.type] || SEMANTIC.neutral
            return (
              <button
                type="button"
                key={n._docId || n.id || i}
                className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  n.read
                    ? 'border-white/5 bg-transparent'
                    : 'border-white/15 bg-white/[0.04]'
                }`}
                onClick={() => n._docId && !n.read && run(() => updateNotification(n._docId, { read: true }), {
                  error: 'Could not mark the update read. Try again.',
                  queue: true,
                })}
              >
                <div
                  className="shrink-0 flex items-center justify-center rounded-lg"
                  style={{ width: 30, height: 30, backgroundColor: withAlpha(color, 0.13), color }}
                >
                  <Icon size={14} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${n.read ? 'text-zinc-300' : 'text-zinc-100 font-semibold'}`}>
                    {n.msg}
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {n.time || fmtDate(n.createdAt)}
                  </p>
                </div>
                {!n.read && <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ backgroundColor: BRAND }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Portal ──────────────────────────────────────────────────────────────

export default function QBSBuilderPortal({ tenantName = 'QBS', userName = '', onLogout }) {
  const { jobs, extras, notifs, loading } = useData()
  const now = useNow()

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

  // Derived selection: a manual override wins, otherwise use the URL/PM
  // resolution. This avoids a setState-in-effect rehydration when the jobs
  // feed lands and `initialPM` recomputes — the value just flows through.
  const [pmOverride, setPmOverride] = useState(null)
  const selectedPM = pmOverride ?? initialPM
  const setSelectedPM = setPmOverride
  const [activeTab, setActiveTab] = useState('jobs')

  // Filter jobs by selected QBS PM
  const myJobs = useMemo(() => {
    if (selectedPM === '__ALL__') return jobs
    return jobs.filter(j => j.qbsPM === selectedPM)
  }, [jobs, selectedPM])

  const myJobIds = useMemo(() => new Set(myJobs.map(j => j.id)), [myJobs])
  // A draft has not been sent to the builder yet, so it never shows here.
  const myExtras = useMemo(() => extras.filter(e => myJobIds.has(e.job) && extraState(e) !== 'draft'), [extras, myJobIds])

  const activeJobs = myJobs.filter(j => !['complete', 'completed'].includes(j.status))
  const completedJobs = myJobs.filter(j => ['complete', 'completed'].includes(j.status))
  const pendingExtras = myExtras.filter(e => extraState(e) === 'pending')
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

  // Aggregate "this project is on track" pulse for the Project Overview block.
  const onTrackJobs = activeJobs.filter(j => {
    const s = j.status
    if (s === 'blocked' || s === 'at-risk' || s === 'needs-action') return false
    if (failedInsp.some(fj => fj.id === j.id)) return false
    return true
  })
  const projectsOnTrack = onTrackJobs.length === activeJobs.length && activeJobs.length > 0

  if (loading && jobs.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full border-2 animate-spin" style={{ borderColor: withAlpha(BRAND, 0.2), borderTopColor: BRAND }} />
          <p className="text-sm text-muted-foreground">Loading your projects…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Sticky header — brand + tenant + PM selector */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="px-4 sm:px-8 pt-4 pb-3 flex items-center gap-3 sm:gap-4">
          <Brand size={32} tone="light" className="shrink-0" />
          <div className="hidden sm:block w-px h-7 bg-white/10" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>
              Builder Portal
            </p>
            <p className="font-bold text-base text-white leading-tight truncate mt-0.5">{tenantName}</p>
          </div>
          {onLogout && (
            <Button
              aria-label="Sign out"
              variant="outline"
              className="border-white/15 h-9 w-9 p-0 sm:w-auto sm:px-3 gap-1.5 shrink-0 hover:bg-white/[0.05] text-zinc-200"
              onClick={onLogout}
            >
              <LogOutIcon size={13} aria-hidden="true" />
              <span className="hidden sm:inline text-xs">Sign out</span>
            </Button>
          )}
        </div>

        {/* PM selector + stat tiles */}
        <div className="px-4 sm:px-8 pb-4 grid gap-3 sm:grid-cols-[260px_1fr]">
          <Select value={selectedPM} onValueChange={setSelectedPM}>
            <SelectTrigger aria-label="Show project manager" className="bg-white/[0.04] border-white/10 text-zinc-100 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allPMs.map(p => (
                <SelectItem key={p} value={p}>{p === '__ALL__' ? 'All QBS projects' : p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}
          >
            <PortalStat label="Active"           value={activeJobs.length}      Icon={ActivityIcon}     accent={BRAND} />
            <PortalStat label="Pending approval" value={pendingExtras.length}   Icon={FilePenLineIcon}  accent={SEMANTIC.warning} sub={fmt$(pendingValue)} />
            <PortalStat label="Inspection issue" value={failedInsp.length}      Icon={TriangleAlertIcon} accent={failedInsp.length > 0 ? SEMANTIC.critical : SEMANTIC.neutral} />
            <PortalStat label="Completed"        value={completedJobs.length}   Icon={BadgeCheckIcon}    accent={SEMANTIC.success} />
          </div>
        </div>
      </header>

      {/* Desktop tabs */}
      <div className="hidden sm:flex border-b border-white/10 px-8 gap-1 overflow-x-auto">
        {TABS.map(t => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-colors shrink-0"
              style={{
                borderColor: active ? BRAND : 'transparent',
                color: active ? BRAND : SEMANTIC.neutral,
              }}
            >
              <t.Icon size={14} strokeWidth={active ? 2.25 : 2} />
              {t.label}
              {t.count > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{ backgroundColor: withAlpha(BRAND, 0.13), color: BRAND }}
                >
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <main className="flex-1 px-4 sm:px-8 py-5 pb-28 sm:pb-8 space-y-5 max-w-3xl w-full mx-auto">
        {activeTab === 'jobs' && (
          <>
            {activeJobs.length === 0 && completedJobs.length === 0 ? (
              <EmptyState
                Icon={HomeIcon}
                title="No projects yet"
                description={selectedPM === '__ALL__'
                  ? 'No projects are linked to your account yet. Contact P2 if you expected to see one here.'
                  : `No projects are currently assigned to ${selectedPM}.`}
              />
            ) : (
              <>
                {/* Project Overview */}
                {activeJobs.length > 0 && (
                  <DataPanel
                    title="Project overview"
                    description={
                      pendingExtras.length > 0
                        ? `${pendingExtras.length} change order${pendingExtras.length === 1 ? '' : 's'} awaiting your approval`
                        : projectsOnTrack
                          ? 'All your active projects are on track'
                          : `${activeJobs.length} active project${activeJobs.length === 1 ? '' : 's'}`
                    }
                    Icon={GaugeIcon}
                    badge={
                      pendingExtras.length > 0
                        ? <Pill tone="warning" size="xs">Action needed</Pill>
                        : projectsOnTrack
                          ? <Pill tone="success" size="xs">On track</Pill>
                          : null
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      <OverviewMetric
                        label="Active projects"
                        value={activeJobs.length}
                        sub={`${onTrackJobs.length} on track`}
                        Icon={ActivityIcon}
                      />
                      <OverviewMetric
                        label="Awaiting your approval"
                        value={pendingExtras.length}
                        sub={pendingExtras.length > 0 ? fmt$(pendingValue) : 'No approvals pending'}
                        Icon={FilePenLineIcon}
                        emphasis={pendingExtras.length > 0 ? 'warning' : 'success'}
                      />
                      <OverviewMetric
                        label="P2 contact"
                        value={selectedPM === '__ALL__'
                          ? '—'
                          : (myJobs[0]?.pm || 'TBD')}
                        sub={selectedPM === '__ALL__' ? 'Filter to a project for owner' : 'Your project lead'}
                        Icon={UserCheckIcon}
                        valueClass="text-base"
                      />
                    </div>
                  </DataPanel>
                )}

                {/* Pending approvals quick block */}
                {pendingExtras.length > 0 && (
                  <DataPanel
                    title="Awaiting your approval"
                    description="Review and approve change orders before work begins."
                    Icon={FilePenLineIcon}
                    badge={<Pill tone="warning" size="xs">{pendingExtras.length}</Pill>}
                  >
                    <div className="space-y-2">
                      {pendingExtras.slice(0, 4).map(co => (
                        <ExtraRow key={co._docId || co.id} co={co} />
                      ))}
                      {pendingExtras.length > 4 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('extras')}
                          className="w-full text-center text-[11px] font-semibold py-2 transition-colors"
                          style={{ color: BRAND }}
                        >
                          View all {pendingExtras.length} pending approvals →
                        </button>
                      )}
                    </div>
                  </DataPanel>
                )}

                {/* Active projects */}
                {activeJobs.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>
                        Active projects
                      </h2>
                      <Pill tone="brand" size="xs">{activeJobs.length}</Pill>
                    </div>
                    {activeJobs.map(j => (
                      <JobCard key={j._docId || j.id} job={j} extras={myExtras} now={now} />
                    ))}
                  </section>
                )}

                {/* Completed */}
                {completedJobs.length > 0 && (
                  <section className="space-y-3 pt-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                        Completed
                      </h2>
                      <Pill tone="success" size="xs">{completedJobs.length}</Pill>
                    </div>
                    {completedJobs.map(j => (
                      <JobCard key={j._docId || j.id} job={j} extras={myExtras} now={now} />
                    ))}
                  </section>
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
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-white/10"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="grid grid-cols-4">
          {TABS.map(t => {
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className="flex flex-col items-center justify-center gap-0.5 py-2.5 relative transition-colors"
                style={{ color: active ? BRAND : SEMANTIC.neutral }}
              >
                <t.Icon size={20} strokeWidth={active ? 2.25 : 2} />
                <span className="text-[10px] font-semibold leading-none">{t.label}</span>
                {t.count > 0 && (
                  <span
                    className="absolute top-1 right-[26%] text-[9px] text-brand-foreground font-black rounded-full flex items-center justify-center"
                    style={{ backgroundColor: BRAND, minWidth: 14, height: 14, padding: '0 3px' }}
                  >
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

function PortalStat({ label, value, sub, Icon, accent }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 truncate">
          {label}
        </p>
        {Icon && <Icon size={13} strokeWidth={2} style={{ color: accent }} className="shrink-0" />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl font-semibold tabular-nums leading-none" style={{ color: accent }}>
          {value}
        </p>
        {sub && (
          <p className="text-[10px] text-zinc-400 leading-none truncate">{sub}</p>
        )}
      </div>
    </div>
  )
}

function OverviewMetric({ label, value, sub, Icon, emphasis = 'default', valueClass = '' }) {
  const accent =
    emphasis === 'warning'  ? SEMANTIC.warning :
    emphasis === 'critical' ? SEMANTIC.critical :
    emphasis === 'success'  ? SEMANTIC.success :
    BRAND
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 truncate">
          {label}
        </p>
        {Icon && (
          <div
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 28, height: 28, backgroundColor: withAlpha(accent, 0.13), color: accent }}
          >
            <Icon size={14} strokeWidth={2} />
          </div>
        )}
      </div>
      <p className={`font-semibold tabular-nums leading-tight mt-1.5 text-zinc-100 truncate ${valueClass || 'text-2xl'}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{sub}</p>
      )}
    </div>
  )
}

// ── Extras Tab (full list with grouping) ─────────────────────────────────────

function ExtrasTab({ extras, jobs }) {
  const [filter, setFilter] = useState('pending')

  const filtered = useMemo(() => {
    if (filter === 'all') return extras
    return extras.filter(e => extraState(e) === filter)
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
    pending: extras.filter(e => extraState(e) === 'pending').reduce((s, e) => s + (e.amount || 0), 0),
    approved: extras.filter(e => extraState(e) === 'approved').reduce((s, e) => s + (e.amount || 0), 0),
    rejected: extras.filter(e => extraState(e) === 'rejected').reduce((s, e) => s + (e.amount || 0), 0),
  }

  const FILTERS = [
    { id: 'pending', label: 'Pending', color: toneHex('warning'), count: extras.filter(e => extraState(e) === 'pending').length },
    { id: 'approved', label: 'Approved', color: statusColor(CO_STATUS, 'Approved'), count: extras.filter(e => extraState(e) === 'approved').length },
    { id: 'rejected', label: 'Rejected', color: statusColor(CO_STATUS, 'Rejected'), count: extras.filter(e => extraState(e) === 'rejected').length },
    { id: 'all', label: 'All', color: BRAND, count: extras.length },
  ]

  const jobLookup = (jobId) => jobs.find(j => j.id === jobId)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>
          Change Orders
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-white mt-1">Approve & track extras</h2>
        <p className="text-xs text-zinc-400 mt-1">
          Pending <span className="text-amber-300 font-semibold">{fmt$(totals.pending)}</span> · Approved <span className="text-emerald-300 font-semibold">{fmt$(totals.approved)}</span>
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 flex-wrap">
        {FILTERS.map(f => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap shrink-0 transition-colors"
              style={{
                borderColor: active ? withAlpha(f.color, 0.53) : 'rgba(255,255,255,0.10)',
                backgroundColor: active ? withAlpha(f.color, 0.13) : 'transparent',
                color: active ? f.color : '#d4d4d8',
              }}
            >
              {f.label}
              {f.count > 0 && <span className="ml-1.5 opacity-70">{f.count}</span>}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        filter === 'pending'
          ? <AllClearState title="No approvals pending" description="No change orders are waiting for your decision right now." />
          : <EmptyState
              Icon={FilePenLineIcon}
              title={filter === 'all' ? 'No change orders' : `No ${filter} change orders`}
              description="When P2 sends a change order for your review it will appear here."
            />
      ) : (
        byJob.map(([jobId, list]) => {
          const job = jobLookup(jobId)
          return (
            <Card key={jobId} className="border-white/10 bg-white/[0.025]">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-white truncate">{job ? jobName(job) : jobId}</p>
                    <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">{jobId}</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 shrink-0">{list.length} CO{list.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="space-y-2">
                  {list.map(co => (
                    <ExtraRow key={co._docId || co.id} co={co} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
