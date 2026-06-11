# P2 Field Control — Improvement Plan (larger changes)

Items that need product/ops approval, touch data-layer security posture, or carry
rollback risk beyond a single safe code edit. Ordered by value.

## 1. Tighten operational-collection WRITE rules (audit H-2)
**What:** `firestore.rules:103-114` allows `write: if signedIn()` on every
operational collection. Read isolation already uses `ownsRecord()`; writes do not.
**Why it's not a quick fix:** Portal users (builder/client) currently write directly
to `extras` (CO approve/reject), `notifications`, and `history`. Tightening writes to
`ownsRecord(request.resource.data)` will break those flows unless they either (a)
carry the right `tenantId`/`clientUids`, or (b) route through Cloud Functions.
**Plan:**
1. Confirm `backfillScoping` has been run (so existing docs carry scoping fields).
2. Add `ownsRecord(request.resource.data)` to write rules behind a per-collection
   rollout, starting with the lowest-traffic collection.
3. Or: move portal mutations (approveExtra/rejectExtra/addNotification/addHistory)
   into Cloud Functions that run with the Admin SDK and stamp scoping + actor.
**Rollback:** revert the rules deploy (rules are versioned and instant to roll back).

## 2. Server-stamp the audit-trail actor (audit M-3)
**What:** `history`/`notifications` `actor` is a client-supplied display name
(`clientName || 'Client'`), spoofable within an authenticated session.
**Plan:** introduce `addHistory`/`addNotification` Cloud Functions (or a Firestore
trigger) that overwrite `actor`/`actorUid` from `context.auth` rather than trusting
the client payload. Pairs naturally with item 1.
**Rollback:** keep the client-side write path behind a feature flag during cutover.

## 3. Resolve dependency advisories (audit M-4)
**What:** root 9 vulns (firebase SDK → `protobufjs`, `qs`), functions 12 vulns
(`@grpc/grpc-js`, `hono`, `fast-uri`) — all transitive, all with non-breaking
`npm audit fix` available.
**Plan:** run `npm audit fix` in root and `functions/` on a dedicated branch,
re-run the full suite + a manual smoke of OAuth + push + sync, then merge.
**Rollback:** restore the prior `package-lock.json` (committed).

## 4. Storage path scoping
**What:** `storage.rules` allows `read: if request.auth != null` for all paths — any
authenticated user can read any uploaded file given its URL.
**Plan:** scope reads to `jobs/{jobDocId}/...` by cross-referencing the caller's
tenant/client ownership (needs the same scoping fields as item 1).

## 5. Decompose `App.jsx` (1030 lines)
**What:** auth gating, tab routing, OAuth-callback handling, terms gate, and
user-creation all live in one file.
**Plan:** extract the routing/tab map and the auth/terms shell into separate
modules. Pure refactor, no behavior change — defer until the security items land so
diffs don't collide.

## 6. Minor UX/a11y (low risk, batchable)
- `aria-label` on icon-only buttons flagged in the audit.
- `preventDefault` on PhotoLightbox arrow keys to stop background scroll.
- Route portal-handler `console.error` calls through the existing `errorLogger` sink.

## Verification gate for every item
`npx eslint .` · `npm test` · `npm run build` · (for 1/2/4) Firestore rules emulator
test of the affected flows before deploy.
</content>
