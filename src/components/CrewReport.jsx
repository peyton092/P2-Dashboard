import { useState, useRef, useMemo } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { addDailyReport } from '../hooks/useFirestore'
import { useData } from '../DataContext'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
  CheckCircleIcon, CheckIcon, CameraIcon, XIcon, ImageIcon, LoaderIcon,
  HardHatIcon, ClipboardListIcon, NotebookPenIcon, PackageIcon,
  ShieldAlertIcon, FilePenLineIcon, BadgeCheckIcon,
  AlertTriangleIcon, ArrowRightIcon, CalendarDaysIcon,
} from 'lucide-react'

const O = '#F47920'

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

const TODAY_LABEL = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})

// ── Local primitives ─────────────────────────────────────────────────────────

function FieldLabel({ children }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 block mb-1.5">
      {children}
    </span>
  )
}

// 2-button Yes/No toggle. Per-option colours so e.g. "Safety issue" can flip
// the colour semantics — Yes is red there, Yes is green for "Inspection ready".
function yesNoButtonStyle(active, activeColor) {
  return {
    borderColor:     active ? activeColor : '#374151',
    backgroundColor: active ? activeColor + '22' : 'transparent',
    color:           active ? activeColor : '#9ca3af',
  }
}

function YesNoToggle({ value, onChange, yesColor = '#22c55e', noColor = '#ef4444' }) {
  const yesActive = value === true
  const noActive  = value === false
  const cls = 'flex-1 py-2.5 rounded-lg border-2 font-bold text-sm transition-colors min-h-11'
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cls}
        style={yesNoButtonStyle(yesActive, yesColor)}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cls}
        style={yesNoButtonStyle(noActive, noColor)}
      >
        No
      </button>
    </div>
  )
}

function WorkCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none py-2.5 min-h-11">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
        style={{
          borderColor: checked ? O : '#4b5563',
          backgroundColor: checked ? O : 'transparent',
        }}
      >
        {checked && <CheckIcon size={12} color="#fff" strokeWidth={3} />}
      </button>
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
    const newPhotos = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
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
      const ext = p.file.name.split('.').pop()
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
      const dateStr = new Date().toISOString().slice(0, 10)
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
          subtitle={TODAY_LABEL}
        />
        <DataPanel title="Field update received" Icon={CheckCircleIcon}>
          <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
              style={{ backgroundColor: '#22c55e22' }}
            >
              <CheckCircleIcon size={40} color="#22c55e" strokeWidth={2.25} />
            </div>
            <p className="text-xl font-bold text-white mb-1">Field update received</p>
            <p className="text-sm text-zinc-300 max-w-md">
              Your daily report has been saved. Ready for office review.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex items-center gap-2 text-sm font-bold px-6 py-3 rounded-lg text-white transition-colors min-h-11"
              style={{ backgroundColor: O }}
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
              {TODAY_LABEL}
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
              <div>
                <FieldLabel>Reporter</FieldLabel>
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
              </div>

              <div>
                <FieldLabel>Job</FieldLabel>
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
              </div>

              <div>
                <FieldLabel>Phase</FieldLabel>
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
              </div>
            </div>
          </DataPanel>

          {/* Today's work */}
          <DataPanel
            title="Work completed today"
            description={completedCount > 0 ? `${completedCount} item${completedCount === 1 ? '' : 's'} marked` : 'Tap each item finished today.'}
            Icon={ClipboardListIcon}
          >
            <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 divide-y divide-white/5">
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
              <div>
                <FieldLabel>Materials used</FieldLabel>
                <Textarea
                  value={matUsed}
                  onChange={e => setMatUsed(e.target.value)}
                  placeholder="e.g. 12/2 Romex 50ft, 4 boxes, 2 GFCI outlets…"
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 resize-none"
                  rows={2}
                />
              </div>

              <div>
                <FieldLabel>Materials needed for next visit</FieldLabel>
                <Textarea
                  value={matNeeded}
                  onChange={e => setMatNeeded(e.target.value)}
                  placeholder="e.g. 200A panel, 10/3 wire…"
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 resize-none"
                  rows={2}
                />
              </div>

              <div>
                <FieldLabel>Next step</FieldLabel>
                <Input
                  value={nextStep}
                  onChange={e => setNextStep(e.target.value)}
                  placeholder="e.g. Trim panel, schedule final inspection…"
                  className="bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 h-11"
                />
              </div>
            </div>
          </DataPanel>

          {/* Status flags */}
          <DataPanel title="Status & flags" Icon={BadgeCheckIcon}>
            <div className="space-y-4">
              <div>
                <FieldLabel>Blocker</FieldLabel>
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
              </div>

              <div>
                <FieldLabel>
                  <span className="inline-flex items-center gap-1">
                    <ShieldAlertIcon size={11} /> Safety issue
                  </span>
                </FieldLabel>
                <YesNoToggle
                  value={safetyIssue}
                  onChange={setSafetyIssue}
                  yesColor="#ef4444"
                  noColor="#22c55e"
                />
              </div>

              <div>
                <FieldLabel>
                  <span className="inline-flex items-center gap-1">
                    <FilePenLineIcon size={11} /> Change order needed
                  </span>
                </FieldLabel>
                <YesNoToggle
                  value={changeOrderNeeded}
                  onChange={setChangeOrderNeeded}
                  yesColor={O}
                  noColor="#22c55e"
                />
              </div>

              <div>
                <FieldLabel>
                  <span className="inline-flex items-center gap-1">
                    <BadgeCheckIcon size={11} /> Inspection ready
                  </span>
                </FieldLabel>
                <YesNoToggle
                  value={inspReady}
                  onChange={setInspReady}
                  yesColor="#22c55e"
                  noColor="#ef4444"
                />
              </div>
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
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
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
              <p className="flex items-center gap-2 text-zinc-500 text-[11px] mt-2">
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
            className="w-full h-12 rounded-lg text-base font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait transition-colors"
            style={{ backgroundColor: O }}
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
        <p className="text-[11px] text-zinc-500 mt-1 truncate" title={report.materialsNeeded}>
          Needs: {report.materialsNeeded}
        </p>
      )}
    </div>
  )
}
