import { useState, useRef, useMemo, useId } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { addDailyReport } from '../hooks/useFirestore'
import { validateUpload, ALLOWED_UPLOAD_TYPES } from '../lib/uploads'
import { fmtLongDate, toLocalDateStr } from '../lib/dates'
import { useData } from '../use-data'
import { useNow } from '../hooks/useNow'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  PageHeader,
  DataPanel,
  Pill,
  EmptyState,
} from './shared'
import {
  CheckCircleIcon, CameraIcon, XIcon, ImageIcon, LoaderIcon,
  HardHatIcon, ClipboardListIcon, NotebookPenIcon, PackageIcon,
  ShieldAlertIcon, FilePenLineIcon, BadgeCheckIcon,
  AlertTriangleIcon, ArrowRightIcon, CalendarDaysIcon,
} from 'lucide-react'
import { BRAND, SEMANTIC, withAlpha } from '@/lib/tokens'
import { toneHex, toneText } from '@/lib/status'
import { cn } from '@/lib/utils'

const CREW_LIST = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']
const PHASES = ['Rough-In', 'Service Release', 'Trim', 'Final']

const WORK_ITEMS = [
  { id: 'circuits', label: 'Circuits run' },
  { id: 'boxes',    label: 'Boxes set' },
  { id: 'panel',    label: 'Panel landed' },
  { id: 'service',  label: 'Service built' },
  { id: 'devices',  label: 'Devices installed' },
  { id: 'fixtures', label: 'Fixtures hung' },
  { id: 'other',    label: 'Other' },
]

const BLOCKER_OPTIONS = [
  'None',
  'Waiting on other trade',
  'Material missing',
  'Inspection needed',
  'Owner decision',
  'Other',
]

// ── Local primitives ─────────────────────────────────────────────────────────

// A question with two answers, as a group of two buttons named by the question, each
// saying whether it is pressed. Each answer has a tone of its own, because what a yes
// means turns: Yes is critical for a safety issue and success for inspection ready. The
// tone is never the only sign, since the pressed answer is also filled and says so.
function YesNoQuestion({ label, Icon, value, onChange, yesTone = 'success', noTone = 'critical' }) {
  const labelId = useId()
  return (
    <div>
      <p id={labelId} className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-zinc-200">
        <Icon size={11} aria-hidden="true" /> {label}
      </p>
      <div role="group" aria-labelledby={labelId} className="flex gap-3">
        <Answer pressed={value === true} tone={yesTone} onPress={() => onChange(true)}>Yes</Answer>
        <Answer pressed={value === false} tone={noTone} onPress={() => onChange(false)}>No</Answer>
      </div>
    </div>
  )
}

function Answer({ pressed, tone, onPress, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={cn(
        'flex-1 py-2.5 rounded-lg border-2 font-bold text-sm transition-colors min-h-11',
        !pressed && 'border-white/15 text-neutral',
      )}
      style={pressed ? { borderColor: toneHex(tone), backgroundColor: withAlpha(toneHex(tone), 0.13), color: toneText(tone) } : undefined}
    >
      {children}
    </button>
  )
}

// One item of the work done today: a real checkbox inside its label, so Space or a tap
// anywhere on the row checks it, and a screen reader reads its name and its state.
function WorkCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none py-2.5 min-h-11">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onChange(!checked)}
        className="size-5 shrink-0 cursor-pointer accent-brand"
      />
      <span className="text-sm text-zinc-200">{label}</span>
    </label>
  )
}

// Compact summary line for a dailyReport doc rendered in the recent-reports
// list. The schema isn't authoritative about a "status" field, so we derive:
//   - inspectionReady true → "Inspection ready"
//   - blocker not None    → blocker label
//   - otherwise           → "Ready for office review"
function reportStatusInfo(r) {
  if (r.inspectionReady === true) {
    return { tone: 'success', label: 'Inspection ready' }
  }
  if (r.blocker && r.blocker !== 'None') {
    return { tone: 'warning', label: r.blocker }
  }
  return { tone: 'info', label: 'Ready for office review' }
}

function fmtReportDate(r) {
  // `date` is the YYYY-MM-DD string we wrote. Fall back to createdAt if missing.
  if (r.date) {
    const d = new Date(r.date + 'T00:00:00')
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }
  if (r.createdAt?.seconds) {
    return new Date(r.createdAt.seconds * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    })
  }
  return ''
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CrewReport() {
  const { jobs = [], dailyReports = [] } = useData()
  const now = useNow()
  const todayLabel = fmtLongDate(now)
  const activeJobs = useMemo(
    () => jobs.filter(j => !['complete', 'completed'].includes(j.status)),
    [jobs],
  )

  const [crewMember, setCrewMember] = useState('')
  const [jobId, setJobId]           = useState('')
  const [phase, setPhase]           = useState('')
  const [workDone, setWorkDone]     = useState({})
  const [photos, setPhotos]         = useState([]) // { file, preview }
  const [matUsed, setMatUsed]       = useState('')
  const [matNeeded, setMatNeeded]   = useState('')
  const [blocker, setBlocker]       = useState('None')
  const [inspReady, setInspReady]   = useState(null)        // true | false | null
  const [safetyIssue, setSafetyIssue]         = useState(null)
  const [changeOrderNeeded, setChangeOrderNeeded] = useState(null)
  const [nextStep, setNextStep]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]       = useState(false)
  const [error, setError]           = useState('')

  const cameraRef = useRef(null)

  const selectedJob = useMemo(
    () => activeJobs.find(j => j.id === jobId) || null,
    [activeJobs, jobId],
  )

  const recentReports = useMemo(() => {
    // If a job is selected, show that job's history first; otherwise the
    // overall most-recent slice. The hook already orders by createdAt desc.
    if (jobId) {
      return dailyReports.filter(r => r.jobId === jobId).slice(0, 6)
    }
    return dailyReports.slice(0, 6)
  }, [dailyReports, jobId])

  const completedCount = Object.values(workDone).filter(Boolean).length

  // ── Photo upload (preserved verbatim from prior implementation) ────────────

  const toggleWork = (id) => setWorkDone(prev => ({ ...prev, [id]: !prev[id] }))

  const handlePhoto = (e) => {
    const files = Array.from(e.target.files || [])
    const accepted = []
    for (const f of files) {
      const check = validateUpload(f)
      if (check.ok) accepted.push(f)
      else setError(check.reason)
    }
    const newPhotos = accepted.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setPhotos(prev => [...prev, ...newPhotos])
    e.target.value = ''
  }

  const removePhoto = (i) => {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, idx) => idx !== i)
    })
  }

  const uploadPhotos = async (dateStr, jobIdVal) => {
    const urls = []
    for (const p of photos) {
      const check = validateUpload(p.file)
      if (!check.ok) throw new Error(check.reason)
      const ext = (p.file.name.split('.').pop() || 'jpg').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'jpg'
      const name = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const path = `daily_reports/${dateStr}/${jobIdVal}/${name}`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, p.file)
      const url = await getDownloadURL(sRef)
      urls.push(url)
    }
    return urls
  }

  // ── Submit (writes only the original 12 fields — Safety / CO toggles are
  //   folded into `nextStep` so we don't introduce new Firestore fields). ──

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!crewMember) { setError('Pick your name to continue.'); return }
    if (!jobId)      { setError('Pick a job to continue.');     return }
    if (!phase)      { setError('Pick a phase to continue.');   return }

    setError('')
    setSubmitting(true)

    try {
      // The day of the report is the day it is submitted, where the crew member is.
      const dateStr = toLocalDateStr()
      const photoUrls = await uploadPhotos(dateStr, jobId)
      const job = activeJobs.find(j => j.id === jobId)

      // Compose nextStep with optional Safety / CO flags appended on their
      // own lines. Only "Yes" answers append; "No" / unanswered are silent.
      const nextStepLines = []
      const baseNextStep = nextStep.trim()
      if (baseNextStep) nextStepLines.push(baseNextStep)
      if (safetyIssue === true)       nextStepLines.push('Safety issue reported: Yes')
      if (changeOrderNeeded === true) nextStepLines.push('Change order needed: Yes')
      const composedNextStep = nextStepLines.join('\n')

      const payload = {
        crewMember,
        jobId,
        jobName: job?.name || jobId,
        date: dateStr,
        phase,
        workCompleted: Object.keys(workDone).filter(k => workDone[k]),
        photoUrls,
        materialsUsed:   matUsed.trim(),
        materialsNeeded: matNeeded.trim(),
        blocker,
        inspectionReady: inspReady,
        nextStep:        composedNextStep,
      }

      await addDailyReport(payload)
      setSuccess(true)
    } catch (err) {
      setError('Submit failed: ' + (err.message || 'Unknown error'))
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setCrewMember(''); setJobId(''); setPhase(''); setWorkDone({}); setPhotos([])
    setMatUsed(''); setMatNeeded(''); setBlocker('None')
    setInspReady(null); setSafetyIssue(null); setChangeOrderNeeded(null)
    setNextStep(''); setSuccess(false); setError('')
  }

  // ── Success state ───────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Field Report"
          title="Daily report"
          subtitle={todayLabel}
        />
        <DataPanel title="Field update received" Icon={CheckCircleIcon}>
          <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
              style={{ backgroundColor: withAlpha(SEMANTIC.success, 0.13) }}
            >
              <CheckCircleIcon size={40} color={SEMANTIC.success} strokeWidth={2.25} aria-hidden="true" />
            </div>
            <p className="text-xl font-bold text-white mb-1">Field update received</p>
            <p className="text-sm text-zinc-300 max-w-md">
              Your daily report has been saved. Ready for office review.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex items-center gap-2 text-sm font-bold px-6 py-3 rounded-lg text-brand-foreground transition-colors min-h-11"
              style={{ backgroundColor: BRAND }}
            >
              Submit another report
            </button>
          </div>
        </DataPanel>
      </div>
    )
  }

  // ── Form ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Field Report"
        title="Daily report"
        subtitle="Log today's work, blockers, materials, and inspection status."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDaysIcon size={12} />
              {todayLabel}
            </span>
            {crewMember && <span>Reporter: <span className="text-zinc-200 font-semibold">{crewMember}</span></span>}
            {selectedJob && (
              <span>
                Job: <span className="text-zinc-200 font-semibold">{selectedJob.id}</span>
                {selectedJob.name ? ` · ${selectedJob.name}` : ''}
              </span>
            )}
            {phase && <span>Phase: <span className="text-zinc-200 font-semibold">{phase}</span></span>}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Form column ── */}
        <form onSubmit={handleSubmit} className="space-y-5 min-w-0">

          {/* Crew & Job */}
          <DataPanel title="Crew & Job" Icon={HardHatIcon}>
            <div className="space-y-4">
              <Field label="Reporter">
                <Select value={crewMember} onValueChange={setCrewMember}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-white h-11">
                    <SelectValue placeholder="Select your name…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CREW_LIST.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Job">
                <Select value={jobId} onValueChange={setJobId}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-white h-11">
                    <SelectValue placeholder="Select job…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeJobs.map(j => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.id} — {j.name || j.client || ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Phase">
                <Select value={phase} onValueChange={setPhase}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-white h-11">
                    <SelectValue placeholder="Select phase…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASES.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </DataPanel>

          {/* Today's work */}
          <DataPanel
            title="Work completed today"
            description={completedCount > 0 ? `${completedCount} item${completedCount === 1 ? '' : 's'} marked` : 'Tap each item finished today.'}
            Icon={ClipboardListIcon}
          >
            <div role="group" aria-label="Work completed today" className="rounded-lg border border-white/10 bg-white/[0.025] px-3 divide-y divide-white/5">
              {WORK_ITEMS.map(item => (
                <WorkCheckbox
                  key={item.id}
                  checked={!!workDone[item.id]}
                  onChange={() => toggleWork(item.id)}
                  label={item.label}
                />
              ))}
            </div>
          </DataPanel>

          {/* Materials & notes */}
          <DataPanel title="Materials & notes" Icon={PackageIcon}>
            <div className="space-y-4">
              <Field label="Materials used">
                <Textarea
                  value={matUsed}
                  onChange={e => setMatUsed(e.target.value)}
                  placeholder="e.g. 12/2 Romex 50ft, 4 boxes, 2 GFCI outlets…"
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400 resize-none"
                  rows={2}
                />
              </Field>

              <Field label="Materials needed for next visit">
                <Textarea
                  value={matNeeded}
                  onChange={e => setMatNeeded(e.target.value)}
                  placeholder="e.g. 200A panel, 10/3 wire…"
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400 resize-none"
                  rows={2}
                />
              </Field>

              <Field label="Next step">
                <Input
                  value={nextStep}
                  onChange={e => setNextStep(e.target.value)}
                  placeholder="e.g. Trim panel, schedule final inspection…"
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-400 h-11"
                />
              </Field>
            </div>
          </DataPanel>

          {/* Status flags */}
          <DataPanel title="Status & flags" Icon={BadgeCheckIcon}>
            <div className="space-y-4">
              <Field label="Blocker">
                <Select value={blocker} onValueChange={setBlocker}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 text-white h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOCKER_OPTIONS.map(b => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <YesNoQuestion
                label="Safety issue"
                Icon={ShieldAlertIcon}
                value={safetyIssue}
                onChange={setSafetyIssue}
                yesTone="critical"
                noTone="success"
              />

              <YesNoQuestion
                label="Change order needed"
                Icon={FilePenLineIcon}
                value={changeOrderNeeded}
                onChange={setChangeOrderNeeded}
                yesTone="brand"
                noTone="success"
              />

              <YesNoQuestion
                label="Inspection ready"
                Icon={BadgeCheckIcon}
                value={inspReady}
                onChange={setInspReady}
                yesTone="success"
                noTone="critical"
              />
            </div>
          </DataPanel>

          {/* Photos */}
          <DataPanel
            title="Photos"
            description={photos.length > 0
              ? `${photos.length} photo${photos.length === 1 ? '' : 's'} ready to upload`
              : 'Capture progress, blockers, or proof of completion.'}
            Icon={CameraIcon}
          >
            <input
              ref={cameraRef}
              type="file"
              accept={ALLOWED_UPLOAD_TYPES.join(',')}
              multiple
              capture="environment"
              hidden
              onChange={handlePhoto}
            />
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-white/20 hover:border-white/40 bg-white/[0.025] hover:bg-white/[0.05] transition-colors text-sm text-zinc-200 w-full min-h-11"
            >
              <CameraIcon size={18} />
              Add photo
            </button>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {photos.map((p, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-white/[0.06]">
                    <img src={p.preview} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 hover:bg-black/85 flex items-center justify-center"
                      aria-label="Remove photo"
                    >
                      <XIcon size={12} color="#fff" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {photos.length === 0 && (
              <p className="flex items-center gap-2 text-zinc-400 text-[11px] mt-2">
                <ImageIcon size={12} />
                No photos attached
              </p>
            )}
          </DataPanel>

          {/* Error + Submit */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
              <AlertTriangleIcon size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-lg text-base font-bold text-brand-foreground inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait transition-colors"
            style={{ backgroundColor: BRAND }}
          >
            {submitting ? (
              <><LoaderIcon size={16} className="animate-spin" /> Submitting…</>
            ) : (
              <>Submit daily report <ArrowRightIcon size={16} /></>
            )}
          </button>
        </form>

        {/* ── Sidebar (desktop) / footer (mobile) ── */}
        <aside className="space-y-5 min-w-0">
          {selectedJob && (
            <DataPanel title="Job context" Icon={NotebookPenIcon}>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
                    {selectedJob.id}
                  </span>
                  <span className="text-sm font-semibold text-white truncate">
                    {selectedJob.name || selectedJob.client || selectedJob.id}
                  </span>
                </div>
                {selectedJob.address && (
                  <p className="text-[11px] text-zinc-400 truncate">{selectedJob.address}</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedJob.pm && <Pill tone="brand"   size="xs">PM {selectedJob.pm}</Pill>}
                  {selectedJob.lead && <Pill tone="info"  size="xs">Lead {selectedJob.lead}</Pill>}
                  {selectedJob.phase && (
                    <Pill tone="neutral" size="xs">
                      {selectedJob.phase.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Pill>
                  )}
                </div>
              </div>
            </DataPanel>
          )}

          <DataPanel
            title="Recent reports"
            description={jobId ? 'For this job' : 'Across active jobs'}
            Icon={ClipboardListIcon}
            badge={recentReports.length > 0 ? <Pill tone="neutral" size="xs">{recentReports.length}</Pill> : null}
            padding={recentReports.length === 0 ? 'default' : 'none'}
          >
            {recentReports.length === 0 ? (
              <EmptyState
                Icon={ClipboardListIcon}
                title="No recent reports"
                description={jobId
                  ? 'No daily reports filed for this job yet.'
                  : 'Daily reports will appear here once submitted.'}
              />
            ) : (
              <ul className="divide-y divide-white/5">
                {recentReports.map(r => (
                  <li key={r._docId}>
                    <RecentReportRow report={r} />
                  </li>
                ))}
              </ul>
            )}
          </DataPanel>
        </aside>
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RecentReportRow({ report }) {
  const status = reportStatusInfo(report)
  const completed = Array.isArray(report.workCompleted) ? report.workCompleted.length : 0
  const summary = completed > 0
    ? `${completed} item${completed === 1 ? '' : 's'} completed`
    : 'No items checked'

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2 mb-1 flex-wrap">
        <span className="text-[10px] font-medium tracking-tight px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 shrink-0">
          {report.jobId || '—'}
        </span>
        <span className="text-[12px] font-semibold text-white truncate min-w-0 flex-1">
          {report.jobName || report.jobId || '—'}
        </span>
        <Pill tone={status.tone} size="xs">{status.label}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
        <span className="text-zinc-300 font-semibold">{report.crewMember || '—'}</span>
        <span>·</span>
        <span>{fmtReportDate(report)}</span>
        {report.phase && (<><span>·</span><span>{report.phase}</span></>)}
        <span>·</span>
        <span>{summary}</span>
      </div>
      {report.materialsNeeded && (
        <p className="text-[11px] text-zinc-400 mt-1 truncate" title={report.materialsNeeded}>
          Needs: {report.materialsNeeded}
        </p>
      )}
    </div>
  )
}
