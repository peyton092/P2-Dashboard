# Security — Firestore & Storage Rules

## What the rules enforce today

`firestore.rules` + `storage.rules` (wired in `firebase.json`):

- **Auth required for everything.** No unauthenticated read/write to any path.
- **OAuth tokens locked down.** `qb_config/**` and `cc_config/**` (QuickBooks +
  CompanyCam access/refresh tokens) are readable/writable only by staff
  (`owner`/`internal`). Previously any signed-in user could have read them.
- **Settings + agent config:** anyone signed in can read; only staff can write.
- **User records (`users/{uid}`):** a user can read their own; only staff can
  write. This prevents a user from escalating their own `role` or widening their
  `clientJobIds`. (Builders may write their own `termsAcceptances`.)
- **Push tokens (`fcm_tokens`):** a user registers their own; staff read all.
- **Operational data** (jobs, extras, notifications, subs, materials, permits,
  submits, daily_reports, urgent_items, history, supplier_invoices): signed-in
  read/write.
- **Storage:** auth required; uploads capped at 25 MB.

Role resolution uses a custom claim (`request.auth.token.role`) when present,
otherwise the `users/{uid}` doc.

## Known limitation — read isolation

The builder and client portals scope **what each user sees in JavaScript**
(`DataContext`: `tenantId`, `clientJobIds`), not at the database layer, because
the portals issue **unscoped** collection queries (e.g. `useJobs()` reads all
jobs, then filters). Firestore rejects a query if it isn't guaranteed to return
only docs the user may read — so locking job reads per-document would break
those portals.

**Result:** a signed-in builder or client could, in theory, read operational
data outside their scope via the API (not through the UI).

### To fully close it (follow-up)

1. Add a server-trusted owner key to each job — e.g. `tenantId` (already exists)
   and a `clientUids` array — set by staff/Cloud Functions.
2. Scope the portal queries: builders `where('tenantId','==', tid)`, clients
   `where('clientUids','array-contains', uid)`.
3. Tighten the rules so `jobs`/`extras`/etc. reads require the doc's
   `tenantId`/`clientUids` to match the requester, and allow the matching query.

This is a query refactor in `useFirestore.js` + `DataContext.jsx` + the portals,
best done as its own change so it can be tested in the emulator.

## Deploy & test

```bash
# Test locally first (never deploy untested rules):
firebase emulators:start --only firestore,storage

# Deploy:
firebase deploy --only firestore:rules,storage:rules
```

Rules have not been exercised in an emulator in CI — validate before deploying,
especially the `users` write path used by the Create User flow and the builder
Terms acceptance write.
