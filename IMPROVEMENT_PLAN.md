# P2 Field Control — Improvement Plan (larger changes)

Items that need product/ops approval, touch data-layer security posture, or carry
rollback risk beyond a single safe code edit. Ordered by value.

## 1. Tighten operational-collection WRITE rules (audit H-2) — **CODE READY, NOT DEPLOYED**
**What:** `firestore.rules:103-114` allows `write: if signedIn()` on every
operational collection. Read isolation already uses `ownsRecord()`; writes do not.
**Progress this pass:**
- Server-stamped Cloud Functions added in `functions/index.js`
  (`approveExtra`, `rejectExtra`, `sendExtraToBuilder`, `passInspection`,
  `failInspection`, `createJob`, `addHistoryEntry`, `addNotificationEntry`).
  Each verifies caller ownership, stamps `actor`/`actorUid`, and stamps
  `tenantId`/`clientUids` from the user doc. The client already calls these
  via `httpsCallable(...)` with a direct-write fallback — non-breaking
  until the functions are deployed.
- Staged stricter rules at `firestore.rules.next`. Mirrors current
  `firestore.rules` but: (a) write rules require
  `ownsRecord(request.resource.data)`, (b) the legacy no-scope-fields
  branch is removed from `ownsRecord()`, (c) history is append-only for
  non-staff.
**What's still on your hands:**
1. Confirm `backfillScoping` has run in prod (returned `touched + skipped ==
   total` for every collection).
2. Deploy the functions (`firebase deploy --only functions`).
3. Smoke-test the rollout precondition checklist at the top of
   `firestore.rules.next` against a Firestore emulator session.
4. Promote: `mv firestore.rules.next firestore.rules && firebase deploy
   --only firestore:rules`.
**Rollback:** redeploy the previous rules file (rules are versioned and
instant to roll back at the Firebase backend).

## 2. Server-stamp the audit-trail actor (audit M-3) — **CODE READY, NOT DEPLOYED**
**What:** `history`/`notifications` `actor` was a client-supplied display name
(`clientName || 'Client'`), spoofable within an authenticated session.
**Progress this pass:** `addHistoryEntry` / `addNotificationEntry` Cloud
Functions overwrite `actor`/`actorUid`/`actorRole`/`actorEmail` from
`context.auth`. `src/hooks/useFirestore.js::addHistory` and `addNotification`
were updated to call these first with a direct-write fallback — closes M-3
once the functions are deployed; until then behavior is unchanged.
**What's still on your hands:** `firebase deploy --only functions` (same
deploy as item 1). After deploy, every history/notification doc carries a
verified actor; existing rows remain with their original `actor` strings.
**Rollback:** the client-side fallback path still exists — disabling or
deleting the callable functions reverts to the legacy behavior with no code
change.

## 3. Resolve dependency advisories (audit M-4) — **DONE for root; partial for functions/**
**Progress this pass:** `npm audit fix` cleared root (9 → 0). `functions/`
went from 12 → 8; remaining 8 advisories all live in the firebase-admin 7
dependency tree (`@grpc/grpc-js`, `hono`, `fast-uri`) and need a major
firebase-admin bump (7 → 14) to clear. Held off because that's a non-trivial
upgrade — see item 3a.
**Rollback:** restore the prior `package-lock.json` (committed at the prior
revision before commit `9cdaafc`).

## 3a. firebase-admin major upgrade (clears remaining functions/ advisories)
**What:** `firebase-admin` 7 → 14 (or current stable). Major bump — the v13
release notes call out Node 18 EOL and Auth-emulator changes; v14 is
incremental on top. Our function code uses `getFirestore`, `FieldValue`,
`getMessaging` — all stable across the upgrade.
**Plan:** dedicated branch; bump in `functions/package.json`; run
`node --check functions/index.js`; emulator-test push fan-out + scoping
backfill + the new portal callables end-to-end; merge.
**Rollback:** revert the package-lock commit.

## 4. Storage path scoping — **CODE READY, NOT DEPLOYED**
**What:** `storage.rules` allows `read: if request.auth != null` for all paths — any
authenticated user can read any uploaded file given its URL.
**Progress this pass:** Staged stricter rules at `storage.rules.next`. Reads
+ writes under `jobs/{jobDocId}/...` require the caller to own the job
(staff, tenant member, or in `clientUids`) via a `firestore.get()` cross-
reference. `daily_reports/...` is locked to staff. Same 25 MiB cap retained.
**What's still on your hands:**
1. Run `backfillScoping` in prod (gates the cross-reference lookup).
2. Smoke-test the rollout checklist at the top of `storage.rules.next`.
3. Promote: `mv storage.rules.next storage.rules && firebase deploy --only storage`.
**Rollback:** redeploy the previous `storage.rules` (instant).

## 5. Decompose `App.jsx` (1030 lines)
**What:** auth gating, tab routing, OAuth-callback handling, terms gate, and
user-creation all live in one file.
**Plan:** extract the routing/tab map and the auth/terms shell into separate
modules. Pure refactor, no behavior change — defer until the security items land so
diffs don't collide.

## 6. Minor UX/a11y (low risk, batchable) — **DONE**
- `aria-label` on icon-only buttons (ChangeOrders back / line-item remove,
  InvoiceAuditor close / line-item remove, TeamLeaderboard close, Sidebar
  collapsed-mode Shortcuts).
- `preventDefault` on PhotoLightbox arrow keys (audit L-4) — stops the page
  scrolling behind the lightbox.
- Portal-handler `console.error` calls (ClientPortal, JobDetail,
  QBSBuilderPortal, SubmitInbox, ChangeOrders) now route through a new
  exported `logError(source, err)` in `lib/errorLogger.js` so they land in
  the `error_logs` Firestore sink alongside auto-captured crashes. Still
  emits to `console.error` in dev so the debug workflow is unchanged.

## Verification gate for every item
`npx eslint .` · `npm test` · `npm run build` · (for 1/2/4) Firestore rules emulator
test of the affected flows before deploy.
</content>
