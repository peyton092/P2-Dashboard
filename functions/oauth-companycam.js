// ============================================================================
//  CompanyCam OAuth (Doorkeeper OAuth 2.0). Mirrors the QuickBooks flow in
//  oauth-quickbooks.js. Tokens live at cc_config/tokens; one-time states at
//  cc_config/oauth_states.
//
//    ccAuth        — Returns a CompanyCam OAuth2 authorization URL. Stores a
//                    one-time `state` token at cc_config/oauth_states.
//    ccCallback    — Receives { code, state } from the redirect (CompanyCam
//                    does NOT return a realmId — that absence is how the
//                    frontend tells a CompanyCam callback apart from QB),
//                    verifies state, exchanges the code, persists tokens at
//                    cc_config/tokens.
//    ccDisconnect  — Revokes the token at CompanyCam and deletes the doc.
//
//  All three are staff only: requireStaff runs before anything is read.
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { db } from './lib/admin.js'
import { requireStaff } from './lib/authz.js'
import { CC_CLIENT_ID, CC_CLIENT_SECRET } from './lib/secrets.js'
import { STATE_TTL_MS, CC_TOKEN_URL, ccCallableOpts } from './lib/config.js'

// ── Configuration ─────────────────────────────────────────────────────────────
// CompanyCam OAuth (Doorkeeper). Photo sync only needs the `read` scope.
const CC_REDIRECT_URI = process.env.CC_REDIRECT_URI || 'https://p2-dashboard.web.app/'
const CC_SCOPES       = process.env.CC_SCOPES || 'read'
const CC_AUTHORIZE_URL = 'https://app.companycam.com/oauth/authorize'
const CC_REVOKE_URL    = 'https://app.companycam.com/oauth/revoke'

// ── ccAuth ──────────────────────────────────────────────────────────────────
// Generates a one-time `state` token, stores it, and returns the CompanyCam
// authorization URL. Frontend then does `window.location.href = data.authUrl`.
export const ccAuth = onCall(ccCallableOpts, async (req) => {
  await requireStaff(req)
  const auth = req.auth

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
  await requireStaff(req)
  const auth = req.auth
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
  await requireStaff(req)

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
