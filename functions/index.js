// ============================================================================
//  P2 Field Control — Cloud Functions
//  QuickBooks Online OAuth (Intuit OAuth 2.0)
//  CompanyCam OAuth (Doorkeeper OAuth 2.0)
// ============================================================================
//
//  QuickBooks functions:
//    qbAuth        — Returns an Intuit OAuth2 authorization URL for the
//                    frontend to redirect to. Stores a one-time `state` token
//                    in Firestore so the callback can verify it.
//    qbCallback    — Receives { code, state, realmId } from the redirect,
//                    verifies state, exchanges the code for access + refresh
//                    tokens, persists them at qb_config/tokens.
//    qbDisconnect  — Revokes the refresh token at Intuit and deletes the
//                    Firestore tokens doc.
//
//  CompanyCam functions (mirror the QuickBooks flow):
//    ccAuth        — Returns a CompanyCam OAuth2 authorization URL. Stores a
//                    one-time `state` token at cc_config/oauth_states.
//    ccCallback    — Receives { code, state } from the redirect (CompanyCam
//                    does NOT return a realmId — that absence is how the
//                    frontend tells a CompanyCam callback apart from QB),
//                    verifies state, exchanges the code, persists tokens at
//                    cc_config/tokens.
//    ccDisconnect  — Revokes the token at CompanyCam and deletes the doc.
//
//  Required Firebase secrets (set with `firebase functions:secrets:set`):
//    QB_CLIENT_ID       — Intuit app's Client ID
//    QB_CLIENT_SECRET   — Intuit app's Client Secret
//    CC_CLIENT_ID       — CompanyCam app's Client ID
//    CC_CLIENT_SECRET   — CompanyCam app's Client Secret
//
//  Optional environment via `firebase functions:config:set` or hardcoded:
//    QB_ENV             — 'sandbox' | 'production' (default 'production')
//    QB_REDIRECT_URI    — full redirect URL configured in Intuit dashboard
//                         (default: https://p2-dashboard.web.app/)
//    CC_REDIRECT_URI    — full redirect URL configured in CompanyCam dashboard
//                         (default: https://p2-dashboard.web.app/)
//    CC_SCOPES          — space-separated CompanyCam scopes (default 'read')
//
//  The redirect URIs you register at developer.intuit.com and
//  app.companycam.com MUST match QB_REDIRECT_URI / CC_REDIRECT_URI exactly
//  (including trailing slash and protocol).
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

initializeApp()
const db = getFirestore()

// ── Secrets ───────────────────────────────────────────────────────────────────
const QB_CLIENT_ID     = defineSecret('QB_CLIENT_ID')
const QB_CLIENT_SECRET = defineSecret('QB_CLIENT_SECRET')
const CC_CLIENT_ID     = defineSecret('CC_CLIENT_ID')
const CC_CLIENT_SECRET = defineSecret('CC_CLIENT_SECRET')

// ── Configuration ─────────────────────────────────────────────────────────────
const QB_ENV          = process.env.QB_ENV || 'production'  // 'sandbox' | 'production'
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || 'https://p2-dashboard.web.app/'
const QB_SCOPES       = 'com.intuit.quickbooks.accounting'

// Intuit endpoints (same for sandbox & prod — environment is determined by which
// Intuit App Key set you provide via QB_CLIENT_ID / QB_CLIENT_SECRET).
const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const INTUIT_TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const INTUIT_REVOKE_URL    = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

// CompanyCam OAuth (Doorkeeper). Photo sync only needs the `read` scope.
const CC_REDIRECT_URI = process.env.CC_REDIRECT_URI || 'https://p2-dashboard.web.app/'
const CC_SCOPES       = process.env.CC_SCOPES || 'read'
const CC_AUTHORIZE_URL = 'https://app.companycam.com/oauth/authorize'
const CC_TOKEN_URL     = 'https://app.companycam.com/oauth/token'
const CC_REVOKE_URL    = 'https://app.companycam.com/oauth/revoke'

const STATE_TTL_MS = 10 * 60 * 1000  // OAuth states are valid for 10 minutes

const region = 'us-central1'
const callableOpts = {
  region,
  cors: true,
  secrets: [QB_CLIENT_ID, QB_CLIENT_SECRET],
}
const ccCallableOpts = {
  region,
  cors: true,
  secrets: [CC_CLIENT_ID, CC_CLIENT_SECRET],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const requireAuth = (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to manage QuickBooks.')
  }
  return req.auth
}

const basicAuth = () =>
  'Basic ' + Buffer.from(`${QB_CLIENT_ID.value()}:${QB_CLIENT_SECRET.value()}`).toString('base64')

// ── qbAuth ────────────────────────────────────────────────────────────────────
// Generates a one-time `state` token, stores it, and returns the Intuit
// authorization URL. Frontend then does `window.location.href = data.authUrl`.
export const qbAuth = onCall(callableOpts, async (req) => {
  const auth = requireAuth(req)

  const state = randomBytes(24).toString('hex')
  await db.collection('qb_config').doc('oauth_states').set(
    { [state]: { uid: auth.uid, createdAt: FieldValue.serverTimestamp() } },
    { merge: true },
  )

  const params = new URLSearchParams({
    client_id:     QB_CLIENT_ID.value(),
    response_type: 'code',
    scope:         QB_SCOPES,
    redirect_uri:  QB_REDIRECT_URI,
    state,
  })
  const authUrl = `${INTUIT_AUTHORIZE_URL}?${params.toString()}`
  return { authUrl, env: QB_ENV }
})

// ── qbCallback ────────────────────────────────────────────────────────────────
// Frontend extracts ?code=…&state=…&realmId=… from the redirect URL and
// posts them here. We verify state, exchange the code for tokens, and persist.
export const qbCallback = onCall(callableOpts, async (req) => {
  const auth = requireAuth(req)
  const { code, state, realmId } = req.data || {}

  if (!code || !state || !realmId) {
    throw new HttpsError('invalid-argument', 'Missing OAuth parameters from Intuit redirect.')
  }

  // ── Verify state ──────────────────────────────────────────────────────────
  const stateRef  = db.collection('qb_config').doc('oauth_states')
  const stateSnap = await stateRef.get()
  const stateMap  = stateSnap.exists ? (stateSnap.data() || {}) : {}
  const stateRec  = stateMap[state]

  if (!stateRec) {
    throw new HttpsError('failed-precondition', 'OAuth state expired or invalid. Try connecting again.')
  }
  const stateAge = Date.now() - (stateRec.createdAt?.toMillis?.() || 0)
  if (stateAge > STATE_TTL_MS) {
    await stateRef.update({ [state]: FieldValue.delete() })
    throw new HttpsError('failed-precondition', 'OAuth state expired. Try connecting again.')
  }
  if (stateRec.uid && stateRec.uid !== auth.uid) {
    throw new HttpsError('permission-denied', 'OAuth state belongs to a different user.')
  }
  // Burn the state so it can't be replayed
  await stateRef.update({ [state]: FieldValue.delete() })

  // ── Exchange code for tokens ──────────────────────────────────────────────
  const body = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: QB_REDIRECT_URI,
  })
  const tokenRes = await fetch(INTUIT_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Authorization': basicAuth(),
      'Accept':        'application/json',
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '')
    console.error('[qbCallback] Token exchange failed:', tokenRes.status, errText)
    throw new HttpsError('internal', 'Intuit token exchange failed. Try again.')
  }
  const tokens = await tokenRes.json()
  // tokens = { token_type, access_token, refresh_token, expires_in, x_refresh_token_expires_in }

  // ── Persist ───────────────────────────────────────────────────────────────
  const now = Date.now()
  await db.collection('qb_config').doc('tokens').set({
    access_token:            tokens.access_token,
    refresh_token:           tokens.refresh_token,
    expires_at:              now + (tokens.expires_in * 1000),
    refresh_expires_at:      now + (tokens.x_refresh_token_expires_in * 1000),
    realmId,
    env:                     QB_ENV,
    connectedAt:             FieldValue.serverTimestamp(),
    connectedBy:             auth.uid,
    connectedByEmail:        auth.token?.email || null,
  })

  return { ok: true, realmId, env: QB_ENV }
})

// ── qbDisconnect ──────────────────────────────────────────────────────────────
// Revokes the refresh token at Intuit and deletes the local tokens doc.
export const qbDisconnect = onCall(callableOpts, async (req) => {
  requireAuth(req)

  const ref  = db.collection('qb_config').doc('tokens')
  const snap = await ref.get()
  if (!snap.exists) {
    return { ok: true, alreadyDisconnected: true }
  }
  const refresh = snap.data()?.refresh_token

  if (refresh) {
    try {
      const res = await fetch(INTUIT_REVOKE_URL, {
        method:  'POST',
        headers: {
          'Authorization': basicAuth(),
          'Accept':        'application/json',
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ token: refresh }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        console.warn('[qbDisconnect] Revoke returned non-OK (deleting anyway):', res.status, txt)
      }
    } catch (err) {
      console.warn('[qbDisconnect] Revoke threw (deleting anyway):', err.message)
    }
  }

  await ref.delete()
  return { ok: true }
})

// ============================================================================
//  CompanyCam photo sync
//  Pulls photos from CompanyCam, matches projects to P2 jobs by street
//  address, and writes photo references into jobs/{jobDocId}/files. The client
//  portal and document views already render that subcollection.
// ============================================================================

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
  requireAuth(req)
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

// ============================================================================
//  CompanyCam OAuth — mirrors the QuickBooks flow above.
//  Tokens live at cc_config/tokens; one-time states at cc_config/oauth_states.
// ============================================================================

// ── ccAuth ──────────────────────────────────────────────────────────────────
// Generates a one-time `state` token, stores it, and returns the CompanyCam
// authorization URL. Frontend then does `window.location.href = data.authUrl`.
export const ccAuth = onCall(ccCallableOpts, async (req) => {
  const auth = requireAuth(req)

  const state = randomBytes(24).toString('hex')
  await db.collection('cc_config').doc('oauth_states').set(
    { [state]: { uid: auth.uid, createdAt: FieldValue.serverTimestamp() } },
    { merge: true },
  )

  const params = new URLSearchParams({
    client_id:     CC_CLIENT_ID.value(),
    response_type: 'code',
    scope:         CC_SCOPES,
    redirect_uri:  CC_REDIRECT_URI,
    state,
  })
  const authUrl = `${CC_AUTHORIZE_URL}?${params.toString()}`
  return { authUrl }
})

// ── ccCallback ────────────────────────────────────────────────────────────────
// Frontend extracts ?code=…&state=… from the redirect URL and posts them here.
// CompanyCam does not return a realmId — the frontend uses that absence to route
// the redirect to this function rather than qbCallback.
export const ccCallback = onCall(ccCallableOpts, async (req) => {
  const auth = requireAuth(req)
  const { code, state } = req.data || {}

  if (!code || !state) {
    throw new HttpsError('invalid-argument', 'Missing OAuth parameters from CompanyCam redirect.')
  }

  // ── Verify state ──────────────────────────────────────────────────────────
  const stateRef  = db.collection('cc_config').doc('oauth_states')
  const stateSnap = await stateRef.get()
  const stateMap  = stateSnap.exists ? (stateSnap.data() || {}) : {}
  const stateRec  = stateMap[state]

  if (!stateRec) {
    throw new HttpsError('failed-precondition', 'OAuth state expired or invalid. Try connecting again.')
  }
  const stateAge = Date.now() - (stateRec.createdAt?.toMillis?.() || 0)
  if (stateAge > STATE_TTL_MS) {
    await stateRef.update({ [state]: FieldValue.delete() })
    throw new HttpsError('failed-precondition', 'OAuth state expired. Try connecting again.')
  }
  if (stateRec.uid && stateRec.uid !== auth.uid) {
    throw new HttpsError('permission-denied', 'OAuth state belongs to a different user.')
  }
  // Burn the state so it can't be replayed
  await stateRef.update({ [state]: FieldValue.delete() })

  // ── Exchange code for tokens ──────────────────────────────────────────────
  // Doorkeeper expects client credentials in the form body.
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  CC_REDIRECT_URI,
    client_id:     CC_CLIENT_ID.value(),
    client_secret: CC_CLIENT_SECRET.value(),
  })
  const tokenRes = await fetch(CC_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Accept':       'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '')
    console.error('[ccCallback] Token exchange failed:', tokenRes.status, errText)
    throw new HttpsError('internal', 'CompanyCam token exchange failed. Try again.')
  }
  const tokens = await tokenRes.json()
  // tokens = { token_type, access_token, refresh_token, expires_in, scope, created_at }

  // ── Persist ───────────────────────────────────────────────────────────────
  const now = Date.now()
  await db.collection('cc_config').doc('tokens').set({
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token || null,
    // CompanyCam tokens may be long-lived (no expires_in) — only stamp expiry when given.
    expires_at:       tokens.expires_in ? now + (tokens.expires_in * 1000) : null,
    scope:            tokens.scope || CC_SCOPES,
    connectedAt:      FieldValue.serverTimestamp(),
    connectedBy:      auth.uid,
    connectedByEmail: auth.token?.email || null,
  })

  return { ok: true }
})

// ── ccDisconnect ────────────────────────────────────────────────────────────────
// Revokes the access token at CompanyCam and deletes the local tokens doc.
export const ccDisconnect = onCall(ccCallableOpts, async (req) => {
  requireAuth(req)

  const ref  = db.collection('cc_config').doc('tokens')
  const snap = await ref.get()
  if (!snap.exists) {
    return { ok: true, alreadyDisconnected: true }
  }
  const token = snap.data()?.access_token

  if (token) {
    try {
      const body = new URLSearchParams({
        token,
        client_id:     CC_CLIENT_ID.value(),
        client_secret: CC_CLIENT_SECRET.value(),
      })
      const res = await fetch(CC_REVOKE_URL, {
        method:  'POST',
        headers: {
          'Accept':       'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        console.warn('[ccDisconnect] Revoke returned non-OK (deleting anyway):', res.status, txt)
      }
    } catch (err) {
      console.warn('[ccDisconnect] Revoke threw (deleting anyway):', err.message)
    }
  }

  await ref.delete()
  return { ok: true }
})
