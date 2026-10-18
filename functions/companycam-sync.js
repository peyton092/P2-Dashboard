// ============================================================================
//  CompanyCam photo sync
//  Pulls photos from CompanyCam, matches projects to P2 jobs by street
//  address, and writes photo references into jobs/{jobDocId}/files. The client
//  portal and document views already render that subcollection. The ccSyncPhotos
//  callable is staff only: requireStaff runs before anything is read.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './lib/admin.js'
import { requireStaff } from './lib/authz.js'
import { CC_CLIENT_ID, CC_CLIENT_SECRET } from './lib/secrets.js'
import { region, CC_TOKEN_URL, ccCallableOpts } from './lib/config.js'

const CC_API_BASE = 'https://api.companycam.com/v2'

// Street-suffix abbreviations → canonical short form, so "Drive" and "Dr"
// (etc.) compare equal when matching CompanyCam addresses to P2 job addresses.
const STREET_SUFFIX = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln', boulevard: 'blvd', blvd: 'blvd',
  court: 'ct', ct: 'ct', circle: 'cir', cir: 'cir', way: 'way', place: 'pl', pl: 'pl',
  terrace: 'ter', ter: 'ter', parkway: 'pkwy', pkwy: 'pkwy', cove: 'cv', cv: 'cv',
  trail: 'trl', trl: 'trl', highway: 'hwy', hwy: 'hwy', crossing: 'xing', xing: 'xing',
}

function normAddr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .map(w => STREET_SUFFIX[w] || w)
    .filter(Boolean)
    .join(' ')
    .trim()
}

// Tolerant address match: exact normalized equality, prefix containment, or
// matching "<number> <first street word>" core.
function addrMatches(jobAddr, ccAddr) {
  const a = normAddr(jobAddr)
  const b = normAddr(ccAddr)
  if (!a || !b) return false
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true
  const core = (s) => s.split(' ').slice(0, 2).join(' ')
  return core(a) === core(b) && /\d/.test(core(a))
}

// Refresh the CompanyCam access token if it's expired; returns a valid token.
async function getValidCcToken() {
  const ref = db.collection('cc_config').doc('tokens')
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('failed-precondition', 'CompanyCam is not connected.')
  const t = snap.data() || {}
  if (!t.access_token) throw new HttpsError('failed-precondition', 'CompanyCam is not connected.')

  const notExpired = !t.expires_at || t.expires_at - Date.now() > 60_000
  if (notExpired) return t.access_token
  if (!t.refresh_token) return t.access_token // long-lived token without expiry info

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: t.refresh_token,
    client_id:     CC_CLIENT_ID.value(),
    client_secret: CC_CLIENT_SECRET.value(),
  })
  const res = await fetch(CC_TOKEN_URL, {
    method:  'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    console.warn('[cc] Token refresh failed:', res.status, await res.text().catch(() => ''))
    return t.access_token
  }
  const fresh = await res.json()
  const now = Date.now()
  await ref.set({
    access_token:  fresh.access_token,
    refresh_token: fresh.refresh_token || t.refresh_token,
    expires_at:    fresh.expires_in ? now + fresh.expires_in * 1000 : null,
  }, { merge: true })
  return fresh.access_token
}

async function ccGet(path, token, params = {}) {
  const url = new URL(`${CC_API_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`CompanyCam ${path} → ${res.status} ${txt.slice(0, 200)}`)
  }
  return res.json()
}

// Core sync routine — shared by the callable and the scheduled function.
async function syncCompanyCamPhotos() {
  const token = await getValidCcToken()

  // 1. Pull all CompanyCam projects (paginated).
  const projects = []
  for (let page = 1; page <= 20; page++) {
    const batch = await ccGet('/projects', token, { page, per_page: 100 })
    if (!Array.isArray(batch) || batch.length === 0) break
    projects.push(...batch)
    if (batch.length < 100) break
  }

  // 2. Load P2 jobs and index by normalized address.
  const jobsSnap = await db.collection('jobs').get()
  const jobs = jobsSnap.docs.map(d => ({ docId: d.id, ...d.data() }))

  let matchedProjects = 0
  let photosWritten = 0
  const unmatched = []

  for (const proj of projects) {
    const ccAddrParts = proj.address || {}
    const ccAddr = ccAddrParts.street_address_1 || proj.name || ''
    const job = jobs.find(j => addrMatches(j.address, ccAddr))
    if (!job) { unmatched.push(ccAddr); continue }
    matchedProjects++

    // 3. Pull photos for this project (paginated) and write references.
    for (let page = 1; page <= 20; page++) {
      const photos = await ccGet(`/projects/${proj.id}/photos`, token, { page, per_page: 100 })
      if (!Array.isArray(photos) || photos.length === 0) break

      const writer = db.batch()
      for (const photo of photos) {
        const uris = Array.isArray(photo.uris) ? photo.uris : []
        const pick = (type) => uris.find(u => u.type === type)?.uri
        const url = pick('web') || pick('original') || uris[0]?.uri
        if (!url) continue
        const fileRef = db.collection('jobs').doc(job.docId).collection('files').doc(`cc_${photo.id}`)
        writer.set(fileRef, {
          name:              `CompanyCam ${photo.id}`,
          url,
          thumbUrl:          pick('thumbnail') || url,
          type:              'image/jpeg',
          source:            'companycam',
          companyCamPhotoId: String(photo.id),
          companyCamProject: String(proj.id),
          capturedAt:        photo.captured_at ? new Date(photo.captured_at * 1000).toISOString() : null,
          creator:           photo.creator_name || null,
          createdAt:         FieldValue.serverTimestamp(),
        }, { merge: true })
        photosWritten++
      }
      await writer.commit()
      if (photos.length < 100) break
    }
  }

  const result = {
    projects: projects.length,
    matchedProjects,
    photosWritten,
    unmatchedSample: unmatched.slice(0, 10),
    syncedAt: new Date().toISOString(),
  }
  await db.collection('cc_config').doc('sync').set(result, { merge: true })
  return result
}

// ── ccSyncPhotos (manual trigger from Settings) ───────────────────────────────
export const ccSyncPhotos = onCall(ccCallableOpts, async (req) => {
  await requireStaff(req)
  try {
    return { ok: true, ...(await syncCompanyCamPhotos()) }
  } catch (e) {
    console.error('[ccSyncPhotos] failed:', e)
    if (e instanceof HttpsError) throw e
    throw new HttpsError('internal', 'CompanyCam photo sync failed. Try again.')
  }
})

// ── ccSyncPhotosScheduled (every 6 hours) ─────────────────────────────────────
export const ccSyncPhotosScheduled = onSchedule(
  { schedule: 'every 6 hours', region, secrets: [CC_CLIENT_ID, CC_CLIENT_SECRET] },
  async () => {
    try {
      const snap = await db.collection('cc_config').doc('tokens').get()
      if (!snap.exists || !snap.data()?.access_token) return // not connected — skip
      await syncCompanyCamPhotos()
    } catch (e) {
      console.error('[ccSyncPhotosScheduled] failed:', e)
    }
  },
)
