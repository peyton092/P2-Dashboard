# Phase 2: Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make P2 Field Control the tool the company reaches for first: truthful at a glance, fast under a glove on a jobsite phone, consistent on every screen, and usable by keyboard and screen reader.

**Architecture:** One token system (CSS and a mirrored JS module) feeds every color, type and motion decision. One status vocabulary module feeds every pill, chart and filter. A small set of primitives (Field, Dialog, ConfirmDialog, Tabs, IconButton, Pill, ConnectionChip, DataTable) replaces hand rolled copies. Time is computed at render through `useNow` and a local date library. The Command Center becomes a "Today board" ranked by a single risk model. Both portals compose one portal kit. A Playwright plus axe harness screenshots every screen at phone and desktop widths against emulator seeded data in CI.

**Tech Stack:** React 19, Vite 8 (rolldown), Tailwind 4, Base UI (`@base-ui/react`), lucide-react, recharts 3, Geist Variable (body), Barlow Condensed (display), Geist Mono (data), vitest, @testing-library/react, vitest-axe, Playwright with @axe-core/playwright, Firebase emulators.

**Spec:** `AUDIT.md` sections 2 to 6 (items 15 to 18, 21 to 26) and the UX directive of 2026 10 18 ("Strengthen the UX and UI, greatest asset to the company alive"). The UI inventory that anchors this plan is summarized in the Design Direction below; file and line anchors in each task come from it and were current at commit `ce667ce`; the branch now sits on `889c404` and Task 0 carries the security foundation's residuals.

## Design Direction (binding for every task)

**Concept: the jobsite control board.** Dark graphite surfaces with a faint warm bias, one orange, hairline rules, condensed numerals. The screen should read like a well kept whiteboard in a shop office: what needs attention, what is blocked, what is ready to bill. Nothing decorative that is not information.

- **Color.** Brand orange `#F47920` is reserved for navigation state, primary actions, the brand mark and the focus ring. Semantic colors carry status only: success `#22c55e`, warning `#eab308`, critical `#ef4444`, info `#3b82f6`, cyan `#06b6d4`, neutral `#9ca3af`, mute `#6b7280`. Surfaces are oklch neutrals with a 0.004 chroma at hue 60 (warm). No other hex literal may exist outside `src/lib/tokens.js`, `src/index.css`, `index.html` and `public/`.
- **Type.** Display: Barlow Condensed 600 and 700 for page titles, KPI numerals, section eyebrows and the big date on the Today board. Body: Geist Variable. Data: Geist Mono for job ids, permit numbers, invoice numbers, dollar columns and timestamps. Numerals are always `tabular-nums`. Scale: 11, 12, 13, 14 (body), 16, 20, 24, 32, 44 px. Uppercase labels get `letter-spacing: .08em`.
- **Fill the screen (owner directive, 2026 10 18).** Every screen uses the full viewport width minus a 16 to 32 px gutter. No centered narrow column with empty sides: the `max-w-[1400px]` cap in `AppShell` and the portal content caps go; above 1800 px the content may cap at 1760 px. Nothing floats as a small bubble: KPI tiles become one full width stat band (figures separated by hairlines, numerals in display type), status reads as text with a leading dot rather than a pill wherever a pill would be the only thing in its row, and small rounded cards for single facts (a "next milestone" box, a "current phase" box) become labelled rows inside one panel. On phones every element fits the 390 px viewport with no horizontal scroll and no element narrower than its content. The client portal screen captured on 2026 10 18 (a 700 px column with floating boxes at 1280 px) is the reference for what not to do.
- **Space and shape.** 4 px grid. Radius 6 px on controls, 10 px on panels, 999 on pills (pills only for status inside a row that also carries text). Cards only for things that are objects (a job, a change order, a message), and then full width of their column. Lists are rows with hairline dividers, not stacks of cards.
- **Motion.** One orchestrated page enter (160 ms, 24 ms stagger per child, translate 6 px). Toast slide in 160 ms. No hover lift on non interactive elements. Everything inside `@media (prefers-reduced-motion: reduce)` collapses to opacity only or none.
- **Truth.** Every indicator reflects state the app can know: the connection chip reads the real Firestore sync state, dates are computed at render, numbers trace to recorded values with footnotes for what is excluded.
- **Touch.** Interactive targets at least 44 by 44 CSS px on screens under 768 px. Primary actions reachable by thumb (bottom bar or bottom sheet) on phones.
- **Copy.** Plain words. No dashes of any kind in user visible text (no em dash, no en dash, no hyphenated compounds where two words work: "Rough in", "On track", "Needs action"). Status labels are sentence case. Placeholders read "Not set" or "None recorded", never a bare dash.

## Global Constraints

- Every task runs `npm run lint`, `npm test`, `npm run build` before its commit; tasks that touch `firestore.rules` or `functions/` also run `npm run test:rules` and `cd functions && npm test`.
- The Phase 0 and 1 branch is the base. Nothing in this plan weakens any rule, callable or validation it introduced.
- Roles remain `owner | internal | builder | client`; scoped portals receive only scoped data (`DataProvider` with `scope`).
- No fabricated numbers. No dashes in user visible copy. No hex literals outside the token files. No `const O =` anywhere.
- Accessibility floor: WCAG 2.1 AA. Text under 18 px on dark surfaces uses `text-zinc-400` or lighter (`text-zinc-500` fails 4.5:1 on the app background); every control has a name; every dialog traps focus and closes on Escape; every interactive element is reachable and operable by keyboard.
- Component tests use `@testing-library/react` and import from `'vitest'` explicitly. Accessibility assertions use `vitest-axe` (`expect(await axe(container)).toHaveNoViolations()`).
- Commit messages: imperative subject under 72 characters; end with the two attribution trailer lines the session requires.

## Review Focus

1. A select popover opened from the Settings page must render dark text on a dark popover, not light theme colors, because Base UI portals to `document.body`. Test in Task 1 (axe contrast on an open select) and visually in Task 16.
2. A phone user with the Terms gate must be able to check the box and press Accept using only a keyboard or switch. Test in Task 6.
3. A job whose `insp` map is missing must render on every list and on the Today board without an error boundary. Test in Task 8 (rank helper) and Task 7 (row renders with `insp` undefined).
4. Leaving the tab open across midnight must advance the Today board date and every "days since" value without a reload. Test in Task 4 (`useNow` with fake timers).
5. A change order saved from the form with Status set to Approved must stay Approved, and a Submit Invoice without an amount must be refused with a message, not written. Test in Task 11.

---

### Task 0: Carry overs from the security foundation (do first)

**Why this task exists.** The final review of the Phase 0 and 1 branch left small residuals that are safe to ship but should not linger. Each is one contained change with a test.

**Files:** `functions/scope-sync.js`, `functions/extras.js`, `functions/test/scope-sync.test.js`, `functions/test/extras-handlers.test.js`, `src/components/SettingsPage.jsx`, `src/components/Architecture.jsx`, `functions/push.js`, `src/hooks/useFirestore.js`, `SECURITY.md`.

- [ ] **Drafts carrying a scope.** In `stampFromJob` (scope-sync.js) a draft change order that carries `tenantId` or `clientUids` has both fields deleted in its transaction (its own trigger then reads an unscoped draft and returns). In `functions/extras.js` `scopeOf` resolves a draft's scope from its job on send instead of trusting a carried scope. Tests for both.
- [ ] **Backfill counts.** Unscoped drafts are counted under a `drafts` count, not `skipped`; the Settings toast says "n drafts stay staff only until they are sent." (no dashes). Tests.
- [ ] **Architecture chips comment.** `urgent_items` shows resolved, createdBy and createdAt; say so. The client uploads row says "listable by any signed in account that knows the job id".
- [ ] **push.js uid filter.** Extend the guard to reject `.`, `..`, `__name__` style ids and ids over 1500 bytes; the comment lists exactly what it covers. Test.
- [ ] **Staff claims and deleted documents.** Document in SECURITY.md that offboarding a hand set staff account means writing the staff role into its users document first, then deleting it (a deletion over a document that never held the staff role keeps the claims).
- [ ] **Deferred test hygiene.** Split `functions/test/scope-sync.test.js` by trigger; remove the `console.error` mutes that hide act warnings in `ExtraApprovals.test.jsx` by wrapping the Brand renders in act or asserting the expected logs.
- [ ] **Gate and commit** `git commit -m "Carry the security foundation residuals forward"`

---

### Task 1: Theme foundation and token module

**Files:**
- Modify: `index.html` (add `class="dark"` to `<html>`, keep splash)
- Modify: `src/index.css`
- Create: `src/lib/tokens.js`
- Modify: `package.json` (add `@fontsource/barlow-condensed`, `@fontsource-variable/geist-mono`, `vitest-axe`)
- Modify: the 39 files declaring `const O = '#F47920'` (list in inventory: `App.jsx`; 22 components; `brand/Brand.jsx`; 10 `shared/*`; `shell/MobileNav.jsx`, `shell/Sidebar.jsx`; `ui/toast.jsx`; `lib/briefing.js`, `lib/inspections.js`), plus `ChangeOrders.jsx:767` inline literal, `generateCOPdf.js:4` and `generateInvoicePdf.js:8` (`ORANGE` RGB)
- Modify: the 12 per screen `dark` class applications (`AppShell.jsx:15`; `App.jsx:320, 557, 3514, 3695, 3711, 3800`; `NoAccessScreen.jsx:10`; `ClientPortal.jsx:838, 848`; `QBSBuilderPortal.jsx:1051, 1061`; `CommandPalette.jsx:136`)
- Test: `src/__tests__/tokens.test.js`, `src/components/ui/__tests__/select.a11y.test.jsx`

**Interfaces:**
- Produces `src/lib/tokens.js`: `BRAND = '#F47920'`, `SEMANTIC = { success, warning, critical, info, cyan, neutral, mute }` (hex values above), `TONE_HEX = { brand: BRAND, ...SEMANTIC }`, `withAlpha(hex, alpha) -> rgba string` (replaces the `hex + '22'` concatenations), `hexToRgb(hex) -> [r, g, b]` (for jsPDF), `FONT = { display, body, mono }` family strings.
- CSS tokens on `.dark` and `:root`: `--brand`, `--brand-foreground`, `--success`, `--warning`, `--critical`, `--info`, `--cyan`, `--neutral`, `--mute`, `--surface-1`, `--surface-2`, `--surface-3`, `--font-display`, `--font-mono`, `--ease-out`, `--dur-fast: 120ms`, `--dur-base: 160ms`; `@theme inline` maps each to a Tailwind color or font utility (`bg-brand`, `text-success`, `font-display`, `font-mono`).

- [ ] **Step 1: Write failing tests.** `tokens.test.js`: reads every file under `src/` and asserts (a) no file other than `src/lib/tokens.js` and `src/index.css` contains `#F47920` or `#f47920`; (b) no file contains `const O =`; (c) every `--brand`, `--success`, `--warning`, `--critical`, `--info` value in `index.css` equals the matching `tokens.js` export. `select.a11y.test.jsx`: renders `Select` with two items inside a `<div class="dark">`, opens it, runs axe on `document.body`, expects no violations (today the popover inherits light tokens from body).
- [ ] **Step 2: Run, expect FAIL** (39 `const O` hits; axe contrast violation on the popover).
- [ ] **Step 3: Implement.** `index.html`: `<html lang="en" class="dark">`. Remove the 12 per screen `dark` classes (keep the wrapper elements). In `index.css`: add the tokens to `.dark` with warm neutral surfaces (`--background: oklch(0.145 0.004 60)`, `--surface-1: oklch(0.165 0.004 60)`, `--surface-2: oklch(0.205 0.004 60)`, `--surface-3: oklch(0.269 0.004 60)`), set `color-scheme: dark` on `.dark`; delete `--sidebar*` and `--chart-*` tokens and their `@theme` lines; keep exactly one `:focus-visible` rule (brand outline, 2 px, offset 2 px, radius 6 px, `:where(...)` form) and delete the layered duplicate; replace the three `oklch(0.165 0 0)` literals with `var(--surface-1)`; import `@fontsource/barlow-condensed/600.css`, `/700.css`, `@fontsource-variable/geist-mono`; `--font-display: 'Barlow Condensed', 'Arial Narrow', sans-serif`, `--font-mono: 'Geist Mono Variable', ui-monospace, monospace`; `h1` uses `font-display text-[32px] font-bold tracking-tight`; `h2` `font-display text-[24px] font-semibold`. Create `tokens.js`. Replace every `const O` with `import { BRAND } from '@/lib/tokens'` and `O` usages with `BRAND`; replace `color + '22'` style concatenations with `withAlpha(color, 0.13)`; PDF libs use `hexToRgb(BRAND)`. Do not restyle components in this task beyond the mechanical replacement.
- [ ] **Step 4: Run tests, lint, build; expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add design tokens, display and mono fonts, and move dark theme to the document"`

---

### Task 2: One status vocabulary

**Files:**
- Create: `src/lib/status.js`
- Delete: `src/components/shared/legacy-badge-meta.js`, `src/components/shared/legacy-badges.jsx`
- Modify: `src/components/shared/badges.jsx` (maps come from `status.js`), `src/components/shared/inline-edits.jsx` (`JOB_STATUS_OPTIONS`, `PHASE_OPTIONS` from `status.js`; the menu offers every job status), `src/components/shared/index.js`, `src/lib/billing.js`, `src/lib/inspections.js`, `src/lib/materials.js`, `src/lib/subs.js`, `src/lib/notifications.js`, `src/lib/jobs.js`
- Modify consumers: `JobDetail.jsx:22-31, 45` (`ISTATUS`, `CO_TONE`), `WarRoom.jsx:502-514` (`StatusPill`), `Analytics.jsx:12, 109-110`, `ChangeOrders.jsx:38-48, 84-94, 117-120, 782-790`, `QBSBuilderPortal.jsx:59-65, 405-472, 1388-1390`, `ClientPortal.jsx:59-64, 233+, 352-357`, `AlertsPage.jsx:27-41`, `PMDashboard.jsx:218-225`, `briefing.js:26-37`, `agent/alerts.js:275-285`, `App.jsx:233` (`tradeColor`), `App.jsx:1517, 2513`, `Permits.jsx:55, 83`, `CommandCenter.jsx:654-659`, `Calendar.jsx:10-15`, `BillingQueue.jsx` `hold` handling
- Test: `src/lib/__tests__/status.test.js`

**Interfaces:**
- `status.js` exports: `JOB_STATUS`, `INSPECTION_STATUS`, `BILLING_STATUS` (adds `hold` with label "On hold", tone warning), `CO_STATUS` (keys `Draft`, `Sent to Builder`, `Approved`, `Rejected`; labels "Draft", "Sent to builder", "Approved", "Rejected"), `MATERIAL_STATUS`, `SUB_STATUS`, `SEVERITY`, `NOTIF_TYPE`, `TRADE` (electrical, plumbing, hvac with label and tone), `PHASE` (precon, rough-in, service-release, trim, final, closeout, complete with labels "Precon", "Rough in", "Service release", "Trim", "Final", "Closeout", "Complete"). Each map is `{ key: { label, tone, order } }`. Helpers: `statusMeta(map, key) -> { label, tone, order }` (unknown key gives `{ label: 'Unknown', tone: 'mute', order: 99 }`), `toneHex(tone)` (from `tokens.js`), `normalizeCoStatus(raw)` (`pending` and `sent-to-qbs` give `Sent to Builder`; lowercase `approved`, `rejected`, `draft` give the capitalized key; unknown gives `Draft`), `isCoAwaitingBuilder(extra)`, `isJobComplete(job)` (moved from `jobs.js`, re-exported there).

- [ ] **Step 1: Write failing tests:** every key in every map has a non empty `label`, a `tone` in `TONE_HEX`, and a numeric `order`; no label contains `-` or `—`; `normalizeCoStatus('pending')` is `Sent to Builder`; `statusMeta(JOB_STATUS, 'bogus').label` is `Unknown`; `BILLING_STATUS.hold.label` is `On hold`.
- [ ] **Step 2: FAIL. Step 3: Implement and migrate every consumer listed; delete the two legacy files; `shared/index.js` exports only `Pill` based badges.**
- [ ] **Step 4: PASS; grep `src/` for `inspMeta|statusMeta|iMeta|sMeta|InspBadge|JobBadge|STATUS_COLOR|ISTATUS|CO_TONE|INSP_COLORS|PHASE_STATUS|BILLING_META|TONE_COLOR|SEVERITY_COLOR` and include the (empty) output in the report.**
- [ ] **Step 5: Commit** `git commit -m "Define one status vocabulary and delete duplicate status maps"`

---

### Task 3: Primitives

**Files:**
- Create: `src/components/ui/dialog.jsx` (`Dialog`, `DialogTitle`, `DialogBody`, `DialogFooter`), `src/components/ui/confirm-dialog.jsx` (`ConfirmDialog`), `src/components/ui/tabs.jsx` (`Tabs`, `TabList`, `Tab`, `TabPanel`), `src/components/ui/field.jsx` (`Field`), `src/components/ui/icon-button.jsx` (`IconButton`), `src/components/shared/StatBand.jsx` (`StatBand`), `src/hooks/useMediaQuery.js`
- Modify: `src/components/shell/AppShell.jsx:21` (remove the `max-w-[1400px] mx-auto` cap; keep gutters; cap at `max-w-[1760px]` only above 1800 px via a `2xl:` utility)
- Modify: `src/components/shared/ProgressBar.jsx` (tone prop from `status.js`), delete `src/components/ui/progress.jsx`, `src/components/ui/badge.jsx`, `src/components/ui/badge-variants.js` (unused)
- Modify: `Permits.jsx:16`, `ProjectFolders.jsx:19`, `SubmitInbox.jsx:17`, `Architecture.jsx:13` (delete local `SectionHeader`, import shared)
- Test: `src/components/ui/__tests__/dialog.test.jsx`, `tabs.test.jsx`, `field.test.jsx`, `icon-button.test.jsx`, `src/hooks/__tests__/useMediaQuery.test.js`

**Interfaces:**
- `Dialog({ open, onClose, title, description?, children, size = 'sm'|'md'|'lg', initialFocusRef? })`: built on `@base-ui/react` Dialog; renders `role="dialog" aria-modal="true" aria-labelledby`; traps focus; Escape and scrim click call `onClose`; returns focus to the opener; scrim `bg-black/70`; panel `bg-surface-2 border border-white/10 rounded-[10px]`.
- `ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', tone = 'brand'|'critical', busy })`: two buttons, Cancel first in DOM, confirm button disabled while `busy` with the label "Working".
- `Tabs({ value, onChange, children })`, `TabList({ 'aria-label' })`, `Tab({ value, count? })`, `TabPanel({ value })`: roles tablist, tab (`aria-selected`, `aria-controls`), tabpanel; Left and Right arrows move focus and selection; Home and End.
- `Field({ id, label, hint?, error?, required?, children })`: renders `<label htmlFor={id}>`, clones the single child with `id`, `aria-describedby` (hint and error ids), `aria-invalid` when `error`; error text in `text-critical`.
- `IconButton({ label, children, ...buttonProps })`: `type="button"`, `aria-label={label}`, 44 px hit area under 768 px (`min-h-11 min-w-11 md:min-h-9 md:min-w-9`); throws in development when `label` is missing.
- `useMediaQuery(query) -> boolean` using `matchMedia` with a change listener; false during SSR or when `matchMedia` is absent.
- `StatBand({ stats: [{ label, value, sub?, note?, tone?, onClick? }] })`: one full width strip, `grid-cols-2 md:grid-cols-4 xl:grid-flow-col xl:auto-cols-fr`, cells separated by hairline borders (no rounded tile per stat), label in 11 px uppercase, value in `font-display` 32 px tabular, optional `sub` and `note` lines; a cell with `onClick` renders as a `<button>` spanning the cell. Replaces every row of `MetricTile` across the app (CommandCenter, BillingQueue, WarRoom, PMDashboard, AlertsPage, ChangeOrders, JobStatus, Inspections, Subs, Materials, both portals' `PortalStat` rows). `MetricTile` is deleted when no caller remains.

- [ ] **Step 1: Write failing tests.** Dialog: opens with focus inside, Escape calls `onClose`, Tab from the last focusable wraps to the first, axe clean. Tabs: Right arrow moves selection, `aria-selected` and `aria-controls` present, axe clean. Field: label associated by id, error sets `aria-invalid` and `aria-describedby`. IconButton: renders `aria-label`, `type="button"`. useMediaQuery: returns the mocked `matches` and updates on change.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add dialog, tabs, field and icon button primitives"`

---

### Task 4: Connection truth and local dates

**Files:**
- Create: `src/lib/dates.js`, `src/hooks/useNow.js`, `src/hooks/useConnectionState.js`, `src/components/shared/ConnectionChip.jsx`
- Modify: `src/components/shared/headers.jsx` (`PageHeader` gets `live` prop, default true, renders `ConnectionChip` in `meta`)
- Modify: delete the 13 hard coded Live dots (`App.jsx:687-689, 1094-1096, 1788-1790, 2154-2156, 2692-2694, 3248-3250`; `BillingQueue.jsx:275-276`; `ChangeOrders.jsx:566-567`; `AlertsPage.jsx:289-291`; `PMDashboard.jsx:327-329`; `WarRoom.jsx:322-323`; `CommandCenter.jsx:294-295`; `TeamLeaderboard.jsx:472-475`)
- Modify: module level date constants (`App.jsx:236-247`, `agent/scoring.js:1-10`, `BillingQueue.jsx:30`, `WarRoom.jsx:32`, `PMDashboard.jsx:27`, `CommandCenter.jsx:28`, `ClientPortal.jsx:38`, `QBSBuilderPortal.jsx:38`, `ChangeOrders.jsx:98`, `CrewReport.jsx:49`, `TeamLeaderboard.jsx:42-45`, `Calendar.jsx:36`) and UTC slices (`ChangeOrders.jsx:55`, `InvoiceAuditor.jsx:32`, `CrewReport.jsx:245`, `App.jsx:238, 1047`, `CommandCenter.jsx:119`)
- Test: `src/lib/__tests__/dates.test.js`, `src/hooks/__tests__/useNow.test.js`, `src/hooks/__tests__/useConnectionState.test.js`

**Interfaces:**
- `dates.js`: `toLocalDateStr(d = new Date()) -> 'YYYY-MM-DD'` (local zone), `parseDateStr(s) -> Date | null` (accepts `YYYY-MM-DD` as local midnight and `MM/DD/YYYY`), `daysBetween(a, b)`, `daysSince(dateLike, now)`, `startOfLocalDay(d)`, `monthKey(d) -> 'YYYY-MM'` (local), `fmtLongDate(d)` ("Saturday, October 18, 2026").
- `useNow(intervalMs = 60000) -> Date` re-rendering on the interval and on `visibilitychange`.
- `useConnectionState() -> 'online' | 'offline' | 'syncing'`: `offline` when `navigator.onLine` is false; otherwise `syncing` until the first `onSnapshotsInSync` after a change and when the probe snapshot has `metadata.fromCache && hasPendingWrites`; else `online`. Probe: `onSnapshot(doc(db, 'config', 'settings'), { includeMetadataChanges: true }, ...)` (readable by every signed in user) plus `onSnapshotsInSync(db, ...)`.
- `ConnectionChip` renders a dot plus text: "Live" (success), "Syncing" (warning), "Offline" (critical); `role="status"`, `aria-live="polite"`; never a bare dot.
- `scoring.js` functions take `now` as the last parameter with `new Date()` default; no module level date.

- [ ] **Step 1: Write failing tests:** `toLocalDateStr` for a Date at 23:30 local equals the local day (mock `TZ` via `vi.setSystemTime` with an explicit offset case); `parseDateStr('03/10/2026')` and `('2026-03-10')` both equal local midnight March 10; `useNow` advances after `vi.advanceTimersByTime(60000)` (Review Focus item 4); `useConnectionState` reports `offline` when `navigator.onLine` is false and `online` after the mocked `onSnapshotsInSync` fires.
- [ ] **Step 2: FAIL. Step 3: Implement; replace every constant and slice; `PageHeader` renders the chip; delete the 13 dot duplicates.**
- [ ] **Step 4: PASS; grep for `toISOString().slice(0` and `= new Date()` at module scope and include the (empty) output.**
- [ ] **Step 5: Commit** `git commit -m "Compute time at render and show the real connection state"`

---

### Task 5: Feedback layer for every mutation

**Files:**
- Create: `src/hooks/useMutation.js`
- Modify: `src/components/ui/toast.jsx` (add `action` button support for Undo, 8 s duration for undoable toasts)
- Modify: every mutation handler: `App.jsx` (`handleCreateJob`, Materials `handleSave` and `handleStatusChange`, `Notifications.markAll`, dismiss, `PhaseRow`, inspection pass and fail, inline selects in `shared/inline-edits.jsx`), `QBSBuilderPortal.jsx` (`handleNew`, `handleReply`, status select, mark read), `ClientPortal.jsx` (`handleNew`, `handleReply`), `SubmitInbox.jsx` (send, reply, status), `AlertsPage.jsx` (`applyAction`, resolve, snooze, dismiss, rescan), `BillingQueue.jsx` (submit invoice, invoice number), `PMDashboard.jsx` (`NextActionInput`), `TeamLeaderboard.jsx` (bonus, referral, save), `InvoiceAuditor.jsx` (status select), `ChangeOrders.jsx` (`saveCO`), `SettingsPage.jsx` (toggles, password, disconnects now on `ConfirmDialog`)
- Modify: `PMDashboard.jsx:720-731` and `BillingQueue.jsx:620-629` inline inputs resync from props (`key={job._docId + ':' + job.nextAction}` or an effect) so blur never writes a stale value
- Test: `src/hooks/__tests__/useMutation.test.jsx`, `src/components/__tests__/NotificationsDismiss.test.jsx`

**Interfaces:**
- `useMutation() -> { run, busy, error }` where `run(fn, { pending?, success, error = 'Something went wrong. Try again.', undo? })` sets `busy` true, awaits `fn()`, toasts `success` (with an Undo action when `undo` is provided; Undo calls `undo()` and toasts "Undone"), toasts `error` with `e.message` appended when the thrown error has a message, always resets `busy` in `finally`, and never rethrows.
- Destructive or consequential actions open `ConfirmDialog` first: dismiss notification (undoable instead of confirmed), mark inspection failed, disconnect QuickBooks or CompanyCam (replaces `window.confirm` at `SettingsPage.jsx:145, 190`), dismiss or resolve alert, remove change order line item, submit invoice, approve or reject change order (reason required on reject).

- [ ] **Step 1: Write failing tests:** `useMutation` resets `busy` after a rejected `fn`, calls the toast with the error message, calls `undo` when the toast action is clicked; Notifications dismiss shows an Undo toast and clicking it writes `dismissed: false` (mock the hooks module).
- [ ] **Step 2: FAIL. Step 3: Implement and adopt in every handler listed. No handler may remain fire and forget: grep `await (update|add|set)` calls not inside `run(` and justify each remaining one in the report.**
- [ ] **Step 4: PASS. Step 5: Commit** `git commit -m "Report every write with a toast and confirm destructive actions"`

---

### Task 6: Accessibility sweep

**Files:**
- Modify: `App.jsx` TermsGate (`div onClick` checkbox near 579 becomes `<input type="checkbox">` inside a `<label>`), `CreateUserModal` (on `Dialog`), `JobStatusRow`, `SubRow`, `NotificationCard` (row header is a `<button>` with `aria-expanded` and `aria-controls`; inline selects and links sit outside the button), `LoginScreen` and all forms (`Field`), `JobFormField` and `FormFieldLabel` deleted in favor of `Field`
- Modify: `shell/MobileNav.jsx` (drawer on `Dialog` with `aria-label="More pages"`, `aria-current="page"` on the active item, 44 px targets), `shell/Sidebar.jsx` (`aria-current="page"`, `title` kept, skip link target), `shell/AppShell.jsx` (`<a href="#main" class="sr-only focus:not-sr-only">Skip to content</a>`, `<main id="main" tabIndex={-1}>`)
- Modify: `CrewReport.jsx:54-115` (`FieldLabel` becomes `Field`; `WorkCheckbox` becomes a real checkbox; `YesNoToggle` gets `aria-pressed`), icon only buttons (`ChangeOrders.jsx:174, 329`; `InvoiceAuditor.jsx:179, 295`; `TeamLeaderboard.jsx:177, 295, 318, 502`) become `IconButton`; unlabeled `<select>`s (`ChangeOrders.jsx:663`, `WarRoom.jsx:398, 408`, `BillingQueue.jsx:375, 383`) get `aria-label`; `<p>` inside `<button>` (`PMDashboard.jsx:492-553`, `CommandCenter.jsx:458-473`) become `<span class="block">`; color only statuses get text (`Calendar.jsx` pass or fail word, `InvoiceAuditor.jsx:359-360` flag text, `WarRoom.jsx:113-133` pending label); `text-zinc-500` on text under 18 px becomes `text-zinc-400`; every `<button>` without `type` gets `type="button"`
- Modify: portal tab strips (`QBSBuilderPortal.jsx:1110-1138, 1274-1304`; `ClientPortal.jsx:884-898, 1016-1038`) on the `Tabs` primitive
- Modify: `CommandPalette.jsx` (`aria-modal`, `role="listbox"` and `role="option"` with `aria-activedescendant`, no scroll on mouse hover)
- Test: `src/__tests__/a11y/*.test.jsx` running axe on: LoginScreen, NoAccessScreen, TermsGate, CreateUserModal (open), MobileNav (drawer open), Sidebar, PageHeader with chip, one JobStatusRow, CommandPalette (open), portal Tabs

**Interfaces:** none new; this task consumes Task 3 primitives.

- [ ] **Step 1: Write failing axe tests** for the ten targets above plus a keyboard test: TermsGate checkbox toggles with Space and Accept becomes enabled (Review Focus item 2).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Make every screen operable by keyboard and screen reader"`

---

### Task 7: Lists render once per breakpoint

**Files:**
- Modify: `src/components/shared/lists.jsx` (`ResponsiveTable` becomes `DataTable`: sticky header, `aria-sort` on sortable headers, rows are `<tr>` with a focusable primary cell button, zebra off, hairline dividers; `TableRow onClick` removed)
- Modify: `BillingQueue.jsx:403-434`, `ChangeOrders.jsx:706-747`, `WarRoom.jsx:462-492` (render `isDesktop ? <DataTable> : <ul>` via `useMediaQuery('(min-width: 768px)')`); `App.jsx` `JobStatusRow` progress (`1445-1474`) renders one variant; `Permits.jsx:43` grid becomes `grid-cols-1 sm:grid-cols-3`
- Modify: mobile cards get the primary action as a full width 44 px button at the bottom
- Test: `src/components/__tests__/ResponsiveLists.test.jsx` (with mocked `matchMedia`: BillingQueue renders a table and no `<ul>` at desktop, a `<ul>` and no `<table>` at phone), `src/components/shared/__tests__/DataTable.test.jsx` (Enter on a row's primary button fires `onOpen`; `aria-sort` toggles)

- [ ] **Step 1: Write failing tests** (also: a job without `insp` renders a row without throwing, Review Focus item 3).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Render one list layout per breakpoint and make rows keyboard operable"`

---

### Task 8: Command Center as the Today board

**Files:**
- Modify: `src/agent/scoring.js` (export `RISK_THRESHOLDS = { staleCritical: 7, staleWarn: 3, staleInfo: 2 }`, `rankNeedsAction(jobs, extras, now) -> [{ job, reason, severity }]`, `blockedItems(jobs, extras, now)`, `moneyBoard(jobs, extras) -> { ready, aging, approvedUnbilled }` using `money.js`); delete local thresholds in `CommandCenter.jsx:205-206`, `WarRoom.jsx:96-97`, `PMDashboard.jsx:72-73`, `agent/alerts.js:17, 31, 37` (import from scoring); unify the three `isBillingReady` definitions into `scoring.js` one
- Modify: `src/components/CommandCenter.jsx` (rewrite layout): header band with `font-display` 44 px local date (`useNow`), `ConnectionChip`, tenant and role; KPI row of four `MetricTile` (Needs action, Blocked, Ready to invoice, Aging) with `missingNote` footnotes; three stacks (`Needs you now`, `Blocked and waiting`, `Money`) that collapse to one column under 1024 px; each row opens the job via `p2:open-job`; the inspection donut keeps its place with a text legend showing counts; "Missing Documentation" tile relabeled "No permit number" with count only
- Modify: `Analytics.jsx:109-110` uses `normalizeCoStatus`; `Analytics.jsx:126` excludes Rejected from totals
- Test: `src/agent/__tests__/scoring.test.js` (`rankNeedsAction` orders a failed inspection above a stale job above a pending CO; a job with `insp` undefined ranks without throwing; thresholds exported and equal across consumers by grep test), `src/components/__tests__/CommandCenter.test.jsx` (renders the date from a fixed `now`, renders footnote when a job lacks contract value, renders the empty state copy when no jobs)

**Interfaces:** `rankNeedsAction` returns `severity` in `critical | warning | info` and `reason` as a plain sentence ("Electrical rough in failed 3 days ago", "No status change in 9 days", "Change order waiting on builder for 5 days").

- [ ] **Step 1: Write failing tests. Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Rebuild the Command Center as a ranked Today board"`

---

### Task 9: Portal kit

**Files:**
- Create: `src/components/portal/PortalShell.jsx`, `ChangeOrderCard.jsx`, `InspectionTimeline.jsx`, `MessageThread.jsx`, `PortalStat.jsx`, `portalCopy.js`
- Modify: `QBSBuilderPortal.jsx` and `ClientPortal.jsx` shrink to composition (target under 400 lines each); `SubmitInbox.jsx` uses `MessageThread`
- Delete: the duplicated helpers listed in the audit (`QBSBuilderPortal.jsx:33-224, 399-592, 596-913, 1309-1328`; `ClientPortal.jsx:31-154, 224-346, 499-708, 762-775`) once the kit covers them
- Test: `src/components/portal/__tests__/ChangeOrderCard.test.jsx` (approve opens ConfirmDialog, confirm calls the `approveExtra` callable mock, reject requires a reason), `MessageThread.test.jsx` (send disabled when empty, reply appears optimistic then settles), `PortalShell.test.jsx` (tabs have roles, bottom bar at phone width, axe clean)

**Interfaces:**
- `PortalShell({ title, subtitle, tabs: [{ id, label, count? }], activeTab, onTabChange, onLogout, children })` renders desktop `Tabs` and a phone bottom tab bar (44 px targets) from the same list, plus `ConnectionChip`. Content spans the full viewport width with the same gutters as `AppShell`; no centered column. Project cards in the client portal become one full width panel per project with labelled rows (next milestone, current phase, P2 contact) and the inspection timeline as a full width stepper, replacing the floating boxes.
- `ChangeOrderCard({ extra, canAct, onApprove(extraId), onReject(extraId, reason) })`.
- `InspectionTimeline({ job })` with text labels per phase and tone from `status.js`.
- `MessageThread({ messages, onSend(text), onReply(id, text), busy, emptyCopy })`.
- `portalCopy.js`: `NO_PROJECTS = 'No projects are linked to your account yet. Contact P2 if you expected to see one here.'` and the other portal strings, dash free.

- [ ] **Step 1: Write failing tests. Step 2: FAIL. Step 3: Implement and migrate both portals and SubmitInbox. Step 4: PASS; report line counts of both portal files.**
- [ ] **Step 5: Commit** `git commit -m "Build one portal kit and compose both portals from it"`

---

### Task 10: Job hub and deep links

**Files:**
- Modify: `src/components/JobDetail.jsx` (sticky summary bar: name, id in mono, status pill, PM, next action; sections Timeline, Change orders, Money, Files, Messages, Activity; back returns to the previous tab)
- Create: `src/lib/deepLink.js` (`parseHash(hash) -> { tab?: string, jobId?: string } | null` for `#tab-<id>` and `#job-<JOBID>`, `hashFor(state)`), `src/hooks/useHashRoute.js`
- Modify: `App.jsx` `MainDashboard` reads the hash on mount and writes it on tab or job change; `Sidebar` highlights `jobs` while `job-detail` is active
- Test: `src/lib/__tests__/deepLink.test.js`, `src/components/__tests__/JobDetail.test.jsx` (renders every section heading, money uses `fmtMoney`, missing `insp` tolerated)

- [ ] **Step 1: Write failing tests. Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Turn job detail into the job hub with shareable links"`

---

### Task 11: Forms that cannot lose data

**Files:**
- Modify: `App.jsx` Materials form (`handleSave` builds the patch without resetting `cost` on edit), New Job form, Settings password (all on `Field`)
- Modify: `ChangeOrders.jsx` form (`saveCO` honors the Status select; `qbs` set only when sending; unsaved changes guard via `beforeunload` and an in app `ConfirmDialog` when switching tabs with a dirty form)
- Modify: `BillingQueue.jsx` Submit Invoice opens a dialog capturing `invoiceNum`, `invoiceAmount` (required, `> 0`), `invoiceDate` (local date, default today) and writes `billingStatus: 'invoiced'` with those fields
- Create: `src/lib/forms.js` (`buildMaterialPatch(form, { editing })`, `buildCoPatch(form, action)`, `buildInvoicePatch(input) -> { ok, patch } | { ok: false, message }`)
- Test: `src/lib/__tests__/forms.test.js` (edit patch has no `cost` key unless the field changed; `buildCoPatch` with Status Approved keeps Approved; `buildInvoicePatch` without amount returns the message "Enter the invoiced amount before submitting."; Review Focus item 5)

- [ ] **Step 1: Write failing tests. Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Fix material, change order and invoice forms and guard unsaved changes"`

---

### Task 12: Motion, skeletons and polish

**Files:**
- Modify: `src/index.css` (`.p2-page-enter` with child stagger via `--i`, durations from tokens, reduced motion collapse), `src/components/shared/Skeleton.jsx` (`TableSkeleton`, `TilesSkeleton`, `CardsSkeleton`, `ThreadSkeleton` shaped like the real layouts), every page `loading` branch uses the matching skeleton, `Analytics.jsx:143` uses `Skeleton`, `index.html` splash background equals `--background`
- Modify: `ui/button-variants.js` (pressed state `active:translate-y-px`, focus ring from brand token), `ui/toast.jsx` (enter and exit transitions)
- Test: `src/__tests__/motion.test.js` (every `@keyframes` or `transition` class in `index.css` has a `prefers-reduced-motion` override; grep based)

- [ ] **Step 1: Write failing test. Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Shape skeletons to their layouts and tune motion with reduced motion support"`

---

### Task 13: Charts from tokens, readable by everyone

**Files:**
- Modify: `Analytics.jsx` (colors from `TONE_HEX`; `DarkTooltip` from tokens; each chart wrapped in a `figure` with `role="img"` and an `aria-label` summary plus a visible legend with values; empty state when the series is empty), `CommandCenter.jsx` donut (same)
- Test: `src/components/__tests__/Analytics.test.jsx` (renders legend values, renders the empty state with no jobs, axe clean)

Implementer must load the `dataviz` skill before writing chart code and follow its palette, mark and interaction rules with the token colors as the palette.

- [ ] **Step 1: Write failing tests. Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Style charts from tokens and add text equivalents"`

---

### Task 14: Copy and vocabulary pass

**Files:**
- Modify: every user visible string containing an em dash, en dash or a hyphenated compound that two words express (`grep -rn "—\|–" src` and the status labels), bare `'—'` placeholders become "Not set" or "None recorded", misleading labels ("Closed in last 24h" becomes "Resolved today"; "{n} ever" becomes "{n} in the latest 50"; "Missing Documentation" handled in Task 8), `TermsGate` version read from `settings.termsVersion` with the current constant as fallback
- Create: `src/__tests__/copy.test.js` (reads every `.jsx` under `src/`, extracts JSX text nodes and string literals passed to `label`, `title`, `placeholder`, `aria-label`, and asserts none contains `—`, `–`, or ` - ` ; allowlist file `src/__tests__/copy.allowlist.json` for code identifiers)

- [ ] **Step 1: Write failing test. Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** `git commit -m "Rewrite user visible copy in plain words without dashes"`

---

### Task 15: Performance

**Files:**
- Modify: `ChangeOrders.jsx:511-554` (memoize derivations), `PMDashboard.jsx:100-111` (one pass over extras), `InvoiceAuditor.jsx:44, 346-349, 492-515` (precomputed vendor and invoice maps), `TeamLeaderboard.jsx:79-99` (one collection listener), `WarRoom.jsx:195-207, 271-285` (shared filter pass)
- Modify: `vite.config.js` (`build.rolldownOptions.output.codeSplitting` groups: `vendor-firebase`, `vendor-charts` (recharts), `vendor-pdf` (jspdf), `vendor-ui` (@base-ui/react, lucide)); `chunkSizeWarningLimit` stays default
- Create: `scripts/check-bundle.mjs` (fails when any chunk other than `vendor-firebase` exceeds 350 kB uncompressed) and script `"build:check": "npm run build && node scripts/check-bundle.mjs"`; CI `build` job runs it
- Test: `scripts/check-bundle.mjs` exercised by CI; unit tests unchanged

- [ ] **Step 1: Record current chunk sizes from `npm run build` in the report. Step 2: Implement. Step 3: `npm run build:check` passes; record new sizes.**
- [ ] **Step 4: Commit** `git commit -m "Memoize list derivations and split vendor chunks"`

---

### Task 16: Visual QA harness in CI

**Files:**
- Modify: `src/firebase.js` (when `import.meta.env.VITE_USE_EMULATORS === '1'`: `connectAuthEmulator`, `connectFirestoreEmulator`, `connectStorageEmulator`, `connectFunctionsEmulator`)
- Modify: `firebase.json` (add `auth` emulator port 9099, `functions` 5001)
- Create: `e2e/playwright.config.js` (Chromium at `/opt/pw-browsers/chromium` via `executablePath` when `PLAYWRIGHT_BROWSERS_PATH` is set; projects `phone` 390 by 844 and `desktop` 1280 by 800), `e2e/setup/seed.mjs` (runs `scripts/seed-demo.mjs`, creates an owner user with claims via admin against the Auth emulator), `e2e/screens.spec.js` (signs in, visits every tab id in `NAV_SECTIONS`, both portals via a builder and a client user, screenshots to `e2e/output/<project>/<tab>.png`, runs `@axe-core/playwright` on each and fails on serious or critical violations), `scripts/run-e2e.mjs` (emulators:exec wrapping `vite preview` and `playwright test`)
- Modify: `.github/workflows/ci.yml` (job `e2e` with Java 21, uploads `e2e/output` as an artifact)
- Modify: `package.json` (`@playwright/test`, `@axe-core/playwright` devDependencies; scripts `e2e`)

- [ ] **Step 1: Write `screens.spec.js` first and run it against the current app; expect axe failures or missing screens (RED).**
- [ ] **Step 2: Implement the harness and fix any serious or critical axe violation it finds in screens (Task 6 should have left none; fix stragglers here).**
- [ ] **Step 3: `npm run e2e` passes locally; attach the screenshot list to the report.**
- [ ] **Step 4: Commit** `git commit -m "Add Playwright and axe screen checks against the emulators"`

---

### Task 17: Design system documentation and audit status

**Files:**
- Create: `docs/design-system.md` (tokens table, type scale, primitives with props and do/don't, status vocabulary, copy rules, motion rules, accessibility floor)
- Modify: `README.md` (design system link, e2e instructions), `AUDIT.md` (Status column marks items 15 to 18 and 21 to 26 Done with commit refs; scorecard note), `src/components/Architecture.jsx` (reflects the real modules, functions and rules)

- [ ] **Step 1: Write the documents. Step 2: Full gate including e2e. Step 3: Commit** `git commit -m "Document the design system and record Phase 2 in the audit"`

---

### Task 18: Demo mode and public preview link (owner directive, 2026 10 18)

**Why.** The owner and their partner want to open the finished app on their phones from a plain link with no sign in. Real data must never be reachable without sign in, so the public link runs a demo build: same code, same screens, sample data held in memory, every role reachable from a switcher.

**Files:**
- Create: `src/demo/demoStore.js` (in memory collections seeded from `scripts/demo-data.mjs` through a dynamic import that exists only when `import.meta.env.VITE_DEMO === '1'`; mutations apply the same transitions the callables apply, persisted per device in `localStorage` under `p2-demo-state` with a Reset button), `src/demo/DemoProvider.jsx` (implements the `DataProvider` value shape from the store), `src/demo/DemoBanner.jsx` (copy: "Demo preview with sample data. Nothing here is saved to P2's systems." plus a role switcher Owner, Builder, Client and a Reset sample data button), `src/demo/demoSession.js` (resolves a fake owner, builder or client session without Firebase Auth)
- Modify: `src/App.jsx` (when `VITE_DEMO === '1'`, skip Firebase Auth, render `DemoProvider` and `DemoBanner`; everything else unchanged), `src/firebase.js` (no Firebase initialization in demo mode), `src/hooks/useFirestore.js` (mutation helpers route to the demo store in demo mode), `vite.config.js` (demo build outputs to `dist-demo` via `--mode demo`), `package.json` (`build:demo` script), `.github/workflows/ci.yml` (job `demo-build` proves the production bundle still contains no sample data and the demo bundle builds)
- Create: `docs/demo-preview.md` (how the link is built and deployed, what it contains, what it never contains)
- Test: `src/demo/__tests__/demoStore.test.js` (approve change order transition, reset restores seed), `src/__tests__/no-demo-in-prod.test.js` (production build output contains no "Enclave Dr" and no `demoStore` chunk)

**Deployment.** Build with `npm run build:demo` and publish `dist-demo` as a static site with an SPA rewrite to `index.html` on the hosting the owner prefers. Firebase Hosting preview channel when the owner provides a CI token (`firebase hosting:channel:deploy demo`); otherwise Vercel or Netlify through the connected tools, with deployment protection off so the link opens without any password. The link is shared with the owner in chat and recorded in `docs/demo-preview.md`. The demo is rebuilt and redeployed at the end of every later phase.

- [ ] **Step 1: Write failing tests (demo store transitions; production bundle free of sample data).**
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS, including `npm run build` and `npm run build:demo`.**
- [ ] **Step 5: Commit** `git commit -m "Add demo mode with sample data and a public preview build"`
- [ ] **Step 6: Deploy `dist-demo`, open the link on a phone sized viewport with Playwright, screenshot the owner, builder and client views, and hand the link to the owner.**
