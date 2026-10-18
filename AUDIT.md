# P2 Field Control: Full Engineering Audit

Date: 2026 10 18
Scope: entire repository at commit `96f93a9` (web app, Cloud Functions, Firestore and Storage rules, service workers, desktop and mobile wrappers, docs, dependencies)
Method: every source file read in full (about 23,000 lines). Lint, production build and dependency audits run. Firestore rules exercised in the local emulator with unit tests. Component reviews run in parallel and cross checked against the core findings.

## 1. Verdict

Current score: 2 of 10. The app has a broad feature surface and a coherent dark visual language, but the foundation under it does not hold. Anyone on the internet can create an account that lands with full internal access. The security rules that are supposed to protect staff only data fail for every real staff user. Six server functions the UI relies on do not exist, so every approval, inspection result and job creation is a raw browser write. Fake Texas and Montana jobs ship inside the bundle and render under a green "Live" badge whenever the database is empty or unreachable. Money figures on the Command Center and Billing Queue are partly invented. There are no tests, no CI, lint fails, and 47 known dependency vulnerabilities, four of them critical.

None of this is unusual for a fast moving prototype. It is unacceptable for a production tool that builders and clients log into and that generates customer facing invoices. The good news: the fixes are well understood, most of the risky behaviour is concentrated in a handful of files, and a disciplined eight week plan gets this to a genuine 10.

### Scorecard

| Dimension | Score | One line reason |
|---|---|---|
| Security and access control | 1 | Open self registration into internal role. Staff rules broken. Client side authority everywhere. |
| Data integrity | 2 | Fabricated money, fake fallback jobs shown as live, status vocab drift, CO save reverts approvals. |
| Reliability and error handling | 2 | Dozens of fire and forget writes. Buttons stuck forever on failure. Error logger cannot write. |
| Architecture | 3 | 3,852 line `App.jsx`. Three copies of the portal inbox. Global window event bus for navigation. |
| Code quality | 2 | 58 lint errors, 31 dead imports in one file, brand hex redeclared in 19 files, status strings repeated hundreds of times. |
| Testing and CI | 0 | Zero tests. No CI. Rules never run in an emulator before this audit. |
| Performance | 4 | Lazy loading exists. Lists render twice (desktop plus mobile). Several O(n squared) derivations per render. |
| Accessibility | 2 | Terms checkbox unreachable by keyboard. Modals without dialog semantics. Labels not associated. |
| UX polish | 5 | Empty states and skeletons present. Destructive actions unconfirmed. Misleading copy on KPIs. |
| Documentation | 4 | Good README and setup docs. `SECURITY.md` honestly describes gaps. Architecture page in the UI describes fictional functions and rules. |
| Dependencies | 3 | Modern stack. 30 frontend and 17 functions vulnerabilities. Messaging worker pinned to Firebase 10 while app uses 12. |
| Operations | 3 | Offline cache configured. Service worker fakes success on queued writes. No monitoring, no release process. |

## 2. Critical findings (fix before anyone else logs in)

Each item below was verified against code, and where marked, in the emulator.

### C1. Anyone can create an account and receive internal access

`src/App.jsx` lines 386 to 390 render "Create account (owner setup)" on the public login screen. Clicking it opens `CreateUserModal`, which calls `createUserWithEmailAndPassword` at line 415 with no authorization check. The Auth account is created. The follow up write to `users/{uid}` is rejected by rules because the visitor is not staff. On the next sign in, `App.jsx` lines 3687 to 3688 see no users document and default the role to `internal`. Result: unauthenticated self registration into the full dashboard, including the Create User screen, which then lets that person mint `owner` accounts for anyone.

I cannot see the Firebase console, so I cannot confirm whether email and password sign up has been disabled there. The client login itself uses email and password, so the provider is enabled. Treat this as live until proven otherwise.

### C2. Staff only rules fail for every staff member (verified in emulator)

`firestore.rules` line 27 reads `request.auth.token.role != null`. In Firestore rules, reading a missing map key throws, and a throwing condition denies. No code anywhere sets custom claims (confirmed by searching `functions/` and `src/`). So every staff user without a claim, which is all of them, is denied on:

| Operation | Current rules | Patched rules |
|---|---|---|
| Staff reads `qb_config/tokens` | DENIED | allowed |
| Staff writes `config/settings` | DENIED | allowed |
| Staff writes `agent_alerts` | DENIED | allowed |
| Staff creates `users/{uid}` | DENIED | allowed |

Practical effect today: Settings toggles never save, AI alerts never persist, the QuickBooks connected indicator reads as disconnected for staff, and every user the owner creates ends up with an Auth account but no role document, which then defaults to internal (see C1). The one line fix is `('role' in request.auth.token)` and it passed all five checks in the emulator.

### C3. Six Cloud Functions the UI depends on do not exist

`src/hooks/useFirestore.js` lines 275 to 331 call `sendExtraToBuilder`, `approveExtra`, `rejectExtra`, `passInspection`, `failInspection` and `createJob`. `functions/index.js` exports none of them. Every call fails with not found and silently falls back to a direct Firestore write. Consequences: change order approvals, rejections, inspection pass and fail, and job creation are all browser writes that any signed in builder or client can perform on any document. The `approvedBy` field is whatever the client sends. The audit trail is self asserted. Each action also pays a failed network round trip first.

### C4. Fake jobs render as live data

`src/DataContext.jsx` line 970: `allJobs = firestoreJobs.length > 0 ? firestoreJobs : STATIC_JOBS`. Same pattern for extras, notifications, subs and materials. `STATIC_JOBS` holds 44 invented jobs in Austin TX, Bozeman MT, Little Rock AR and so on for a Middle Tennessee contractor. Whenever Firestore is empty, slow, or denied, these render under a pulsing green "Live" pill on seven screens. Every "loading and empty" guard in the app is dead code because the fallback is never empty. The `?portal=qbs` link at `App.jsx` line 3760 bypasses authentication by design and, since reads then fail, shows all 44 fake jobs to whoever holds the link.

### C5. Invented money on customer facing surfaces

`CommandCenter.jsx` line 52, `BillingQueue.jsx` line 54, `agent/alerts.js` line 149 and `lib/generateInvoicePdf.js` line 111 all substitute 18,000 dollars when a job has no contract value. "Invoiced This Month" and "Aging outstanding" multiply that by a hard coded 70 percent (`CommandCenter.jsx` lines 147 and 294, `BillingQueue.jsx` lines 207 and 211). The invoice PDF prints the full invented contract as "TOTAL DUE", stamps "INVOICED" regardless of status, and shows "Tax (0%)" unconditionally. A customer could receive a PDF for an amount nobody entered.

### C6. Push notifications broadcast internal messages to client devices

`functions/index.js` lines 440 to 462 send every new notification to every token in `fcm_tokens`. Client portal users who enable push receive internal billing, inspection and change order messages, including other clients' names and amounts. The notification body is free text written from the browser (`ClientPortal.jsx` line 239, `QBSBuilderPortal.jsx` line 417), so any signed in user can push arbitrary text to every device.

### C7. Builder portal shows every notification in the system

`DataContext.jsx` line 1010 passes `notifs` unscoped while jobs, extras and submits are scoped. `QBSBuilderPortal.jsx` lines 917 to 976 render them all. A QBS builder sees Vision Building Group activity, client rejection notes and dollar amounts, and can mark any of them read.

### C8. Service worker fakes success on offline writes

`public/sw.js` lines 40 to 62 intercept every non GET request to Firestore, Identity Toolkit and Firebase APIs. On failure it queues the raw request, returns a fabricated 202 "queued" response, and later replays it with the original (by then expired) auth headers. `src/main.jsx` lines 28 to 46 replay the same queue a second time from localStorage. Firestore already has its own offline persistence (`firebase.js` lines 29 to 34). This worker fights the SDK, can double apply writes, and can report success for writes that never land.

### C9. Error logging and leaderboard writes hit collections with no rule

`src/lib/errorLogger.js` writes to `error_logs`. `TeamLeaderboard.jsx` lines 83 to 123 read and write `crew_scores` and `app_settings`. None of the three appear in `firestore.rules`, so every write is denied (verified for `error_logs` in the emulator). Errors are never recorded. Bonus points, Google review counts and crew confirmations never save, and the UI shows no failure.

### C10. Disconnect fallback deletes OAuth tokens on any error

`SettingsPage.jsx` lines 151 to 156 and 203 to 208: if the disconnect callable fails for any reason, including a timeout, the browser deletes the token document directly. The refresh token is never revoked at Intuit or CompanyCam. The real error is hidden.

## 3. High severity findings

### Security

- `requireAuth` in `functions/index.js` line 97 only checks for a session. Any signed in builder or client can call `qbDisconnect`, `ccDisconnect` and `ccSyncPhotos`.
- `users` rules allow `internal` staff to write any user document, so an internal user can create `owner` accounts (`App.jsx` lines 479 to 484).
- Admin types the new user's password (`App.jsx` lines 468 to 471). No invite or reset flow. Secondary auth session is not signed out on the error path.
- Terms gate opens even when the acceptance write fails (`App.jsx` lines 546 to 556, `finally { onAccept() }`).
- `paymentUrl` and file URLs from Firestore render as `href` and `src` with no scheme or host check (`ClientPortal.jsx` lines 376 to 380, 465 to 467, 480 to 481; `JobDetail.jsx` lines 224 to 231). Any signed in user can write those fields.
- Client uploads have no type or size validation and build the storage path from the raw file name (`ClientPortal.jsx` lines 408 to 440). Storage rules allow any content type under any path for any signed in user.
- Builder PM identity comes from a URL parameter and is written as message author (`QBSBuilderPortal.jsx` lines 984 to 987, 626, 640).
- Any signed in user can approve or pay supplier invoices (`InvoiceAuditor.jsx` line 455), award negative or positive bonus points, and file crew reports as any crew member with no `uid` recorded.
- `fcm_tokens` write rule lets any user overwrite any other device's token record.
- Tauri ships with `"csp": null` (`src-tauri/tauri.conf.json` line 23).

### Correctness and data integrity

- Module level `TODAY` constants freeze time for the life of the tab in nine files (`App.jsx` 237, `agent/scoring.js` 1, `CommandCenter.jsx` 27, `WarRoom.jsx` 32, `BillingQueue.jsx` 29, `PMDashboard.jsx` 27, `ChangeOrders.jsx` 97, `CrewReport.jsx` 48, `TeamLeaderboard.jsx` 42, both portals). A tablet left open overnight shows yesterday's risk, staleness and headers under a "Live" badge.
- UTC date written as local date: `toISOString().slice(0, 10)` in `App.jsx` 239 and 1121, `CrewReport.jsx` 236, `ChangeOrders.jsx` 54, `InvoiceAuditor.jsx` 32, `CommandCenter.jsx` 144. After 7 pm Central the app records tomorrow's date. Crew report readiness gate compares against the wrong day.
- Editing a material resets its cost to zero (`App.jsx` line 2641 sets `cost: 0` in the shared payload, line 2644 writes it on edit).
- Saving a change order discards the Status select and reverts approved orders to Draft (`ChangeOrders.jsx` line 436).
- "Submit invoice" writes only `billingStatus` and never records `invoiceDate` or number, so aging and monthly KPIs exclude it (`BillingQueue.jsx` line 559).
- Re scan reopens resolved and dismissed alerts and rewrites their creation time (`AlertsPage.jsx` 257 to 258 with `useFirestore.js` 434 merge). Alerts outside the newest 50 resurrect as open (`AlertsPage.jsx` 160 to 168).
- Snooze is cosmetic; `snoozeUntil` is never evaluated.
- Three divergent definitions of billing ready (`agent/scoring.js` 35, `BillingQueue.jsx` 42, `CommandCenter.jsx` 269). Five different staleness thresholds across screens. The same job reads as a different risk on each page.
- Analytics still matches the old extras vocabulary (`approved`, `sent-to-qbs`) while the writer emits `Draft`, `Sent to Builder`, `Approved`, `Rejected`. New change orders are invisible in charts.
- CO numbers generated from in memory, tenant scoped data collide across users and tenants (`ChangeOrders.jsx` 61 to 69).
- Inline inputs keep stale local state and write it back on blur, overwriting a colleague's edit (`PMDashboard.jsx` 720 to 731, `BillingQueue.jsx` 620 to 629). Each is mounted twice per row because desktop and mobile layouts both render.
- Permits tab throws on any job without a `permits` map (`Permits.jsx` 31, 60).
- Mixed timestamp types in the same documents (ISO strings next to server timestamps) break sorting and queries.

### Reliability

- No try and catch around mutations in at least 20 handlers across `QBSBuilderPortal`, `ClientPortal`, `SubmitInbox`, `AlertsPage`, `BillingQueue`, `PMDashboard`, `TeamLeaderboard`, `InvoiceAuditor`. Buttons stick on "Submitting" forever and the user sees nothing. `ToastProvider` exists but `App.jsx` never calls it.
- OAuth connect shows "timed out" after ten seconds, then still redirects when the slow call resolves (`SettingsPage.jsx` 118 to 130).
- `generateInvoicePdf` failures (chunk load offline) are unhandled.
- `limit(100)` on daily reports and `limit(50)` on alerts silently truncate scoring once volume grows.

### Quality gates

- `npm run lint` fails with 58 errors.
- `npm audit`: frontend 30 vulnerabilities (18 high, 2 critical), functions 17 (6 high, 2 critical). Most fix with `npm audit fix`.
- Zero test files. No CI configuration. `firestore.rules` had never been run in an emulator.
- Production bundle: 2.7 MB of JavaScript. One 526 KB chunk is named `card` because the chunking pulls recharts in through a shared UI primitive.
- `firebase-messaging-sw.js` loads Firebase 10.12 compat while the app uses Firebase 12.

## 4. Medium and low findings (grouped)

**Architecture.** `App.jsx` is 3,852 lines containing Login, Create User, Terms, Morning Briefing, Jobs, Inspections, Subs, Materials and Notifications plus six empty wrapper components. `QBSBuilderPortal.jsx` and `ClientPortal.jsx` duplicate roughly 60 percent of each other (helpers, timelines, extra rows, stats, headers, tabs). Three copies of the message thread UI exist. Navigation is a `window.dispatchEvent` bus with no validation. Two design systems coexist (`components/ui` with tokens, `components/shared` with inline hex), with status maps triplicated. Brand orange is redeclared in 19 files. The light theme block in `index.css` is dead because dark is forced.

**Hard coded business data.** PM rosters in three files, crew lists in two, "Abby / Randi" and a billing email in two, "Middle Tennessee" in three, vendor list, terms version, readiness thresholds, tenants. Any staffing change requires a deploy.

**Performance.** Every list page renders the full dataset twice (desktop table plus mobile cards, toggled by CSS). `InvoiceAuditor` runs an n squared audit per row per render. `TeamLeaderboard` opens six listeners for a six document collection and writes to Firestore from inside a read callback. `ChangeOrders` and `PMDashboard` recompute aggregates in render.

**Accessibility.** Terms checkbox is a div with no role, keyboard or aria state, and the Accept button is disabled until it is checked, so keyboard and screen reader users cannot enter the builder portal. `CreateUserModal` and the mobile drawer lack dialog role, focus trap, Escape and focus return. Nested interactive controls inside `role="button"` rows in three places. Most form labels are spans or lack `htmlFor`. Icon only buttons without names. Tabs without tab semantics in both portals. Several statuses carry meaning by color alone.

**UX copy and trust.** StatCard trend text is literally fake ("+8%" or "-3%"). "Closed in last 24h" means calendar today. "{n} ever" counts the last 50. "Missing Documentation" counts every job without a permit number. The in app Architecture page documents six functions and a rules file that do not exist.

**Platform.** `apple-touch-icon` points at an SVG, which iOS ignores. Capacitor and Tauri configs are present but OAuth redirects target the web origin only.

## 5. What is good (keep it)

- Clear product thinking: the Command Center, Morning Briefing and risk scoring reflect how a field operation actually runs.
- Offline first Firestore cache with multi tab manager is the right call for field crews.
- OAuth state tokens are random, user bound, time limited and burned after use. Secrets live in Secret Manager. Token exchange happens server side.
- Lazy loading of heavy routes and jsPDF already in place.
- Honest `SECURITY.md` that names the read isolation gap.
- Consistent dark visual identity, skeleton loaders, focus rings, reduced motion respected.

## 6. Prioritized backlog

Priority uses the formula (Impact + Risk) x (6 minus Effort), each on a 1 to 5 scale. Higher is sooner.

The Status column records where each item stands on the branch `claude/phase-0-1-security-foundation`: items 1 to 14 and 19 are done, with the commits that closed them, and the rest are open. Two pieces of work were found and done during that plan although this audit did not list them: item 10b (a fresh sign in showed no data), closed in 65e2468, 7443424 and 70a0e2d, and the scope stamping work, in e0ec82e and 2d89a85.

| # | Item | Impact | Risk | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| 1 | Remove public "Create account" link; default unknown role to no access | 5 | 5 | 1 | 50 | Done (fab033b) |
| 2 | Fix `userRole()` to use `'role' in request.auth.token`; add rules for `error_logs`, `crew_scores`, `app_settings` | 5 | 5 | 1 | 50 | Done (df51272) |
| 3 | Delete `STATIC_*` fallbacks as live data; render real empty states | 5 | 4 | 1 | 45 | Done (7d17b5d) |
| 4 | Remove `?portal=qbs` auth bypass | 4 | 5 | 1 | 45 | Done (fab033b) |
| 5 | Remove 18,000 dollar and 70 percent fabrications; show "no contract value" | 5 | 4 | 2 | 36 | Done (6a15499, 9df529d) |
| 6 | Scope push fan out to staff tokens; move notification writes server side | 4 | 5 | 2 | 36 | Done (84c81e3 moved notification writes server side; a496a7a and a8d0adc scoped the push fan out) |
| 7 | Scope `notifs` per tenant and client in `DataContext` | 4 | 4 | 1 | 40 | Done (8d5b11b, 0ab45ab) |
| 8 | Remove service worker write interception; keep static caching only | 4 | 4 | 1 | 40 | Done (8cdc05a) |
| 9 | Remove token delete fallbacks; fix connect timeout race | 3 | 4 | 1 | 35 | Done (2929a3e) |
| 10 | Implement `createUser` callable (owner only, sets custom claims, sends reset link) | 5 | 5 | 3 | 30 | Done (443a779, fb81fe8) |
| 11 | Implement `approveExtra`, `rejectExtra`, `passInspection`, `failInspection`, `createJob` callables with role checks; remove fallbacks | 5 | 5 | 3 | 30 | Done (84c81e3, 607a1ed) |
| 12 | Tighten rules: staff write on jobs, extras, inspections; clients read via `clientUids`; builders via `tenantId`; scope queries | 5 | 5 | 4 | 20 | Done (8d5b11b, dc3b4b5, 5f7a510, 0ab45ab) |
| 13 | CI: lint, build, unit tests, rules emulator tests on every PR | 4 | 4 | 2 | 32 | Done (5e18b64) |
| 14 | Fix 58 lint errors; `npm audit fix` both packages | 3 | 4 | 1 | 35 | Done (5e18b64, which also ran npm audit fix; advisories that need breaking upgrades remain) |
| 15 | Shared date module: local date helper, no module level `TODAY` | 4 | 4 | 2 | 32 | Open (Phase 2) |
| 16 | Single status vocabulary module and single `isBillingReady` | 4 | 3 | 2 | 28 | Open (Phase 2) |
| 17 | Wrap every mutation in try, catch, finally with toast feedback | 4 | 3 | 3 | 21 | Open (Phase 2) |
| 18 | Fix material cost reset, CO save status, invoice date on submit, alert rescan merge, snooze | 4 | 4 | 2 | 32 | Open (Phase 2) |
| 19 | Validate `paymentUrl` and file URLs; validate uploads; record `uid` on every write | 3 | 4 | 2 | 28 | Done (ae39200, ce667ce) |
| 20 | Unit tests for `scoring`, `alerts`, `billing`, `briefing`, `inspections`, `notifications` | 3 | 3 | 2 | 24 | Open (Phase 2 or later) |
| 21 | Split `App.jsx` into route files; adopt a router; drop the window event bus | 4 | 2 | 4 | 12 | Open (Phase 2 or later) |
| 22 | Extract shared portal kit (`PortalShell`, `ExtraRow`, `InspectionTimeline`, `MessageThread`) | 3 | 2 | 4 | 10 | Open (Phase 2 or later) |
| 23 | One design system; delete `legacy-badges`, `ProgressBar`, duplicate `SectionHeader`; tokens for all color | 3 | 2 | 3 | 15 | Open (Phase 2 or later) |
| 24 | Accessibility pass: real checkbox, dialog semantics, label association, tab roles, text for color | 3 | 3 | 3 | 18 | Open (Phase 2 or later) |
| 25 | Render one layout per breakpoint; memoize list derivations; fix n squared audit | 3 | 2 | 3 | 15 | Open (Phase 2 or later) |
| 26 | Move rosters, tenants, thresholds, terms version into `config` documents | 3 | 2 | 2 | 20 | Open (Phase 2 or later) |
| 27 | Observability: working error sink, App Check, version from `package.json`, Dependabot | 3 | 3 | 2 | 24 | Open (Phase 2 or later) |
| 28 | Incremental TypeScript (or `checkJs` with JSDoc) starting with `lib` and `agent` | 3 | 2 | 4 | 10 | Open (Phase 2 or later) |

## 7. Phased remediation plan

### Phase 0: stop the bleeding (one day)

Items 1, 2, 3, 4, 7, 8, 9, 14. All are small, mechanical and verified. Deploy rules and hosting together. Audit the Firebase Auth user list for accounts created by strangers and the `users` collection for documents missing a role. This phase alone moves security from 1 to 4 and data integrity from 2 to 4.

### Phase 1: server side authority (weeks 1 and 2)

Items 5, 6, 10, 11, 12, 13, 19. Everything that changes money, status, role or identity goes through a callable that checks the caller's claim. Rules enforce tenant and client scope at the database. Queries are scoped so the rules can allow them. CI blocks merges on lint, build, unit tests and emulator rules tests. This is the largest chunk of work and the one that makes the 10 possible.

### Phase 2: correctness (weeks 3 to 5)

Items 15, 16, 17, 18, 20, 26, 27. One date module, one status module, one billing ready function. Every mutation reports success or failure. Pure business logic gets tests. Hard coded rosters move to config. Errors actually get logged somewhere.

### Phase 3: architecture and experience (weeks 6 to 8)

Items 21 to 25, 28. Split the monolith, unify the portals, finish the design system, pass an accessibility review, stop rendering everything twice, add types where bugs have been found.

### Phase 4: steady state

Dependabot and audit in CI. Emulator tests for every rules change. A release checklist. Quarterly review of this document.

## 8. What 10 of 10 looks like

- No path to data or action exists without a server verified role. Rules tests prove it on every commit.
- Every number on screen traces to a value a person entered. Missing data reads as missing, never as a plausible default.
- Every write reports an outcome. Nothing is fire and forget.
- Time is computed when rendered, in the user's zone, and the "Live" badge is true.
- One source of truth for status vocabulary, risk thresholds, rosters and brand tokens.
- `App.jsx` under 300 lines. No file over 500. Portals share one kit.
- Lint clean, type checked, tested, built and deployed by CI. Zero known critical or high vulnerabilities.
- Keyboard and screen reader users can do everything a mouse user can.
- Errors reach a dashboard a human reads.

## 9. Verification notes and uncertainties

- Rules findings C2 and C9 were confirmed by running the repository's `firestore.rules` in the Firestore emulator with `@firebase/rules-unit-testing`. The patched rule was confirmed the same way.
- C1 depends on email and password sign up being enabled in the Firebase console. I could not inspect the console. The client sign in path uses that provider, so it is almost certainly enabled.
- Timezone findings come from code reading, not runtime reproduction. They follow directly from `toISOString()` returning UTC.
- Dependency counts come from `npm audit` on 2026 10 18 and will change.
- Line numbers refer to commit `96f93a9`.
