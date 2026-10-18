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
//    users.js              createUser, onUserWritten
//    extras.js             sendExtraToBuilder, approveExtra, rejectExtra
//    inspections.js        passInspection, failInspection
//    jobs.js               createJob
//    scope-sync.js         onJobWritten, onExtraWritten, onSubmitWritten, backfillScopes
//
//  Shared code lives in lib/:
//    admin.js              initializes the Admin SDK once and exports `db`
//    secrets.js            the four defineSecret instances
//    config.js             region and constants used by more than one module
//    authz.js              requireAuth, requireStaff, requireOwner (callable guards)
//    roles.js              VALID_ROLES, isStaff, isOwner, claimsOf, mergeUserDoc, wouldLowerStaff (pure)
//    scope.js              scopeForJob, canReadJob, canActOnExtra, nonEmptyString (pure)
//    scope-sync.js         scopePatchFor, needsRestamp, scopeChanged, jobIdOf, clientLinks (pure)
//    batches.js            chunks, JOB_ID_CHUNK, BATCH_SIZE (pure)
//    auth-claims.js        currentClaimRole (reads one account's custom claims)
//    push-targets.js       targetTokens, groupTokens (pure)
//    users-validate.js     validateNewUser (pure)
//    users-sync.js         claimsPatchFor (pure)
//    extras.js             extraState, extraTransition, extraActivity (pure)
//    inspections.js        TRADE_PHASES, validateInspection, inspectionPatch (pure)
//    jobs.js               validateNewJob, jobActivity (pure)
//    activity.js           notificationDoc, historyDoc (pure)
//    actor.js              buildActor (pure), actorOf (reads the caller's name)
//    doc-id.js             cleanDocId (pure)
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
//  User account functions:
//    createUser     Owner only callable. Takes { email, displayName, role,
//                   tenantId, clientJobIds }, creates the Auth user with a
//                   random password and the matching claims, writes
//                   users/{uid}, and returns { uid }. The browser then sends
//                   the person a password reset email so they set their own.
//    onUserWritten  Firestore trigger on users/{uid}. Reads the document as it
//                   is now (events can arrive late or out of order), sets the
//                   Auth custom claims { role, tenantId, clientJobIds } from it,
//                   links a client's uid into the clientUids of every job they
//                   list and out of any job that lists them but no longer
//                   should (all of them when the document goes), and revokes
//                   refresh tokens when an existing role changes or is removed.
//                   A new document never lowers an account that is already owner
//                   or internal: its claims are left as they are and the log says so.
//
//  Privileged actions. The browser no longer writes any of these itself; each
//  call checks the caller's role, makes the change, and writes the notification
//  and the history line together in one transaction. All return { ok: true }.
//    sendExtraToBuilder  Staff only. Takes { extraId }. Sends a change order (new,
//                        or revised after a rejection) to the builder.
//    approveExtra        Takes { extraId }. Approves a change order that is
//                        waiting for a decision. Allowed for whoever may act on
//                        it: staff, the builder of its tenant, its job's clients.
//    rejectExtra         Takes { extraId, note }. Asks for a revision; the note
//                        says what. Allowed for the same people.
//    passInspection      Staff only. Takes { jobDocId, trade, phase }. Marks one
//    failInspection      phase of one trade passed or failed, dated today.
//    createJob           Staff only. Takes the job from the New Job form (id like
//                        QBS-001, address, client, tenantId). Refuses an id that
//                        is taken. Returns { ok: true, docId }.
//
//  Scope stamping. A job's scope is { tenantId, clientUids }, and every change order,
//  submission and notification that names the job carries a copy, which the Firestore
//  rules read to decide who may see it. The job is where it comes from.
//    onJobWritten     Firestore trigger on jobs/{id}. When a job's tenantId or the set
//                     of uids in its clientUids changed, gives the scope to every change
//                     order (job), submission and notification (jobId) that names it and
//                     does not carry it, then looks at the job once more and stamps again
//                     if its scope moved meanwhile. A batch that fails is logged and the
//                     rest go on. A new job with no tenantId is stamped qbs on itself, in
//                     a transaction. A deleted job writes nothing.
//    onExtraWritten   Firestore triggers on extras/{id} and submits/{id}. Look the job
//    onSubmitWritten  up by its id and give the document its tenantId and clientUids
//                     when it lacks them or carries another job scope. A document that
//                     already carries it, one that names no job and one whose job is
//                     missing are not written, so none of these can fire itself.
//    backfillScopes   Owner only callable. Takes no data. Sets the Auth claims of every
//                     user with a role, from each user's document as it is when their turn
//                     comes (never lowering an owner or internal account), sets every job's
//                     tenantId (qbs when it has none) and clientUids (exactly the clients who
//                     list it, from a scan of the users taken after the claims), then stamps
//                     the change orders, submissions and notifications. Returns { ok: true,
//                     users, jobs, extras, submits, notifications, skipped }. Safe to run again.
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
export { createUser, onUserWritten } from './users.js'
export { sendExtraToBuilder, approveExtra, rejectExtra } from './extras.js'
export { passInspection, failInspection } from './inspections.js'
export { createJob } from './jobs.js'
export { onJobWritten, onExtraWritten, onSubmitWritten, backfillScopes } from './scope-sync.js'
