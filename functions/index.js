// ============================================================================
//  P2 Field Control — Cloud Functions
//  QuickBooks Online OAuth (Intuit OAuth 2.0)
//  CompanyCam OAuth (Doorkeeper OAuth 2.0)
// ============================================================================
//
//  This file only re-exports. Each function lives in a module of its own:
//    oauth-quickbooks.js   qbAuth, qbCallback, qbDisconnect
//    oauth-companycam.js   ccAuth, ccCallback, ccDisconnect
//    companycam-sync.js    ccSyncPhotos, ccSyncPhotosScheduled
//    push.js               onNotificationCreated
//
//  Shared code lives in lib/:
//    admin.js              initializes the Admin SDK once and exports `db`
//    secrets.js            the four defineSecret instances
//    config.js             region and constants used by more than one module
//    authz.js              requireAuth, requireStaff, requireOwner (callable guards)
//    roles.js              VALID_ROLES, isStaff, isOwner, claimsOf, mergeUserDoc (pure)
//    scope.js              scopeForJob, canReadJob, canActOnExtra (pure)
//    push-targets.js       targetTokens, groupTokens (pure)
//
//  Firebase deploys only what is exported here, and a deployed function that
//  stops being exported is deleted on the next deploy. Add every new function
//  to this file, and never drop or rename an existing one (test/exports.test.js
//  pins the current set).
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

export { qbAuth, qbCallback, qbDisconnect } from './oauth-quickbooks.js'
export { ccAuth, ccCallback, ccDisconnect } from './oauth-companycam.js'
export { ccSyncPhotos, ccSyncPhotosScheduled } from './companycam-sync.js'
export { onNotificationCreated } from './push.js'
