# Phase 0 and 1: Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every critical finding in the audit and move all authority for money, status, role and identity from the browser to Cloud Functions and Firestore rules, with CI proving it.

**Architecture:** Roles become custom claims synced from `users/{uid}` by a trigger. Portals query only what rules let them read, scoped by `tenantId` (builders) and `clientUids` (clients) stamped on every scoped document by triggers. Every privileged action is a callable that checks the caller's claims and writes the audit trail itself. The browser keeps reads, uploads and messages.

**Tech Stack:** React 19, Vite 8, Firebase 12 (Firestore, Auth, Storage, Functions v2, Messaging), firebase-admin 12, vitest, @firebase/rules-unit-testing, firebase-tools emulator, GitHub Actions.

**Spec:** `AUDIT.md` sections 2, 3 and 6 (items 1 to 14 and 19).

## Global Constraints

- Node 22 for functions (`functions/package.json` engines). Node 22 in CI.
- Roles are exactly `owner | internal | builder | client`. Staff means owner or internal.
- Tenants are exactly `p2-core | qbs | vision`. A job with no `tenantId` is treated as `qbs` during backfill only, never at read time.
- No fabricated values anywhere. A missing number renders as a dash or an explicit "No contract value" label, never as a default amount.
- No dashes in any user visible copy (owner's rule). Use commas, periods or the word "to".
- Every write that a person initiates records `createdBy` or `updatedBy` as the caller's uid.
- Never skip or disable a test to get green. Never commit secrets. Firebase client config in `src/firebase.js` is public by design and stays.
- `npm run lint`, `npm test`, `npm run test:rules`, `npm run build` and `cd functions && npm test` must all pass before any commit that touches their inputs.
- Commit messages: imperative, under 72 characters, no model names in the body.

## Review Focus

1. A user whose users document exists but has no `role` field must land on the No Access screen, not the dashboard. Test in Task 3.
2. A builder signed in with a `tenantId` claim of `qbs` must receive zero documents from a `where tenantId == vision` query, and rules must reject the query, not just filter it. Test in Task 13.
3. A client with `clientJobIds` of `["QBS-001"]` whose `clientUids` has not yet been stamped onto the job (backfill not run) must see an empty, labelled state, not an error page. Test in Task 13.
4. A notification with no `tenantId` and no `clientUids` must reach staff devices only. Test in Task 14.
5. A job with `contractValue` of `0` must render "$0", and a job with `contractValue` missing must render "No contract value" and be excluded from sums. Test in Task 7.

---

### Task 1: Test tooling, lint clean, CI skeleton

**Files:**
- Modify: `package.json` (scripts, devDependencies)
- Modify: `eslint.config.js`
- Modify: `vite.config.js:17`
- Create: `vitest.config.js`
- Create: `.github/workflows/ci.yml`
- Create: `src/components/ui/button-variants.js`, `src/components/ui/badge-variants.js`, `src/components/ui/use-toast.js`
- Modify: `src/components/ui/button.jsx`, `src/components/ui/badge.jsx`, `src/components/ui/toast.jsx`, `src/components/shared/legacy-badges.jsx`, `src/components/shared/states.jsx:7`, `src/hooks/useFirestore.js:4,159,176`, `src/main.jsx:25,45`
- Modify: `functions/package.json` (scripts, devDependencies)
- Test: `src/lib/__tests__/smoke.test.js`

**Interfaces:**
- Produces: `npm test` (vitest run), `npm run test:rules` (defined in Task 2, stubbed here as `echo`), `cd functions && npm test` (node --test). CI job names `lint`, `test`, `rules`, `build`, `functions`.

- [ ] **Step 1: Write the smoke test**

```js
// src/lib/__tests__/smoke.test.js
import { describe, it, expect } from 'vitest'
import { cn } from '../utils'
describe('cn', () => { it('merges classes', () => { expect(cn('a', 'b')).toBe('a b') }) })
```

- [ ] **Step 2: Run `npx vitest run`, expect failure "vitest not found"**
- [ ] **Step 3: Install and configure**

Add devDependencies `vitest@^3`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6`, `jsdom@^26`. `vitest.config.js` uses `environment: 'jsdom'`, `globals: true`, alias `@` to `./src`. Scripts: `"test": "vitest run"`, `"test:rules": "node scripts/run-rules-tests.mjs"` (script lands in Task 2; for now the file does not exist so this step adds the script entry only). In `functions/package.json` add `"test": "node --test"`.

- [ ] **Step 4: Run `npx vitest run`, expect PASS**
- [ ] **Step 5: Fix all 58 lint errors**

Move `buttonVariants` into `button-variants.js`, `badgeVariants` into `badge-variants.js`, `useToast` into `use-toast.js`; each `.jsx` re-imports and no longer exports non components. In `legacy-badges.jsx` move the four exported maps and helpers into `src/components/shared/legacy-badge-meta.js`. Delete unused `Icon` in `states.jsx:7` and `where` import in `useFirestore.js:4`. In `useFirestore.js` the two `setState` inside effect cases (lines 159, 176): initialize state from the argument instead (`useState(() => [])` and derive `loading` as `!!docId && !loaded`) so no synchronous set happens in the effect body. Replace empty `catch {}` in `main.jsx` with `catch { /* storage unavailable */ }`. Replace `__dirname` in `vite.config.js` with `fileURLToPath(new URL('./src', import.meta.url))`.

- [ ] **Step 6: Run `npm run lint`, expect 0 problems. Run `npm run build`, expect success.**
- [ ] **Step 7: Run `npm audit fix` in root and `functions/`. Re-run lint, test, build. Record remaining counts in the commit body.**
- [ ] **Step 8: Write `.github/workflows/ci.yml`**

Triggers: `pull_request` and `push` to `main`. Jobs on `ubuntu-latest`, Node 22, `npm ci`: `lint` runs `npm run lint`; `test` runs `npm test`; `build` runs `npm run build`; `functions` runs `cd functions && npm ci && npm test`; `rules` installs Java 21 via `actions/setup-java@v4` (temurin) and runs `npm run test:rules`. Cache npm.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Add vitest, CI workflow, and clear all lint errors"
```

---

### Task 2: Firestore rules fix and rules test harness

**Files:**
- Modify: `firestore.rules`
- Create: `scripts/run-rules-tests.mjs`
- Create: `tests/rules/firestore.test.mjs`
- Create: `tests/rules/helpers.mjs`
- Create: `firebase.json` emulators block (modify existing file)

**Interfaces:**
- Produces: `tests/rules/helpers.mjs` exporting `setupEnv()` returning `{ env, asStaff(uid), asBuilder(uid, tenantId), asClient(uid, clientJobIds), asAnon(), seed(fn) }` where `asStaff` sets claim `{ role: 'internal' }`, `asBuilder` sets `{ role: 'builder', tenantId }`, `asClient` sets `{ role: 'client', clientJobIds }`, and `seed(fn)` runs `fn(db)` with rules disabled. Every later rules test uses this.

- [ ] **Step 1: Write the failing rules tests**

Tests, each `assertSucceeds` or `assertFails`:
- `staff without claim but users.role internal writes config/settings` succeeds (currently fails)
- `staff without claim reads qb_config/tokens` succeeds
- `signed in user creates error_logs doc` succeeds; `client reads error_logs` fails; `staff reads error_logs` succeeds
- `staff writes crew_scores/austin` succeeds; `client writes crew_scores/austin` fails; `client reads crew_scores/austin` succeeds
- `staff writes app_settings/google_review` succeeds; `client writes` fails; `client reads` succeeds
- `client writes fcm_tokens/t1 with uid == own uid` succeeds; `client writes fcm_tokens/t2 with uid == other` fails
- `anon writes users/x` fails; `internal writes users/x with role owner` fails; `owner writes users/x with role owner` succeeds

- [ ] **Step 2: Write `scripts/run-rules-tests.mjs`**

Spawns `npx firebase emulators:exec --only firestore,storage --project p2-dashboard "node --test tests/rules/"` with `stdio: inherit`, exits with the child's code. Add `"emulators": { "firestore": { "port": 8080 }, "storage": { "port": 9199 }, "ui": { "enabled": false } }` to `firebase.json`. Add devDependencies `@firebase/rules-unit-testing@^4` and `firebase-tools@^14`.

- [ ] **Step 3: Run `npm run test:rules`, expect the first test and the users tests to FAIL**
- [ ] **Step 4: Fix the rules**

```
function userRole() {
  return ('role' in request.auth.token)
    ? request.auth.token.role
    : (exists(/databases/$(database)/documents/users/$(request.auth.uid))
        ? get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role
        : null);
}
function isOwner() { return signedIn() && userRole() == 'owner'; }
```

Add matches: `error_logs/{doc}` create if signedIn and `request.resource.data.userEmail == request.auth.token.email`, read if isStaff; `crew_scores/{doc}` read signedIn, write isStaff; `app_settings/{doc}` read signedIn, write isStaff; `fcm_tokens/{token}` write only if `request.resource.data.uid == request.auth.uid`, read isStaff. `users/{uid}` write: isOwner, or isStaff when `request.resource.data.role in ['builder','client']`.

- [ ] **Step 5: Run `npm run test:rules`, expect all PASS**
- [ ] **Step 6: Commit** `git commit -m "Fix staff role lookup in rules and add rules test harness"`

---

### Task 3: Session resolution, No Access screen, remove public signup and portal bypass

**Files:**
- Create: `src/lib/session.js`
- Create: `src/components/NoAccessScreen.jsx`
- Modify: `src/App.jsx:264-398` (LoginScreen), `:3614-3836` (root), `:528-620` (TermsGate)
- Test: `src/lib/__tests__/session.test.js`

**Interfaces:**
- Produces: `resolveSession(claims, userDoc, firebaseUser) -> { role: 'owner'|'internal'|'builder'|'client'|null, tenantId: string, displayName: string, clientName: string, clientJobIds: string[] }`. Pure. `role` is `null` when neither claims nor the document carry a valid role. Claims win over the document for `role`, `tenantId`, `clientJobIds`.

- [ ] **Step 1: Write failing tests**

```js
expect(resolveSession({}, null, { displayName: '' }).role).toBeNull()
expect(resolveSession({}, { role: 'internal' }, {}).role).toBe('internal')
expect(resolveSession({ role: 'client', clientJobIds: ['QBS-001'] }, { role: 'owner' }, {}).role).toBe('client')
expect(resolveSession({}, { role: 'admin' }, {}).role).toBeNull()
expect(resolveSession({}, { role: 'builder' }, {}).tenantId).toBe('qbs')   // builder default
expect(resolveSession({}, { role: 'internal' }, {}).tenantId).toBe('p2-core')
```

- [ ] **Step 2: Run, expect FAIL (module missing)**
- [ ] **Step 3: Implement `resolveSession` in `src/lib/session.js`**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Create `NoAccessScreen({ email, onLogout })`**

Copy: heading "No access yet", body "Your account exists but has not been given a role. Ask the P2 office to finish your setup.", shows the email as selectable text, a Sign out button.

- [ ] **Step 6: Wire into `App.jsx`**

In the `onAuthStateChanged` handler replace lines 3670 to 3699 with one call to `resolveSession(tokenResult.claims, snap.exists() ? snap.data() : null, firebaseUser)` and set state from the result. After the auth gate, if `role === null` render `NoAccessScreen`. Delete the `forcedPortal` state and the `?portal=qbs` branch. Delete the `showSignup` state, the "Create account (owner setup)" button in `LoginScreen`, and the `onSignup` prop. `CreateUserModal` remains reachable only from the Sidebar (owner and internal) until Task 10 rewrites it. In `TermsGate.handleAccept` move `onAccept()` into the try block after the write succeeds; in catch set `error` state and render it under the button: "Could not record your acceptance. Check your connection and try again."

- [ ] **Step 7: Run lint, test, build. Commit** `git commit -m "Resolve sessions from claims, add No Access screen, remove public signup and portal bypass"`

---

### Task 4: Remove static fallbacks and auto seed

**Files:**
- Modify: `src/DataContext.jsx` (delete `STATIC_*` fallbacks at 970 to 974, delete `seedFirestore` and its effect, delete `LAST_STATUS_CHANGES`, `OLD_PM_MAP`, `agentFields` usage if only seed used it)
- Create: `scripts/seed-demo.mjs`
- Create: `scripts/demo-data.mjs` (receives the `STATIC_*` arrays moved out of `DataContext.jsx`)
- Modify: `src/components/shared/StatCard.jsx:24` (delete fake trend text)
- Test: `src/__tests__/DataContext.test.jsx`

**Interfaces:**
- Produces: `DataProvider` value gains `empty: boolean` (true when every collection finished loading with zero docs). `scripts/seed-demo.mjs` refuses to run unless `FIRESTORE_EMULATOR_HOST` is set.

- [ ] **Step 1: Write failing test**

Render `DataProvider` with the Firestore hooks mocked (`vi.mock('../hooks/useFirestore')`) returning empty arrays and `loading: false`. Assert `useData().jobs` has length 0 and `useData().empty` is true. Second case: hooks return `loading: true`; assert `loading` is true and `jobs` is empty.

- [ ] **Step 2: Run, expect FAIL (jobs length 44)**
- [ ] **Step 3: Implement**

Delete fallbacks, seed, and the module level static arrays from `DataContext.jsx`; move arrays to `scripts/demo-data.mjs`. `scripts/seed-demo.mjs` uses `firebase-admin` against the emulator and writes jobs, extras, notifications, subs, materials from `demo-data.mjs`, stamping `tenantId: 'qbs'` on every job. Replace `StatCard` trend with the optional `trend` prop only; render nothing when absent.

- [ ] **Step 4: Run, expect PASS. Run `npm run build`, confirm `dist` no longer contains the string "Enclave Dr".**
- [ ] **Step 5: Commit** `git commit -m "Remove fake fallback data and auto seed; add emulator only demo seed script"`

---

### Task 5: Service worker: static caching only

**Files:**
- Modify: `public/sw.js` (delete lines 10 to 11, 29 to 71 write branch, 103 to 139)
- Modify: `src/main.jsx` (delete lines 15 to 47)
- Test: `tests/sw.test.mjs`

- [ ] **Step 1: Write failing test**

Node test that reads `public/sw.js` as text and asserts it contains no `writeQueue`, no `'sync'` listener, no `firestore.googleapis.com`. Asserts `CACHE_NAME` is `p2-control-v9`.

- [ ] **Step 2: Run `node --test tests/sw.test.mjs`, expect FAIL**
- [ ] **Step 3: Implement**

Worker keeps install, activate, navigation network first with cache fallback, and cache first for same origin static assets only (`url.origin === self.location.origin`). Every request to another origin passes through untouched (`return` without `respondWith`). Bump `CACHE_NAME`. `main.jsx` keeps only registration.

- [ ] **Step 4: Run test, expect PASS. Add the test file to the vitest include or run it via `npm test` by placing it under `src/__tests__/sw.test.js` reading the file with `fs`. Commit** `git commit -m "Stop service worker from intercepting Firestore writes"`

---

### Task 6: Settings integration flows without destructive fallbacks

**Files:**
- Modify: `src/components/SettingsPage.jsx:116-215`
- Create: `src/lib/withTimeout.js`
- Test: `src/lib/__tests__/withTimeout.test.js`

**Interfaces:**
- Produces: `withTimeout(promise, ms) -> Promise` rejecting with `Error('timeout')` and ignoring the late result.

- [ ] **Step 1: Write failing tests** for `withTimeout` (resolves before deadline, rejects after, late resolution does not call `then`).
- [ ] **Step 2: Run, FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Rewrite connect and disconnect handlers**

Connect: `const { data } = await withTimeout(httpsCallable(functions, 'qbAuth')(), 10000)`; on `timeout` show the timed out message and return without redirecting. Disconnect: call the callable; on failure show "Could not disconnect. The connection is unchanged. Try again." and never touch Firestore from the browser. Delete both `deleteDoc` fallbacks and the `deleteDoc` import if unused.

- [ ] **Step 6: Lint, test, build. Commit** `git commit -m "Remove token delete fallbacks and fix OAuth connect timeout race"`

---

### Task 7: Money without fabrication

**Files:**
- Create: `src/lib/money.js`
- Modify: `src/components/CommandCenter.jsx:30-55,130-150,269-296`, `src/components/BillingQueue.jsx:50-56,179-215`, `src/agent/alerts.js:149`, `src/lib/generateInvoicePdf.js:111,164,203-209`, `src/DataContext.jsx` (delete `TYPE_CONTRACT` if it survived Task 4)
- Test: `src/lib/__tests__/money.test.js`

**Interfaces:**
- Produces: `contractValue(job) -> number | null` (null when missing, non numeric or negative; 0 is a number); `fmtMoney(n) -> string` ("$18,000"; `fmtMoney(null)` returns "No contract value"); `sumContracts(jobs) -> { total: number, missing: number }`.

- [ ] **Step 1: Write failing tests** covering Review Focus item 5 plus `sumContracts([{contractValue: 100}, {}])` equals `{ total: 100, missing: 1 }`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Replace every `|| 18000` and `* 0.7`**

KPIs use `sumContracts`; when `missing > 0` render a footnote "{missing} jobs have no contract value and are excluded". Delete `TYPE_ESTIMATE`. Invoice PDF: `generateInvoicePdf(job)` throws `Error('Job has no contract value')` when `contractValue(job)` is null; callers catch and toast "Add a contract value to this job before generating an invoice." Status badge reads `job.billingStatus` via `BILLING_STATUS_LABEL`. Tax line renders only when `job.taxRate` is a number.

- [ ] **Step 6: Lint, test, build. Commit** `git commit -m "Remove fabricated contract values and milestone percentages"`

---

### Task 8: URL safety, upload validation, authorship on writes

**Files:**
- Create: `src/lib/safeUrl.js`, `src/lib/uploads.js`
- Modify: `src/components/ClientPortal.jsx:376-380,408-440,465-481`, `src/components/JobDetail.jsx:224-231`, `src/components/ProjectFolders.jsx:51-66`, `src/hooks/useFirestore.js` (mutation helpers)
- Test: `src/lib/__tests__/safeUrl.test.js`, `src/lib/__tests__/uploads.test.js`

**Interfaces:**
- Produces: `safeHttpUrl(u) -> string | null` (https only, no credentials in URL); `validateUpload(file) -> { ok: true } | { ok: false, reason: string }` with `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` and `ALLOWED_UPLOAD_TYPES = ['image/jpeg','image/png','image/heic','image/webp','application/pdf']`; `sanitizeFileName(name) -> string` (keeps `[A-Za-z0-9._-]`, collapses others to `_`, max 120 chars); `withAuthor(data) -> data & { createdBy: uid, createdByEmail: email }` in `useFirestore.js` applied inside every `add*` helper.

- [ ] **Step 1: Write failing tests** for all four functions (javascript: scheme rejected, http rejected, https accepted, 26 MB rejected, `../../x.pdf` sanitized, `withAuthor` throws when signed out).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Apply**

Links render only when `safeHttpUrl` returns a value; otherwise show the file name as plain text with "Link unavailable". Upload inputs get `accept` from `ALLOWED_UPLOAD_TYPES`; `handleUpload` calls `validateUpload` first and shows `reason`. Storage path uses `sanitizeFileName`. Uploads record `uploadedBy: uid`.

- [ ] **Step 6: Lint, test, build. Commit** `git commit -m "Validate URLs and uploads, record authorship on client writes"`

---

### Task 9: Functions restructure and pure authorization helpers

**Files:**
- Create: `functions/lib/roles.js`, `functions/lib/scope.js`, `functions/lib/push-targets.js`
- Modify: `functions/index.js` (becomes an index re-exporting from `functions/oauth-quickbooks.js`, `functions/oauth-companycam.js`, `functions/companycam-sync.js`, `functions/push.js`, plus files added in Tasks 10 to 14)
- Test: `functions/test/roles.test.js`, `functions/test/scope.test.js`, `functions/test/push-targets.test.js` (node --test)

**Interfaces:**
- Produces:
  - `roles.js`: `isStaff(claims)`, `isOwner(claims)`, `requireStaff(req)`, `requireOwner(req)` (throw `HttpsError('permission-denied')`), `requireAuth(req)` (moved here).
  - `scope.js`: `scopeForJob(job) -> { tenantId: string, clientUids: string[] }` (tenantId defaults to `'qbs'` only here, documented as backfill default); `canActOnExtra(claims, extra) -> boolean` (staff, or builder with matching tenantId, or client uid in clientUids); `canReadJob(claims, job)`.
  - `push-targets.js`: `targetTokens(notif, tokenDocs, usersById) -> string[]` where `tokenDocs = [{ token, uid }]` and `usersById = { [uid]: { role, tenantId, clientJobIds } }`. Staff always; builders when `notif.tenantId === user.tenantId`; clients when `notif.jobId` is in `user.clientJobIds`. A notif with neither field targets staff only (Review Focus item 4).

- [ ] **Step 1: Write failing tests** for all helpers including Review Focus item 4.
- [ ] **Step 2: `cd functions && npm test`, FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Split `index.js` into the module files with no behavior change; `index.js` re-exports every function by the same name.**
- [ ] **Step 6: `npm test`, then `npx firebase deploy --only functions --dry-run` is not available; instead run `node -e "import('./index.js')"` from `functions/` to prove the module graph loads. Commit** `git commit -m "Split functions into modules and add pure authorization helpers"`

---

### Task 10: createUser callable, claims sync, Create User modal rewrite

**Files:**
- Create: `functions/users.js`
- Modify: `functions/index.js` (export `createUser`, `onUserWritten`)
- Modify: `src/App.jsx:399-527` (CreateUserModal), `src/components/shell/Sidebar.jsx:208` (owner only)
- Test: `functions/test/users.test.js` (pure validation), `tests/rules/users.test.mjs`

**Interfaces:**
- Produces:
  - `createUser({ email, displayName, role, tenantId, clientJobIds }) -> { uid }`. Owner only. Validates: email matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; role in the four; `tenantId` required for builder and must be `qbs` or `vision`; `clientJobIds` non empty array of `/^[A-Z]+-\d{3}$/` for client. Creates the Auth user with a random 32 byte password, sets claims `{ role, tenantId, clientJobIds }`, writes `users/{uid}` with the same fields plus `createdBy`, `createdAt`. Returns `{ uid }`. The browser then calls `sendPasswordResetEmail(auth, email)` so the person sets their own password.
  - `onUserWritten` on `users/{uid}`: sets custom claims from the document (`role`, `tenantId`, `clientJobIds`); for role client, `arrayUnion(uid)` on `clientUids` of every job whose `id` is in `clientJobIds` and `arrayRemove(uid)` from jobs previously listed (compare before and after).
  - `validateNewUser(input) -> { ok: true, value } | { ok: false, message }` exported for tests.

- [ ] **Step 1: Write failing tests** for `validateNewUser` (six cases from the validation list).
- [ ] **Step 2: FAIL. Step 3: Implement `users.js`. Step 4: PASS.**
- [ ] **Step 5: Rewrite `CreateUserModal`**

Fields: name, email, role (owner sees all four; the modal is owner only now), tenant (builder), client job ids (client). No password field. Submit calls `httpsCallable(functions, 'createUser')`, then `sendPasswordResetEmail(auth, email)`, then shows "Account created. {email} will receive an email to set their password." Errors from the callable render `e.message`. Sidebar shows Manage users for owner only. Give the modal `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus the first field on open, close on Escape.

- [ ] **Step 6: Rules test:** `internal writes users/x` fails for role owner (from Task 2) still passes. Lint, test, build, functions test. Commit** `git commit -m "Create users through an owner only callable and sync claims from user documents"`

---

### Task 11: Privileged actions as callables

**Files:**
- Create: `functions/extras.js`, `functions/inspections.js`, `functions/jobs.js`
- Modify: `functions/index.js`
- Modify: `src/hooks/useFirestore.js:273-331` (delete every Firestore fallback; each helper awaits the callable and rethrows)
- Modify: `src/components/ClientPortal.jsx:230-260`, `src/components/QBSBuilderPortal.jsx:410-446` (stop writing notifications and history from the browser; call `approveExtra`/`rejectExtra` with `{ extraId, note }`)
- Modify: `src/App.jsx` inspection handlers at `1635`, `1646`, `1103`
- Test: `functions/test/extras.test.js` (uses `canActOnExtra` and a pure `extraTransition(extra, action, actor, note) -> patch`)

**Interfaces:**
- Produces callables (all return `{ ok: true }` or throw `HttpsError`):
  - `approveExtra({ extraId, note? })`, `rejectExtra({ extraId, note })`: allowed when `canActOnExtra(claims, extra)`. Patch: `status` to `'Approved'` or `'Rejected'`, `approvedBy`/`rejectedBy: { uid, email, displayName }`, `approvedAt`/`rejectedAt: serverTimestamp()`, `rejectNotes`. Writes a `notifications` doc `{ type, msg, jobId: extra.job, tenantId, clientUids, createdAt, read: false }` and a `history` doc `{ kind: 'extra', extraId, action, actor, createdAt }`.
  - `sendExtraToBuilder({ extraId })`: staff only. Patch `status: 'Sent to Builder'`, `qbs: true`, `qbsSentAt`. Notification as above.
  - `passInspection({ jobDocId, trade, phase })`, `failInspection(...)`: staff only. Validates `trade in ['electrical','plumbing','hvac']`, `phase in ['roughIn','trim','final']`. Patch `insp.{trade}.{phase}` and `insp.{trade}.{phase}Date` ISO date. Notification.
  - `createJob(data)`: staff only. Requires `id` matching `/^[A-Z]+-\d{3}$/`, `name`, `tenantId` in the three. Rejects when a job with that `id` exists. Sets `clientUids: []`, `createdBy`, `createdAt`.
  - `extraTransition` pure helper exported for tests.

- [ ] **Step 1: Write failing tests** for `extraTransition` (approve sets Approved and approvedBy; reject requires note; unknown action throws).
- [ ] **Step 2: FAIL. Step 3: Implement the three modules. Step 4: PASS.**
- [ ] **Step 5: Update the browser**

Delete fallbacks; helpers throw. Portals wrap the calls in try, catch, finally; on error toast `e.message`. Remove the browser `addNotification` and `addHistory` calls in both portals for approve and reject. Status vocabulary written by the server is `Approved` and `Rejected` (matches `ChangeOrders.jsx`).

- [ ] **Step 6: Lint, test, build, functions test. Commit** `git commit -m "Move approvals, inspections and job creation into role checked callables"`

---

### Task 12: Scope stamping triggers and backfill

**Files:**
- Create: `functions/scope-sync.js`
- Modify: `functions/index.js`
- Test: `functions/test/scope-sync.test.js` (pure `scopePatchFor(job) -> { tenantId, clientUids }` and `needsRestamp(doc, job) -> boolean`)

**Interfaces:**
- Produces:
  - `onJobWritten` on `jobs/{id}`: when `tenantId` or `clientUids` changed, batch update every `extras`, `submits`, `notifications` doc with `job == job.id` or `jobId == job.id` to the new `{ tenantId, clientUids }`.
  - `onExtraWritten`, `onSubmitWritten`: when the doc lacks `tenantId` or `clientUids`, look up the job by `id` and stamp it.
  - `backfillScopes()` callable, owner only: for every job set `tenantId` (default `'qbs'` when missing) and `clientUids` from users with role client whose `clientJobIds` include the job id; then stamp extras, submits, notifications. Returns counts.

- [ ] **Step 1: Write failing tests** for `scopePatchFor` and `needsRestamp`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Add a Settings button "Backfill access scopes" (owner only) that calls `backfillScopes` and shows the counts.**
- [ ] **Step 6: Commit** `git commit -m "Stamp tenant and client scope onto scoped documents and add owner backfill"`

---

### Task 13: Scoped queries and tightened rules

**Files:**
- Modify: `src/hooks/useFirestore.js` (hooks take `scope`), `src/DataContext.jsx` (passes scope, deletes JavaScript filtering of jobs/extras/submits/notifs that rules now enforce, keeps nothing else), `src/App.jsx` (passes `scope = { role, tenantId, uid }` to `DataProvider`)
- Modify: `firestore.rules`, `storage.rules`
- Test: `tests/rules/scoped.test.mjs`, `tests/rules/storage.test.mjs`, `src/hooks/__tests__/queryFor.test.js`

**Interfaces:**
- Produces: `queryFor(collectionName, scope) -> Query` exported from `useFirestore.js`: staff gets the unscoped query; builder adds `where('tenantId', '==', scope.tenantId)`; client adds `where('clientUids', 'array-contains', scope.uid)`. Applies to `jobs`, `extras`, `notifications`, `submits`. All other collection hooks return `[]` immediately for non staff.
- Rules:
  - `jobs/{id}`: read if isStaff, or builder and `resource.data.tenantId == request.auth.token.tenantId`, or client and `request.auth.uid in resource.data.clientUids`. Write isStaff only. `jobs/{id}/files/{f}`: read if parent readable (same predicate via `get()` on the parent); create if isStaff, or client in parent `clientUids` with `request.resource.data.source == 'client-upload'` and `request.resource.data.uploadedBy == request.auth.uid`; update and delete isStaff.
  - `extras/{id}`: same read predicate on the extra's own fields. Write isStaff.
  - `notifications/{id}`: same read predicate. Create isStaff. Update allowed for any reader when the only changed key is `read` (`request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read'])`).
  - `submits/{id}`: same read predicate. Create if signedIn and `request.resource.data.createdBy == request.auth.uid` and (isStaff or `tenantId == token.tenantId` for builder or `jobId in token.clientJobIds` for client). Update isStaff or the creator when only `status` unchanged (replies live in subcollection: `submits/{id}/replies/{r}` create if parent readable and `createdBy == uid`).
  - `materials, subs, permits, daily_reports, urgent_items, history, supplier_invoices`: read and write isStaff.
  - Storage: `jobs/{jobDocId}/client-uploads/{file}` write if `request.auth != null` and (staff claim or `request.auth.uid in firestore.get(/databases/(default)/documents/jobs/$(jobDocId)).data.clientUids`) and size under 25 MB and `contentType` matches `image/.*` or `application/pdf`. Read if signed in. Every other path staff only.

- [ ] **Step 1: Write failing tests**

Rules: builder qbs reads job tenant qbs (ok), reads job tenant vision (fail), runs `where tenantId == vision` query (fail), runs `where tenantId == qbs` (ok); client reads job with own uid in clientUids (ok), without (fail), runs `array-contains own uid` query (ok), unscoped `jobs` query (fail); client marks notification read (ok), client edits notification msg (fail); client creates submit with own uid and own job (ok), with foreign job (fail); client creates `jobs/{j}/files` doc with `source client-upload` (ok), staff only field write by client (fail); storage: client uploads 1 MB `image/jpeg` to own job (ok), to another job (fail), `application/zip` (fail). `queryFor` unit test asserts the where clause per role. Review Focus items 2 and 3.

- [ ] **Step 2: FAIL. Step 3: Implement rules, storage rules, `queryFor`, hooks, `DataProvider`.**

`DataProvider` keeps `role`, `tenantId`, `uid` in the value for components. Empty state copy for scoped portals with zero jobs: "No projects are linked to your account yet. Contact P2 if you expected to see one here." (Review Focus item 3.)

- [ ] **Step 4: PASS everywhere. Step 5: Commit** `git commit -m "Enforce tenant and client read isolation in rules and scope portal queries"`

---

### Task 14: Targeted push fan out

**Files:**
- Modify: `functions/push.js` (`onNotificationCreated`)
- Test: covered by `functions/test/push-targets.test.js` from Task 9; add an integration style test of the token grouping function `groupTokens(tokenSnap) -> [{ token, uid }]`.

- [ ] **Step 1: Write failing test for `groupTokens`.** Step 2: FAIL. Step 3: Implement.
- [ ] **Step 4: Rewrite `onNotificationCreated`**: load tokens, collect distinct uids, load `users` docs in chunks of 10 with `getAll`, call `targetTokens`, send, prune dead tokens as today. Skip send when zero targets.
- [ ] **Step 5: PASS. Commit** `git commit -m "Send push notifications only to users in scope"`

---

### Task 15: Documentation and audit status

**Files:**
- Modify: `SECURITY.md` (rewrite "Known limitation" as resolved; document claims, scope fields, callables, backfill procedure)
- Modify: `README.md` (functions list, scripts, CI, seeding in emulator)
- Modify: `AUDIT.md` (add a Status column to section 6 marking items 1 to 14 and 19 as Done with commit refs)
- Modify: `src/components/Architecture.jsx` (list the real functions and rules summary; delete fictional entries)

- [ ] **Step 1: Update all four files.**
- [ ] **Step 2: Run the full gate: lint, test, test:rules, build, functions test.**
- [ ] **Step 3: Commit** `git commit -m "Document the security model and record audit progress"`

---

## Deployment notes for the owner (not automated)

1. Deploy rules and functions together: `firebase deploy --only firestore:rules,storage:rules,functions`.
2. Sign in as owner, open Settings, press "Backfill access scopes" once.
3. In the Firebase console, Authentication, review the user list for accounts you do not recognize and delete them. Review `users` documents missing a role.
4. Consider disabling email enumeration protection exceptions and enabling App Check in a later phase.
