import { useState, useRef } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { addDailyReport } from '../hooks/useFirestore'
import { useData } from '../DataContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  CheckCircleIcon, CameraIcon, XIcon, ImageIcon, LoaderIcon,
} from 'lucide-react'

const O = '#F47920'

const CREW_LIST = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']

const PHASES = ['Rough-In', 'Service Release', 'Trim', 'Final']

const WORK_ITEMS = [
  { id: 'circuits',  label: 'Circuits run'       },
  { id: 'boxes',     label: 'Boxes set'           },
  { id: 'panel',     label: 'Panel landed'        },
  { id: 'service',   label: 'Service built'       },
  { id: 'devices',   label: 'Devices installed'   },
  { id: 'fixtures',  label: 'Fixtures hung'       },
  { id: 'other',     label: 'Other'               },
]

const BLOCKER_OPTIONS = [
  'None',
  'Waiting on other trade',
  'Material missing',
  'Inspection needed',
  'Owner decision',
  'Other',
]

function Checkbox({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none py-2">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
        style={{
          borderColor: checked ? O : '#4b5563',
          backgroundColor: checked ? O : 'transparent',
        }}
      >
        {checked && <CheckCircleIcon size={12} color="#fff" strokeWidth={3} />}
      </button>
      <span className="text-sm text-zinc-200">{label}</span>
    </label>
  )
}

export default function CrewReport() {
  const { jobs } = useData()
  const activeJobs = jobs.filter(j => j.status !== 'completed')

  const [crewMember, setCrewMember] = useState('')
  const [jobId, setJobId]         = useState('')
  const [phase, setPhase]         = useState('')
  const [workDone, setWorkDone]   = useState({})
  const [photos, setPhotos]       = useState([])   // { file, preview, url? }
  const [matUsed, setMatUsed]     = useState('')
  const [matNeeded, setMatNeeded] = useState('')
  const [blocker, setBlocker]     = useState('None')
  const [inspReady, setInspReady] = useState(null) // true | false | null
  const [nextStep, setNextStep]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]     = useState(false)
  const [error, setError]         = useState('')

  const cameraRef = useRef(null)

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!crewMember) { setError('Please select your name.'); return }
    if (!jobId) { setError('Please select a job.'); return }
    if (!phase) { setError('Please select a phase.'); return }

    setError('')
    setSubmitting(true)

    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      const photoUrls = await uploadPhotos(dateStr, jobId)

      const job = activeJobs.find(j => j.id === jobId)

      await addDailyReport({
        crewMember,
        jobId,
        jobName: job?.name || jobId,
        date: dateStr,
        phase,
        workCompleted: Object.keys(workDone).filter(k => workDone[k]),
        photoUrls,
        materialsUsed: matUsed.trim(),
        materialsNeeded: matNeeded.trim(),
        blocker,
        inspectionReady: inspReady,
        nextStep: nextStep.trim(),
      })

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
    setInspReady(null); setNextStep(''); setSuccess(false); setError('')
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ backgroundColor: '#22c55e22' }}>
          <CheckCircleIcon size={40} color="#22c55e" />
        </div>
        <div>
          <p className="text-2xl font-bold text-white mb-1">Report Submitted</p>
          <p className="text-zinc-400 text-sm">Your crew daily report has been saved.</p>
        </div>
        <Button onClick={reset}
          className="font-bold px-8"
          style={{ backgroundColor: O, color: '#fff' }}>
          Submit Another
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-white">Crew Daily Report</h1>
        <p className="text-zinc-400 text-sm mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Crew Member */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Who are you?</label>
        <Select value={crewMember} onValueChange={setCrewMember}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white">
            <SelectValue placeholder="Select your name…" />
          </SelectTrigger>
          <SelectContent>
            {CREW_LIST.map(name => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Job */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Job</label>
        <Select value={jobId} onValueChange={setJobId}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white">
            <SelectValue placeholder="Select job…" />
          </SelectTrigger>
          <SelectContent>
            {activeJobs.map(j => (
              <SelectItem key={j.id} value={j.id}>
                {j.id} — {j.name || j.client}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Phase */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Phase</label>
        <Select value={phase} onValueChange={setPhase}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white">
            <SelectValue placeholder="Select phase…" />
          </SelectTrigger>
          <SelectContent>
            {PHASES.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Work completed */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Work Completed Today</label>
        <div className="bg-white/5 border border-white/10 rounded-lg px-4 divide-y divide-white/5">
          {WORK_ITEMS.map(item => (
            <Checkbox
              key={item.id}
              checked={!!workDone[item.id]}
              onChange={() => toggleWork(item.id)}
              label={item.label}
            />
          ))}
        </div>
      </div>

      {/* Photos */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Photos</label>
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
          className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/10 transition-colors text-sm text-zinc-300 w-full justify-center"
        >
          <CameraIcon size={18} />
          Add Photo
        </button>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {photos.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-white/10">
                <img src={p.preview} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
                >
                  <XIcon size={10} color="#fff" />
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length === 0 && (
          <div className="flex items-center gap-2 text-zinc-600 text-xs mt-1">
            <ImageIcon size={12} />
            No photos attached
          </div>
        )}
      </div>

      {/* Materials used */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Materials Used</label>
        <Textarea
          value={matUsed}
          onChange={e => setMatUsed(e.target.value)}
          placeholder="e.g. 12/2 Romex 50ft, 4 boxes, 2 GFCI outlets…"
          className="bg-white/5 border-white/10 text-white placeholder:text-zinc-600 resize-none"
          rows={2}
        />
      </div>

      {/* Materials needed */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Materials Needed for Next Visit</label>
        <Textarea
          value={matNeeded}
          onChange={e => setMatNeeded(e.target.value)}
          placeholder="e.g. 200A panel, 10/3 wire…"
          className="bg-white/5 border-white/10 text-white placeholder:text-zinc-600 resize-none"
          rows={2}
        />
      </div>

      {/* Blockers */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Blocker</label>
        <Select value={blocker} onValueChange={setBlocker}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLOCKER_OPTIONS.map(b => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Inspection ready */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Inspection Ready?</label>
        <div className="flex gap-3">
          {[true, false].map(val => (
            <button
              key={String(val)}
              type="button"
              onClick={() => setInspReady(val)}
              className="flex-1 py-2.5 rounded-lg border-2 font-bold text-sm transition-all"
              style={{
                borderColor: inspReady === val ? (val ? '#22c55e' : '#ef4444') : '#374151',
                backgroundColor: inspReady === val ? (val ? '#22c55e22' : '#ef444422') : 'transparent',
                color: inspReady === val ? (val ? '#22c55e' : '#ef4444') : '#6b7280',
              }}
            >
              {val ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>

      {/* Next step */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Next Step</label>
        <Input
          value={nextStep}
          onChange={e => setNextStep(e.target.value)}
          placeholder="e.g. Trim panel, schedule final inspection…"
          className="bg-white/5 border-white/10 text-white placeholder:text-zinc-600"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* Submit */}
      <Button
        type="submit"
        disabled={submitting}
        className="w-full h-12 text-base font-black tracking-wide"
        style={{ backgroundColor: O, color: '#fff' }}
      >
        {submitting
          ? <span className="flex items-center gap-2"><LoaderIcon size={16} className="animate-spin" /> Submitting…</span>
          : 'Submit Report'}
      </Button>
    </form>
  )
}
