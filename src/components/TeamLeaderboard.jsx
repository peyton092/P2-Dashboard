import { useState, useEffect, useMemo } from 'react'
import { doc, onSnapshot, setDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useDailyReports } from '../hooks/useFirestore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  TrophyIcon, StarIcon, UserPlusIcon, ZapIcon, XIcon,
  ClipboardListIcon, ShieldCheckIcon, CameraIcon, TrendingUpIcon,
  ChevronDownIcon, ChevronUpIcon, LinkIcon, CheckIcon, SettingsIcon,
} from 'lucide-react'

const O = '#F47920'

const CREW = ['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor']

const ROLES = {
  Austin: 'Lead Electrician',
  Tony:   'Electrician',
  Marvin: 'Electrician',
  Trent:  'Apprentice',
  Ty:     'Apprentice',
  Trevor: 'Field Tech',
}

const PTS = { report: 5, task: 2, inspReady: 15, photo: 5, noBlocker: 5, review: 50, referral: 150 }
const MEDALS = ['🥇', '🥈', '🥉']

const CURRENT_MONTH = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

function getMonthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999) }
}

function reportDate(r) {
  if (r.createdAt?.toDate) return r.createdAt.toDate()
  if (r.date) return new Date(r.date + 'T12:00:00')
  return new Date(0)
}

function autoScore(reports) {
  let pts = 0; let reportCount = 0; let taskCount = 0; let inspReadyCount = 0; let photoCount = 0; let noBlockerCount = 0
  reports.forEach(r => {
    pts += PTS.report
    const tasks = (r.workCompleted || []).length
    pts += tasks * PTS.task
    if (r.inspectionReady === true) { pts += PTS.inspReady; inspReadyCount++ }
    if ((r.photoUrls || []).length > 0) { pts += PTS.photo; photoCount++ }
    if (!r.blocker || r.blocker === 'None') { pts += PTS.noBlocker; noBlockerCount++ }
    reportCount++
    taskCount += tasks
  })
  return { pts, reportCount, taskCount, inspReadyCount, photoCount, noBlockerCount }
}

// ── Firestore hooks ────────────────────────────────────────────────────────────

function useCrewScores() {
  const [scores, setScores] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let pending = CREW.length
    const unsubs = CREW.map(name => {
      const id = name.toLowerCase()
      const ref = doc(db, 'crew_scores', id)
      return onSnapshot(ref, async snap => {
        if (!snap.exists()) {
          await setDoc(ref, {
            name, id, role: ROLES[name],
            googleReviews: 0, referrals: 0, bonusPoints: 0, bonusNote: '',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
        } else {
          setScores(prev => ({ ...prev, [name]: snap.data() }))
        }
        pending--
        if (pending <= 0) setLoading(false)
      }, () => { pending--; if (pending <= 0) setLoading(false) })
    })
    return () => unsubs.forEach(u => u())
  }, [])

  return { scores, loading }
}

async function patchScore(name, updates) {
  await updateDoc(doc(db, 'crew_scores', name.toLowerCase()), {
    ...updates, updatedAt: serverTimestamp(),
  })
}

function useReviewUrl() {
  const [url, setUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const ref = doc(db, 'app_settings', 'google_review')

  useEffect(() => {
    getDoc(ref).then(snap => {
      if (snap.exists()) setUrl(snap.data().url || '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  async function saveUrl(val) {
    await setDoc(ref, { url: val, updatedAt: serverTimestamp() }, { merge: true })
    setUrl(val)
  }

  return { url, loaded, saveUrl }
}

// ── Small UI pieces ────────────────────────────────────────────────────────────

function Chip({ color, icon: Icon, children }) {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
      style={{ backgroundColor: color + '18', color }}>
      {Icon && <Icon size={9} />} {children}
    </span>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-lg font-semibold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-600">{sub}</p>}
    </div>
  )
}

function ReviewLinkPanel({ name, url, onClose }) {
  const [copied, setCopied] = useState(false)
  const msg = `Hi! Could you take 30 seconds to leave us a Google review? It really helps the team. Here's the link: ${url} — Thanks, ${name} @ P2 Field Services`

  function copyLink() {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  function copyMsg() {
    navigator.clipboard.writeText(msg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  if (!url) return (
    <div className="mx-4 mb-3 p-3 rounded-lg border text-xs text-zinc-400"
      style={{ borderColor: '#ffffff15', backgroundColor: '#ffffff08' }}>
      No Google Review URL set. Configure it in the link settings above.
      <button onClick={onClose} className="ml-3 underline text-zinc-500">Close</button>
    </div>
  )

  return (
    <div className="mx-4 mb-3 p-3 rounded-lg border space-y-2"
      style={{ backgroundColor: '#eab30811', borderColor: '#eab30830' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-yellow-400 flex items-center gap-1.5">
          <StarIcon size={12} /> Google Review Link — {name}
        </span>
        <button onClick={onClose} className="p-0.5 hover:bg-white/10 rounded">
          <XIcon size={12} color="#6b7280" />
        </button>
      </div>
      <div className="flex items-center gap-2 bg-white/5 rounded p-2">
        <span className="text-xs text-zinc-400 truncate flex-1">{url}</span>
        <button onClick={copyLink}
          className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
          style={{ backgroundColor: copied ? '#22c55e22' : '#ffffff11', color: copied ? '#22c55e' : '#9ca3af' }}>
          {copied ? <CheckIcon size={11} /> : <LinkIcon size={11} />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <div className="bg-white/5 rounded p-2">
        <p className="text-[11px] text-zinc-400 mb-1.5">Pre-written text message:</p>
        <p className="text-[11px] text-zinc-300 leading-relaxed">{msg}</p>
        <button onClick={copyMsg}
          className="mt-2 text-[11px] px-2 py-1 rounded flex items-center gap-1"
          style={{ backgroundColor: '#eab30822', color: '#eab308' }}>
          <LinkIcon size={10} /> Copy full message
        </button>
      </div>
    </div>
  )
}

// ── Per-person expandable card ─────────────────────────────────────────────────

function CrewCard({ entry, idx, reviewUrl, isAdding, onSetAdding, onLogReview, onLogReferral, onLogBonus }) {
  const [expanded, setExpanded] = useState(false)
  const [showReviewLink, setShowReviewLink] = useState(false)
  const { name, auto, man, totalPts } = entry
  const isLeader = idx === 0 && totalPts > 0
  const bonusPts = (man.googleReviews || 0) * PTS.review + (man.referrals || 0) * PTS.referral + (man.bonusPoints || 0)

  const open = isAdding?.name === name

  return (
    <div className="border-b border-white/5 last:border-0">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}>
        <span className="w-7 text-center font-black text-sm shrink-0"
          style={{ color: idx < 3 && totalPts > 0 ? O : '#6b7280' }}>
          {idx < 3 && totalPts > 0 ? MEDALS[idx] : `#${idx + 1}`}
        </span>

        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black shrink-0 border-2"
          style={{
            backgroundColor: isLeader ? O + '33' : '#ffffff11',
            color: isLeader ? O : '#9ca3af',
            borderColor: isLeader ? O + '66' : '#ffffff11',
          }}>
          {name[0]}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white">{name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-xs text-zinc-500">{ROLES[name]}</span>
            {auto.reportCount > 0 && <Chip color={O} icon={ClipboardListIcon}>{auto.reportCount} rpts</Chip>}
            {auto.inspReadyCount > 0 && <Chip color="#22c55e" icon={ShieldCheckIcon}>{auto.inspReadyCount} insp</Chip>}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {(man.googleReviews || 0) > 0 && <Chip color="#eab308" icon={StarIcon}>{man.googleReviews}</Chip>}
          {(man.referrals || 0) > 0 && <Chip color="#22c55e" icon={UserPlusIcon}>{man.referrals}</Chip>}
          {(man.bonusPoints || 0) > 0 && <Chip color={O} icon={ZapIcon}>+{man.bonusPoints}</Chip>}
        </div>

        <div className="text-right shrink-0 mr-1" onClick={e => e.stopPropagation()}>
          <p className="font-semibold text-base" style={{ color: isLeader ? O : '#e5e7eb' }}>{totalPts}</p>
          <p className="text-[10px] text-zinc-500">pts</p>
        </div>

        {/* Action buttons — stop propagation so they don't toggle expand */}
        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button title="Google Review link"
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: showReviewLink ? '#eab30822' : 'transparent', color: showReviewLink ? '#eab308' : '#6b7280' }}
            onClick={() => { setShowReviewLink(v => !v); onSetAdding(null) }}>
            <StarIcon size={12} />
          </button>
          <button title="+Referral"
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: open && isAdding?.type === 'referral' ? '#22c55e22' : 'transparent', color: open && isAdding?.type === 'referral' ? '#22c55e' : '#6b7280' }}
            onClick={() => onSetAdding(open && isAdding?.type === 'referral' ? null : { name, type: 'referral' })}>
            <UserPlusIcon size={12} />
          </button>
          <button title="+Bonus"
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: open && isAdding?.type === 'bonus' ? O + '22' : 'transparent', color: open && isAdding?.type === 'bonus' ? O : '#6b7280' }}
            onClick={() => onSetAdding(open && isAdding?.type === 'bonus' ? null : { name, type: 'bonus', value: '', note: '' })}>
            <ZapIcon size={12} />
          </button>
        </div>

        <div className="shrink-0 text-zinc-600" onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}>
          {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </div>
      </div>

      {/* Google review link panel */}
      {showReviewLink && (
        <ReviewLinkPanel name={name} url={reviewUrl} onClose={() => setShowReviewLink(false)} />
      )}

      {/* Referral confirm */}
      {open && isAdding?.type === 'referral' && (
        <div className="mx-4 mb-3 p-3 rounded-lg border flex items-center gap-3 flex-wrap"
          style={{ backgroundColor: '#22c55e11', borderColor: '#22c55e30' }}>
          <UserPlusIcon size={13} color="#22c55e" />
          <span className="text-sm text-white flex-1">Log +1 Referral for {name} <span className="text-zinc-400">(+{PTS.referral} pts)</span></span>
          <Button size="sm" className="h-7 text-xs" style={{ backgroundColor: '#22c55e', color: '#fff' }}
            onClick={() => onLogReferral(name)}>Confirm</Button>
          <button onClick={() => onSetAdding(null)} className="p-1 hover:bg-white/10 rounded">
            <XIcon size={13} color="#6b7280" />
          </button>
        </div>
      )}

      {/* Bonus panel */}
      {open && isAdding?.type === 'bonus' && (
        <div className="mx-4 mb-3 p-3 rounded-lg border flex flex-wrap items-center gap-2"
          style={{ backgroundColor: O + '11', borderColor: O + '33' }}>
          <ZapIcon size={13} color={O} />
          <Input type="number" min="1" placeholder="pts"
            className="w-20 h-7 text-xs bg-white/10 border-white/20"
            value={isAdding.value}
            onChange={e => onSetAdding(a => ({ ...a, value: e.target.value }))} />
          <Input placeholder="Reason (optional)"
            className="flex-1 min-w-32 h-7 text-xs bg-white/10 border-white/20"
            value={isAdding.note}
            onChange={e => onSetAdding(a => ({ ...a, note: e.target.value }))} />
          <Button size="sm" className="h-7 text-xs" style={{ backgroundColor: O, color: '#fff' }}
            onClick={() => onLogBonus(name, isAdding.value, isAdding.note)}>
            Award Bonus
          </Button>
          <button onClick={() => onSetAdding(null)} className="p-1 hover:bg-white/10 rounded">
            <XIcon size={13} color="#6b7280" />
          </button>
        </div>
      )}

      {/* Expanded score breakdown */}
      {expanded && (
        <div className="px-[4.5rem] pb-4 pt-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl border"
            style={{ backgroundColor: '#ffffff05', borderColor: '#ffffff0d' }}>
            <Stat label="Auto pts" value={auto.pts} sub="from reports" color={O} />
            <Stat label="Manual pts" value={bonusPts} sub="reviews + refs + bonus" color="#9ca3af" />
            <Stat label="Reports" value={auto.reportCount} sub={`${auto.taskCount} tasks logged`} color="#9ca3af" />
            <Stat label="Total" value={totalPts} sub="this month" color={isLeader ? O : '#e5e7eb'} />
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-zinc-500">
            <span>📋 {auto.reportCount} reports submitted (+{auto.reportCount * PTS.report})</span>
            <span>✅ {auto.taskCount} tasks completed (+{auto.taskCount * PTS.task})</span>
            {auto.inspReadyCount > 0 && <span className="text-green-600">🔍 {auto.inspReadyCount} inspection-ready flags (+{auto.inspReadyCount * PTS.inspReady})</span>}
            {auto.photoCount > 0 && <span>📷 {auto.photoCount} photo reports (+{auto.photoCount * PTS.photo})</span>}
            {auto.noBlockerCount > 0 && <span>⚡ {auto.noBlockerCount} no-blocker days (+{auto.noBlockerCount * PTS.noBlocker})</span>}
            {(man.googleReviews || 0) > 0 && <span className="text-yellow-500">⭐ {man.googleReviews} Google reviews (+{man.googleReviews * PTS.review})</span>}
            {(man.referrals || 0) > 0 && <span className="text-green-500">👥 {man.referrals} referrals (+{man.referrals * PTS.referral})</span>}
            {(man.bonusPoints || 0) > 0 && <span style={{ color: O }}>🎯 Bonus: +{man.bonusPoints}{man.bonusNote ? ` (${man.bonusNote})` : ''}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Podium ─────────────────────────────────────────────────────────────────────

function PodiumCard({ name, pts, rank }) {
  const isFirst = rank === 0
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="text-xl">{MEDALS[rank]}</span>
      <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold border-2"
        style={{
          backgroundColor: isFirst ? O + '33' : '#ffffff11',
          color: isFirst ? O : '#9ca3af',
          borderColor: isFirst ? O + '88' : '#ffffff22',
        }}>
        {name[0]}
      </div>
      <p className="text-xs font-bold text-white">{name}</p>
      <p className="text-[10px] text-zinc-500">{ROLES[name]}</p>
      <p className="font-semibold text-base mt-0.5" style={{ color: isFirst ? O : '#9ca3af' }}>{pts}</p>
      <p className="text-[10px] text-zinc-500">pts</p>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function TeamLeaderboard() {
  const { dailyReports, loading: reportsLoading } = useDailyReports()
  const { scores, loading: scoresLoading } = useCrewScores()
  const { url: reviewUrl, loaded: urlLoaded, saveUrl } = useReviewUrl()
  const [adding, setAdding] = useState(null)
  const [showUrlEdit, setShowUrlEdit] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)

  useEffect(() => { if (urlLoaded) setUrlDraft(reviewUrl) }, [urlLoaded, reviewUrl])

  const loading = reportsLoading || scoresLoading

  const { start: monthStart, end: monthEnd } = getMonthBounds(CURRENT_MONTH)

  const ranked = useMemo(() => {
    return CREW.map(name => {
      const myReports = dailyReports.filter(r => {
        if (r.crewMember !== name) return false
        const d = reportDate(r)
        return d >= monthStart && d <= monthEnd
      })
      const auto = autoScore(myReports)
      const man = scores[name] || {}
      const manPts = (man.googleReviews || 0) * PTS.review
        + (man.referrals || 0) * PTS.referral
        + (man.bonusPoints || 0)
      return { name, auto, man, totalPts: auto.pts + manPts }
    }).sort((a, b) => b.totalPts - a.totalPts || a.name.localeCompare(b.name))
  }, [dailyReports, scores, monthStart, monthEnd])

  const totalReviews   = ranked.reduce((s, r) => s + (r.man.googleReviews || 0), 0)
  const totalReferrals = ranked.reduce((s, r) => s + (r.man.referrals || 0), 0)
  const totalReports   = ranked.reduce((s, r) => s + r.auto.reportCount, 0)
  const monthLabel = new Date(CURRENT_MONTH + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  async function logReview(name) {
    const man = scores[name] || {}
    await patchScore(name, { googleReviews: (man.googleReviews || 0) + 1 })
    setAdding(null)
  }

  async function logReferral(name) {
    const man = scores[name] || {}
    await patchScore(name, { referrals: (man.referrals || 0) + 1 })
    setAdding(null)
  }

  async function logBonus(name, pts, note) {
    if (!Number(pts)) return
    const man = scores[name] || {}
    await patchScore(name, {
      bonusPoints: (man.bonusPoints || 0) + Number(pts),
      ...(note ? { bonusNote: note } : {}),
    })
    setAdding(null)
  }

  async function handleSaveUrl() {
    setSavingUrl(true)
    await saveUrl(urlDraft.trim())
    setSavingUrl(false)
    setShowUrlEdit(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full border-2 animate-spin"
        style={{ borderColor: O + '33', borderTopColor: O }} />
    </div>
  )

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: O + '22' }}>
            <TrophyIcon size={20} color={O} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Team Leaderboard</h2>
            <p className="text-xs text-zinc-400">{monthLabel} · Live standings</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            title="Configure Google Review URL"
            onClick={() => setShowUrlEdit(v => !v)}
            className="p-2 rounded-lg transition-colors"
            style={{ backgroundColor: showUrlEdit ? O + '22' : '#ffffff11', color: showUrlEdit ? O : '#6b7280' }}>
            <SettingsIcon size={14} />
          </button>
          <div className="px-3 py-1 rounded-full text-xs font-bold"
            style={{ backgroundColor: O + '22', color: O, border: `1px solid ${O}44` }}>
            ● Live
          </div>
        </div>
      </div>

      {/* Google Review URL config */}
      {showUrlEdit && (
        <Card className="border-white/10">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-bold text-zinc-400 mb-2 flex items-center gap-1.5">
              <StarIcon size={11} color="#eab308" /> Google Business Review URL
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://g.page/r/YOUR_PLACE_ID/review"
                className="flex-1 h-8 text-xs bg-white/10 border-white/20"
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
              />
              <Button size="sm" className="h-8 text-xs" style={{ backgroundColor: O, color: '#fff' }}
                disabled={savingUrl} onClick={handleSaveUrl}>
                {savingUrl ? 'Saving…' : 'Save'}
              </Button>
              <button onClick={() => setShowUrlEdit(false)} className="p-1.5 hover:bg-white/10 rounded">
                <XIcon size={13} color="#6b7280" />
              </button>
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Find your review link in Google Business Profile → Share review form.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Daily Reports', value: totalReports,   pts: null,                          icon: ClipboardListIcon, color: O          },
          { label: 'Google Reviews', value: totalReviews,  pts: totalReviews * PTS.review,      icon: StarIcon,          color: '#eab308'  },
          { label: 'Referrals',      value: totalReferrals, pts: totalReferrals * PTS.referral, icon: UserPlusIcon,      color: '#22c55e'  },
        ].map(s => (
          <Card key={s.label} className="border-white/10 bg-white/5">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={13} color={s.color} />
                <span className="text-xs text-zinc-400">{s.label}</span>
              </div>
              <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
              {s.pts != null && <p className="text-xs text-zinc-500 mt-0.5">{s.pts.toLocaleString()} pts earned</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Podium */}
      {ranked.slice(0, 3).some(r => r.totalPts > 0) && (
        <div className="flex items-end justify-center gap-8 py-2">
          {[ranked[1], ranked[0], ranked[2]].map((entry, podiumIdx) => {
            if (!entry) return null
            const actualRank = podiumIdx === 1 ? 0 : podiumIdx === 0 ? 1 : 2
            const marginTops = [32, 0, 48]
            return (
              <div key={entry.name} style={{ marginTop: marginTops[podiumIdx] }}>
                <PodiumCard name={entry.name} pts={entry.totalPts} rank={actualRank} />
              </div>
            )
          })}
        </div>
      )}

      {/* Full leaderboard */}
      <Card className="border-white/10 overflow-hidden">
        <CardHeader className="pb-2 border-b border-white/10">
          <CardTitle className="text-sm font-semibold text-zinc-300">Full Rankings — click row to expand breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ranked.map((entry, idx) => (
            <CrewCard
              key={entry.name}
              entry={entry}
              idx={idx}
              reviewUrl={reviewUrl}
              isAdding={adding?.name === entry.name ? adding : null}
              onSetAdding={setAdding}
              onLogReview={logReview}
              onLogReferral={logReferral}
              onLogBonus={logBonus}
            />
          ))}
        </CardContent>
      </Card>

      {/* Point system reference */}
      <Card className="border-white/10 bg-white/5">
        <CardContent className="pt-3 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUpIcon size={13} color={O} />
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Point System</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { icon: ClipboardListIcon, label: 'Daily report submitted',  pts: `+${PTS.report}`,      auto: true  },
              { icon: ZapIcon,           label: 'Per work item checked',   pts: `+${PTS.task}`,        auto: true  },
              { icon: ShieldCheckIcon,   label: 'Inspection ready flag',   pts: `+${PTS.inspReady}`,   auto: true  },
              { icon: CameraIcon,        label: 'Photos attached',         pts: `+${PTS.photo}`,       auto: true  },
              { icon: ZapIcon,           label: 'No blocker reported',     pts: `+${PTS.noBlocker}`,   auto: true  },
              { icon: StarIcon,          label: 'Google review',           pts: `+${PTS.review}`,      auto: false },
              { icon: UserPlusIcon,      label: 'Referral lead',           pts: `+${PTS.referral}`,    auto: false },
              { icon: ZapIcon,           label: 'Owner bonus',             pts: 'custom',              auto: false },
            ].map(({ icon: Icon, label, pts, auto }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Icon size={11} color={auto ? O : '#6b7280'} />
                  {label}
                  {auto && (
                    <span className="text-[9px] px-1 py-0.5 rounded font-bold"
                      style={{ backgroundColor: O + '22', color: O }}>auto</span>
                  )}
                </div>
                <span className="text-xs font-bold" style={{ color: O }}>{pts}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
