import { useMemo, useState, useRef } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { useData } from '../DataContext'
import { useJobFiles, addJobFile } from '../hooks/useFirestore'
import { MessageSquareIcon, UploadIcon } from 'lucide-react'
import JobTasks from './JobTasks'
import { generateInvoicePdf } from '../lib/generateInvoicePdf'
import { DataPanel, MetricTile, Pill, ProgressBar, EmptyState } from './shared'
import { BILLING_STATUS_LABEL } from '../lib/billing'
import { classifyRisk, hasFailedInspection } from '../agent/scoring'
import PhotoLightbox from './PhotoLightbox'
import {
  ChevronLeftIcon, MapPinIcon, UserRoundCogIcon, HardHatIcon,
  DollarSignIcon, FilePenLineIcon, BoxesIcon, BadgeCheckIcon,
  ClipboardSignatureIcon, FileTextIcon, ImageIcon, DownloadIcon,
  NotebookPenIcon, ActivityIcon, ReceiptIcon, CalendarIcon, PrinterIcon,
} from 'lucide-react'

const O = '#F47920'

const jobLabel = (j) => j.name || j.client || j.id
const fmt$ = (n) => `$${Number(n || 0).toLocaleString()}`

const ISTATUS = {
  passed:                 { c: '#22c55e', l: 'Passed' },
  failed:                 { c: '#ef4444', l: 'Failed' },
  scheduled:              { c: '#3b82f6', l: 'Scheduled' },
  pending:                { c: '#eab308', l: 'Pending' },
  'pending-verification': { c: '#eab308', l: 'Pending' },
  blocked:                { c: '#ef4444', l: 'Blocked' },
  'not-started':          { c: '#6b7280', l: 'Not started' },
  'n/a':                  { c: '#6b7280', l: 'N/A' },
}

const PHASE_LABEL = { roughIn: 'Rough-In', trim: 'Trim', final: 'Final' }
const DATE_KEYS = new Set(['roughInDate', 'trimDate', 'finalDate', 'finalFailDate', 'roughInFailDate'])

function fmtDate(d) {
  if (!d) return ''
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d)
    if (isNaN(dt.getTime())) return ''
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

const CO_TONE = { approved: 'success', rejected: 'critical', pending: 'warning' }

function TradeInspections({ trade, data }) {
  const phases = Object.keys(data || {}).filter(k => !DATE_KEYS.has(k))
  if (phases.length === 0) return null
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-300 mb-2 capitalize">{trade}</p>
      <div className="space-y-1.5">
        {phases.map(phase => {
          const status = data[phase]
          const meta = ISTATUS[status] || ISTATUS['not-started']
          const dateKey = `${phase}Date`
          const date = data[dateKey]
          return (
            <div key={phase} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-zinc-400">{PHASE_LABEL[phase] || phase}</span>
              <span className="flex items-center gap-2">
                {date && <span className="text-[10px] text-zinc-500">{fmtDate(date)}</span>}
                <span className="font-bold px-1.5 py-0.5 rounded-md text-[10px]" style={{ color: meta.c, backgroundColor: meta.c + '22' }}>{meta.l}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function JobDetail({ jobId, onBack }) {
  const { jobs = [], extras = [], materials = [], dailyReports = [], submits = [] } = useData()
  const job = useMemo(() => jobs.find(j => j.id === jobId), [jobs, jobId])
  const { files } = useJobFiles(job?._docId)

  const jobExtras = useMemo(() => extras.filter(e => e.job === jobId), [extras, jobId])
  const jobMaterials = useMemo(() => materials.filter(m => (m.job || m.jobId) === jobId), [materials, jobId])
  const jobReports = useMemo(
    () => dailyReports.filter(r => (r.jobId || r.job) === jobId).slice(0, 6),
    [dailyReports, jobId],
  )
  const jobSubmits = useMemo(
    () => submits.filter(s => s.jobId === jobId).slice(0, 6),
    [submits, jobId],
  )
  const [lightboxIdx, setLightboxIdx] = useState(-1)
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !job?._docId) return
    setUploading(true); setUploadErr('')
    try {
      const path = `jobs/${job._docId}/uploads/${Date.now()}-${file.name}`
      const sref = storageRef(storage, path)
      await uploadBytes(sref, file)
      const url = await getDownloadURL(sref)
      await addJobFile(job._docId, {
        name: file.name,
        url,
        type: file.type || 'application/octet-stream',
        size: file.size,
        source: 'staff-upload',
      })
    } catch (err) {
      console.error('[JobDetail] Upload failed:', err)
      setUploadErr('Upload failed — check file size or Storage rules.')
    } finally {
      setUploading(false)
    }
  }

  if (!job) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-white">
          <ChevronLeftIcon size={15} /> Back
        </button>
        <EmptyState Icon={HardHatIcon} title="Job not found" description="This job may have been removed or isn't loaded yet." />
      </div>
    )
  }

  const risk = classifyRisk(job)
  const failed = hasFailedInspection(job)
  const complete = ['complete', 'completed'].includes(job.status)
  const railColor = failed || risk?.level === 'critical' ? '#ef4444'
    : risk?.level === 'warning' ? '#eab308'
    : complete ? '#22c55e' : O

  const pendingCO = jobExtras.filter(e => e.status === 'pending')
  const approvedCO = jobExtras.filter(e => e.status === 'approved')
  const photos = files.filter(f => (f.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name || ''))
  const docs = files.filter(f => !photos.includes(f))
  const hasInvoice = Boolean(job.invoiceNum)

  const trades = ['electrical', 'plumbing', 'hvac'].filter(t => job.insp?.[t])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button onClick={onBack} className="no-print inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-white mb-3">
          <ChevronLeftIcon size={15} /> Back to jobs
        </button>
        <div className="rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden" style={{ borderLeftWidth: 3, borderLeftColor: railColor }}>
          <div className="p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-semibold text-white">{jobLabel(job)}</h1>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-white/[0.06] text-zinc-300">{job.id}</span>
                  {complete
                    ? <Pill tone="success" size="xs">Complete</Pill>
                    : <Pill tone={risk?.level === 'critical' || failed ? 'critical' : risk?.level === 'warning' ? 'warning' : 'success'} size="xs">{job.status || 'active'}</Pill>}
                </div>
                {job.address && (
                  <p className="text-sm text-zinc-400 flex items-center gap-1.5 mt-1.5">
                    <MapPinIcon size={13} /> {job.address}{job.city ? `, ${job.city}` : ''}
                  </p>
                )}
                <p className="text-sm text-zinc-400 mt-1">{job.client}{job.type ? ` · ${job.type}` : ''}</p>
              </div>
              <div className="no-print flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/15 text-zinc-200 hover:text-white hover:border-white/30 transition-colors"
                  title="Print this job summary"
                >
                  <PrinterIcon size={13} /> Print
                </button>
                {hasInvoice && (
                  <button onClick={() => generateInvoicePdf(job)} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white" style={{ backgroundColor: O }}>
                    <DownloadIcon size={13} /> Invoice PDF
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                <span>Progress</span>
                <span className="font-semibold text-zinc-200">{job.progress ?? 0}%</span>
              </div>
              <ProgressBar value={job.progress ?? 0} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-xs">
              <DetailField Icon={UserRoundCogIcon} label="Project Manager" value={job.pm || 'TBD'} sub={job.lead ? `Lead: ${job.lead}` : null} />
              <DetailField Icon={CalendarIcon} label="Target" value={fmtDate(job.target) || 'TBD'} sub={job.start ? `Started ${fmtDate(job.start)}` : null} />
              <DetailField Icon={ReceiptIcon} label="Billing" value={BILLING_STATUS_LABEL[job.billingStatus] || 'Not invoiced'} sub={job.invoiceNum ? `Invoice ${job.invoiceNum}` : null} />
              <DetailField Icon={ClipboardSignatureIcon} label="Permit" value={job.permitNumber || '—'} sub={job.county ? `${job.county} County` : null} />
            </div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <section className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <MetricTile label="Progress" value={`${job.progress ?? 0}%`} Icon={ActivityIcon} />
        <MetricTile label="Open Change Orders" value={pendingCO.length} Icon={FilePenLineIcon} emphasis={pendingCO.length > 0 ? 'warning' : 'success'} sub={pendingCO.length > 0 ? fmt$(pendingCO.reduce((s, e) => s + (e.amount || 0), 0)) : 'None pending'} />
        <MetricTile label="Materials" value={jobMaterials.length} Icon={BoxesIcon} sub={`${jobMaterials.filter(m => m.status === 'delivered').length} delivered`} />
        <MetricTile label="Inspections" value={failed ? 'Failed' : complete ? 'Complete' : 'In progress'} Icon={BadgeCheckIcon} emphasis={failed ? 'critical' : complete ? 'success' : 'mute'} />
      </section>

      {/* Inspections */}
      <DataPanel title="Inspections" description="Status by trade and phase." Icon={BadgeCheckIcon}>
        {trades.length === 0 ? (
          <p className="text-sm text-zinc-400">No inspection data for this job.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {trades.map(t => <TradeInspections key={t} trade={t} data={job.insp[t]} />)}
          </div>
        )}
      </DataPanel>

      {/* Tasks / punch list */}
      <JobTasks jobId={jobId} />

      {/* Change orders */}
      <DataPanel title="Change Orders" description={jobExtras.length === 0 ? 'No change orders on this job.' : `${approvedCO.length} approved · ${pendingCO.length} pending`} Icon={FilePenLineIcon} padding="none">
        {jobExtras.length === 0 ? (
          <div className="p-5"><EmptyState Icon={FilePenLineIcon} title="No change orders" description="Extras raised on this job will appear here." /></div>
        ) : (
          <ul className="divide-y divide-white/5">
            {jobExtras.map(co => (
              <li key={co._docId || co.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold" style={{ color: O }}>{co.id || 'CO'}</span>
                    <Pill tone={CO_TONE[co.status] || 'neutral'} size="xs">{co.status || 'pending'}</Pill>
                  </div>
                  <p className="text-sm text-zinc-200 truncate mt-0.5">{co.desc || 'No description'}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0" style={{ color: O }}>{fmt$(co.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </DataPanel>

      {/* Materials */}
      {jobMaterials.length > 0 && (
        <DataPanel title="Materials" description={`${jobMaterials.length} line item${jobMaterials.length === 1 ? '' : 's'}`} Icon={BoxesIcon} padding="none">
          <ul className="divide-y divide-white/5">
            {jobMaterials.map(m => (
              <li key={m._docId || m.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-200 truncate">{m.item}{m.qty ? ` · ${m.qty} ${m.unit || ''}` : ''}</span>
                <span className="text-xs text-zinc-400 shrink-0">{m.status}{m.vendor ? ` · ${m.vendor}` : ''}</span>
              </li>
            ))}
          </ul>
        </DataPanel>
      )}

      {/* Messages & RFIs */}
      {jobSubmits.length > 0 && (
        <DataPanel
          title="Messages & RFIs"
          description={`${jobSubmits.length} most recent`}
          Icon={MessageSquareIcon}
          padding="none"
          actions={
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('p2:navigate', { detail: { id: 'submit' } }))}
              className="text-[11px] font-semibold text-zinc-300 hover:text-white"
            >
              Open inbox →
            </button>
          }
        >
          <ul className="divide-y divide-white/5">
            {jobSubmits.map(s => {
              const tone = s.status === 'Resolved' ? 'success' : s.status === 'In Progress' ? 'warning' : 'critical'
              const when = s.createdAt?.toDate?.()?.toLocaleDateString?.() || ''
              return (
                <li key={s._docId} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-100 truncate">{s.subject || '(no subject)'}</span>
                    <Pill tone={tone} size="xs">{s.status || 'Open'}</Pill>
                    {s.priority && <span className="text-[10px] text-zinc-500">· {s.priority}</span>}
                    {s.category && <span className="text-[10px] text-zinc-500">· {s.category}</span>}
                  </div>
                  {s.body && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{s.body}</p>}
                  {when && <p className="text-[10px] text-zinc-500 mt-1">{when}</p>}
                </li>
              )
            })}
          </ul>
        </DataPanel>
      )}

      {/* Documents & photos */}
      <DataPanel
        title="Documents & Photos"
        description={files.length === 0 ? 'No files yet.' : `${photos.length} photo${photos.length === 1 ? '' : 's'} · ${docs.length} document${docs.length === 1 ? '' : 's'}`}
        Icon={ImageIcon}
        actions={
          <>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !job?._docId}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-200 hover:text-white hover:border-white/25 disabled:opacity-50 disabled:cursor-wait transition-colors"
            >
              <UploadIcon size={12} /> {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        }
      >
        {uploadErr && <p className="text-xs text-red-400 mb-2">{uploadErr}</p>}
        {files.length === 0 ? (
          <p className="text-sm text-zinc-400">CompanyCam photos and uploaded documents appear here.</p>
        ) : (
          <div className="space-y-3">
            {photos.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {photos.map((p, i) => (
                  <button
                    type="button"
                    key={p._docId}
                    onClick={() => setLightboxIdx(i)}
                    className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5 hover:border-white/25 transition-colors group"
                    title={p.name || 'Open photo'}
                  >
                    <img src={p.url} alt={p.name || 'Jobsite photo'} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {docs.map(d => (
              <a key={d._docId} href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                <FileTextIcon size={14} className="shrink-0 text-zinc-400" />
                <span className="text-xs text-zinc-200 truncate flex-1">{d.name || 'Document'}</span>
                <DownloadIcon size={13} className="shrink-0 text-zinc-400" />
              </a>
            ))}
          </div>
        )}
      </DataPanel>

      <PhotoLightbox
        photos={photos}
        index={lightboxIdx}
        onClose={() => setLightboxIdx(-1)}
        onIndexChange={setLightboxIdx}
      />

      {/* Daily reports */}
      {jobReports.length > 0 && (
        <DataPanel title="Recent Daily Reports" description={`${jobReports.length} most recent`} Icon={NotebookPenIcon} padding="none">
          <ul className="divide-y divide-white/5">
            {jobReports.map(r => (
              <li key={r._docId} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-200">{r.crewMember || r.author || 'Crew'}</span>
                  <span className="text-[11px] text-zinc-500">{r.date || fmtDate(r.createdAt)}</span>
                </div>
                {r.notes && <p className="text-xs text-zinc-400 mt-1 line-clamp-3">{r.notes}</p>}
              </li>
            ))}
          </ul>
        </DataPanel>
      )}
    </div>
  )
}

function DetailField({ Icon, label, value, sub }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-400 flex items-center gap-1">
        {Icon && <Icon size={11} />} {label}
      </p>
      <p className="font-semibold text-zinc-100 truncate mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 truncate">{sub}</p>}
    </div>
  )
}
