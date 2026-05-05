// ============================================================================
//  P2 Field Control — Cloud Functions
//  QuickBooks Online OAuth (Intuit OAuth 2.0)
// ============================================================================
//
//  Functions:
//    qbAuth        — Returns an Intuit OAuth2 authorization URL for the
//                    frontend to redirect to. Stores a one-time `state` token
//                    in Firestore so the callback can verify it.
//    qbCallback    — Receives { code, state, realmId } from the redirect,
//                    verifies state, exchanges the code for access + refresh
//                    tokens, persists them at qb_config/tokens.
//    qbDisconnect  — Revokes the refresh token at Intuit and deletes the
//                    Firestore tokens doc.
//
//  Required Firebase secrets (set with `firebase functions:secrets:set`):
//    QB_CLIENT_ID       — Intuit app's Client ID
//    QB_CLIENT_SECRET   — Intuit app's Client Secret
//
//  Optional environment via `firebase functions:config:set` or hardcoded:
//    QB_ENV             — 'sandbox' | 'production' (default 'production')
//    QB_REDIRECT_URI    — full redirect URL configured in Intuit dashboard
//                         (default: https://p2-dashboard.web.app/)
//
//  The redirect URI you register at developer.intuit.com MUST match
//  QB_REDIRECT_URI exactly (including trailing slash and protocol).
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

initializeApp()
const db = getFirestore()

// ── Secrets ───────────────────────────────────────────────────────────────────
const QB_CLIENT_ID     = defineSecret('QB_CLIENT_ID')
const QB_CLIENT_SECRET = defineSecret('QB_CLIENT_SECRET')

// ── Configuration ─────────────────────────────────────────────────────────────
const QB_ENV          = process.env.QB_ENV || 'production'  // 'sandbox' | 'production'
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || 'https://p2-dashboard.web.app/'
const QB_SCOPES       = 'com.intuit.quickbooks.accounting'

// Intuit endpoints (same for sandbox & prod — environment is determined by which
// Intuit App Key set you provide via QB_CLIENT_ID / QB_CLIENT_SECRET).
const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const INTUIT_TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const INTUIT_REVOKE_URL    = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

const STATE_TTL_MS = 10 * 60 * 1000  // OAuth states are valid for 10 minutes

const region = 'us-central1'
const callableOpts = {
  region,
  cors: true,
  secrets: [QB_CLIENT_ID, QB_CLIENT_SECRET],
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
