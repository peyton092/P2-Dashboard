# P2 Field Control Dashboard

Operational dashboard for **P2 Electrical & Mechanical** (Middle Tennessee).

Live: https://p2-dashboard.web.app

Multi tenant web app for tracking jobs, inspections, change orders, billing, sub performance, daily reports, and PM workload across the P2 internal team, partner builder portals (QBS, Vision) and a client portal.

## Stack

- **Frontend**: React 19 + Vite, Tailwind v4, shadcn/ui, lucide-react, recharts, jspdf
- **Backend**: Firebase (Firestore, Auth, Storage, Hosting, Cloud Functions v2 on Node 22)
- **Hosting**: `p2-dashboard.web.app` (`firebase deploy --only hosting`)
- **Tests**: vitest for the browser code, `node --test` for the functions, the Firebase emulators for the security rules

## Layout

```
src/
  App.jsx                      # Shell, login, routing by role, sidebar/mobile nav, inline tabs
  DataContext.jsx              # Data provider: subscribes to each collection with the signed in user's scope, mounted only after sign in
  use-data.js                  # The useData hook and its context
  firebase.js                  # Firebase init (client config is public by design)
  agent/                       # PM Agent scoring, alerts, zone mapping
  components/
    CommandCenter.jsx          # Default landing: priority jobs, billing queue, crew status, zones, inspection pipeline
    WarRoom.jsx                # Field status live view
    PMDashboard.jsx            # Per PM workload and flags
    AlertsPage.jsx
    BillingQueue.jsx           # Invoice ready jobs and PDF generation
    ChangeOrders.jsx           # Change orders (internal side)
    QBSBuilderPortal.jsx       # Mobile first builder portal: approve or reject change orders, submit RFIs
    ClientPortal.jsx           # Client portal: projects, change orders, messages, uploads
    NoAccessScreen.jsx         # Shown to a signed in user with no valid role
    Architecture.jsx           # In app view of the collections, Cloud Functions and rules
    Analytics.jsx              # Recharts dashboards
    SettingsPage, InvoiceAuditor, CrewReport and the rest
  hooks/useFirestore.js        # Collection subscriptions (queryFor builds the scoped queries), writes, callable wrappers
  lib/                         # Helpers: session resolution, upload and URL checks, push registration, money, PDF generators
firestore.rules                # Firestore security rules (see SECURITY.md)
storage.rules                  # Cloud Storage security rules
firestore.indexes.json         # The eight composite indexes the scoped portal queries need
firebase.json                  # Hosting, rules, indexes, emulator ports (8080, 9199), functions source
tests/rules/                   # Rules tests, run in the emulators by npm run test:rules
scripts/                       # seed-demo.mjs (emulator only), demo-data.mjs, run-rules-tests.mjs
.github/workflows/ci.yml       # CI: lint, test, rules, build, functions
functions/
  index.js                     # Entry point: exports every function from the module that defines it, and does nothing else (its header lists them all)
  oauth-quickbooks.js          # QuickBooks OAuth (qbAuth, qbCallback, qbDisconnect callables)
  oauth-companycam.js          # CompanyCam OAuth (ccAuth, ccCallback, ccDisconnect callables)
  companycam-sync.js           # Photo sync (ccSyncPhotos callable, ccSyncPhotosScheduled every 6 hours)
  push.js                      # Push fan out (onNotificationCreated trigger)
  users.js                     # User accounts (createUser callable, onUserWritten claims sync trigger)
  extras.js                    # Change orders (sendExtraToBuilder, approveExtra, rejectExtra callables)
  inspections.js               # Inspection results (passInspection, failInspection callables)
  jobs.js                      # New jobs (createJob callable)
  scope-sync.js                # Scope stamping (onJobWritten, onExtraWritten, onSubmitWritten triggers, backfillScopes callable)
  lib/                         # Shared code, listed module by module in the header of index.js
  test/                        # Unit and handler tests (cd functions && npm test)
  test/helpers/firestore-stub.js  # Firestore stub shared by the handler tests
  QUICKBOOKS_SETUP.md          # Step by step QuickBooks connect setup
  COMPANYCAM_SETUP.md          # Step by step CompanyCam connect setup
  scripts/grant-public-invoker.js  # Grants the browser access to the callables (run after a functions deploy)
```

`functions/lib/` holds `admin.js`, `secrets.js`, `config.js`, `authz.js`, `actor.js`, `auth-claims.js`, `doc-id.js`, `batches.js`, `activity.js`, `push-targets.js` and the rule modules `roles.js`, `scope.js`, `scope-sync.js`, `users-validate.js`, `users-sync.js`, `extras.js`, `inspections.js` and `jobs.js`.

## Tenants

Roles are exactly `owner`, `internal`, `builder` and `client`; staff means owner or internal. Tenants are exactly:

- `p2-core`: P2 internal, and the tenant of owner, internal and client accounts
- `qbs`: QBS Builder Portal
- `vision`: Vision Building Group

A builder belongs to `qbs` or `vision`. Routing after sign in: owner and internal staff see MainDashboard with a workspace switcher; a builder accepts the Terms of Access and then sees the builder portal for their tenant; a client sees ClientPortal, limited to the jobs they are linked to; a signed in user with no valid role sees the No Access screen. Accounts are created by an owner from Manage users in the sidebar, which calls the `createUser` callable and writes the person's `users/{uid}` document; the role and tenant claims follow from that document. How roles are assigned and enforced is in [`SECURITY.md`](./SECURITY.md).

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run build` produces `dist/`; `firebase deploy --only hosting` ships it. `npm run dev` talks to the live project, not to the emulators.

Nothing is seeded on first run, so an empty project shows empty states. `npm run seed:demo` writes invented demo jobs, change orders, notifications, subs and materials into the Firestore emulator only. The emulators serve the rules tests (`npm run test:rules` starts its own and seeds its own fixtures) and the seeded emulator is there for the Phase 2 screenshot harness, while `npm run dev` talks to the live project until a `firebase.js` emulator switch lands in Phase 2. The seed refuses to run unless `FIRESTORE_EMULATOR_HOST` is set:

```bash
npx firebase emulators:start --only firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed:demo    # in a second terminal
```

## Testing and CI

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint |
| `npm test` | vitest (jsdom) over `src/**/*.test.{js,jsx}` |
| `npm run test:rules` | The Firestore and Storage rules tests in `tests/rules/`, inside the emulators (needs Java 17 or later, and ports 8080 and 9199 free) |
| `npm run build` | The production build into `dist/` |
| `cd functions && npm test` | The Cloud Functions tests, `node --test` over `functions/test/` |

`.github/workflows/ci.yml` runs five jobs on every pull request and every push to `main`: `lint`, `test`, `rules` (with Java 21), `build` and `functions`. Each runs the command above on Node 22. Desktop and mobile builds (`desktop:*`, `mobile:*`) are covered in [`PLATFORMS.md`](./PLATFORMS.md).

## Firebase Cloud Functions

The functions in `functions/` cover QuickBooks and CompanyCam OAuth and photo sync, push notifications, user accounts and claims, change orders, inspections, job creation and scope stamping. The Connect QuickBooks and Connect CompanyCam buttons in Settings call the OAuth callables, which share one pattern (Cloud Function, provider authorize URL, redirect back, token exchange, tokens in Firestore). Setup steps and required provider config are in [`functions/QUICKBOOKS_SETUP.md`](./functions/QUICKBOOKS_SETUP.md) and [`functions/COMPANYCAM_SETUP.md`](./functions/COMPANYCAM_SETUP.md).

```bash
cd functions
npm install
firebase deploy --only functions
```

Indexes, rules, functions and hosting have to go out in a set order, and the callables need an invoker grant afterwards. Follow the Deploying section of [`SECURITY.md`](./SECURITY.md).

The business time zone is America/Chicago, used wherever the server writes a day (the day an inspection was recorded, for one), and changed in one constant, `BUSINESS_TIME_ZONE` in `functions/lib/business-time.js`.

Both providers redirect back to the same URL with `?code=…&state=…`; only Intuit appends `&realmId=…`, which is how `src/App.jsx` routes the callback to the right function.

## Conventions

- Dark theme. Brand orange `#F47920`. Background `oklch(0.165 0 0)`.
- Job IDs look like `QBS-001`: capital letters, a hyphen and three digits, which the `createJob` callable enforces.
- Status vocab: `on-track | needs-action | at-risk | blocked | active | hold | pending | complete`.
- Inspection vocab: `passed | failed | scheduled | pending | blocked | n/a`.
- Billing vocab: `not-invoiced | invoiced | partial-pay | paid`.

## Writing conventions

Plain punctuation, no dashes in copy: use commas, periods, colons or the word "to". This README, `SECURITY.md`, `AUDIT.md` and the Architecture screen follow it. Other documents (`PLATFORMS.md` and the setup guides in `functions/`), older portal strings and code comments still carry dashes, and the Phase 2 copy pass cleans them.

## Further reading

- [`SECURITY.md`](./SECURITY.md): the security model, the deploy order and the known residuals
- [`AUDIT.md`](./AUDIT.md): the engineering audit, with the status of each backlog item
- [`PUSH_SETUP.md`](./PUSH_SETUP.md): push notification setup
- [`PLATFORMS.md`](./PLATFORMS.md): desktop and mobile builds
