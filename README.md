# P2 Field Control — Dashboard

Operational dashboard for **P2 Electrical & Mechanical** (Middle Tennessee).

Live: https://p2-dashboard.web.app

Multi-tenant web app for tracking jobs, inspections, change orders, billing, sub performance, daily reports, and PM workload across the P2 internal team and partner builder portals (QBS, Vision).

## Stack

- **Frontend** — React 19 + Vite, Tailwind v4, shadcn/ui, lucide-react, recharts, jspdf
- **Backend** — Firebase (Firestore, Auth, Storage, Hosting, Cloud Functions v2)
- **Hosting** — `p2-dashboard.web.app` (`firebase deploy --only hosting`)

## Layout

```
src/
  App.jsx                      # Shell, login, routing, sidebar/mobile nav, inline tabs
  DataContext.jsx              # Firestore wiring + first-run seed (44 QBS jobs)
  firebase.js                  # Firebase init (client config — public by design)
  agent/                       # PM-Agent scoring, alerts, zone mapping
  components/
    CommandCenter.jsx          # Default landing — priority jobs, billing queue, crew status, zones, inspection pipeline
    WarRoom.jsx                # Field-status live view
    PMDashboard.jsx            # Per-PM workload + flags
    AlertsPage.jsx
    BillingQueue.jsx           # Invoice-ready jobs + PDF generation
    ChangeOrders.jsx           # COs / Extras (internal side)
    QBSBuilderPortal.jsx       # Mobile-first builder portal — approve/reject COs, submit RFIs
    Analytics.jsx              # Recharts dashboards
    Settings/Auditor/Crew/etc.
  hooks/useFirestore.js        # All collection subscriptions + mutations
  lib/                         # Invoice/CO PDF generators
functions/
  index.js                     # Cloud Functions — QB OAuth (qbAuth/qbCallback/qbDisconnect) + CompanyCam OAuth (ccAuth/ccCallback/ccDisconnect) + photo sync (ccSyncPhotos/ccSyncPhotosScheduled)
  QUICKBOOKS_SETUP.md          # Step-by-step QB connect setup
  COMPANYCAM_SETUP.md          # Step-by-step CompanyCam connect setup
  scripts/grant-public-invoker.js  # IAM helper for Firebase callables
```

## Tenants

- `p2-core` — P2 internal (full access)
- `qbs` — QBS Builder Portal (filtered by builder PM)
- `vision` — Vision Building Group

Routing: signed-in `role === 'builder'` → QBSBuilderPortal; `role === 'internal'` → MainDashboard with tenant switcher. URL `?portal=qbs` forces builder demo view.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run build` produces `dist/` — `firebase deploy --only hosting` ships it.

## Firebase Cloud Functions (QuickBooks + CompanyCam OAuth)

The Connect QuickBooks / Connect CompanyCam buttons in Settings call Cloud Functions. Both use the same OAuth pattern (Cloud Function → provider authorize URL → redirect back → token exchange → tokens in Firestore). Setup steps and required provider config are in [`functions/QUICKBOOKS_SETUP.md`](./functions/QUICKBOOKS_SETUP.md) and [`functions/COMPANYCAM_SETUP.md`](./functions/COMPANYCAM_SETUP.md).

```bash
cd functions
npm install
firebase deploy --only functions:qbAuth,functions:qbCallback,functions:qbDisconnect
firebase deploy --only functions:ccAuth,functions:ccCallback,functions:ccDisconnect
```

Both providers redirect back to the same URL with `?code=…&state=…`; only Intuit appends `&realmId=…`, which is how `src/App.jsx` routes the callback to the right function.

## Conventions

- Dark theme. Brand orange `#F47920`. Background `oklch(0.165 0 0)`.
- Job IDs are `QBS-001` … `QBS-044` (real permits in seed data).
- Status vocab: `on-track | needs-action | at-risk | blocked | active | hold | pending | complete`.
- Inspection vocab: `passed | failed | scheduled | pending | blocked | n/a`.
- Billing vocab: `not-invoiced | invoiced | partial-pay | paid`.
