# Security rollout — closing the operational-data hole

The Firestore rules currently allow any signed-in user to read & write
*every* operational collection from DevTools (jobs, extras, subs,
materials, supplier_invoices, history, …). This document is the staged
plan for closing that hole without locking the app out.

The code changes are already in this branch:

- `functions/index.js` → `backfillScoping` callable: backfills
  `tenantId` (default `'p2-core'`) and `clientUids: []` on every
  operational doc that lacks them. Idempotent. Staff-only.
- `functions/index.js` → `onNotificationCreated` rewritten to push only
  to resolved recipients (recipientUids / recipientRole / tenantId) — no
  longer blasts every device in the database. **This is live as soon as
  you deploy the function.** No data migration required.
- `firestore.rules` → `fcm_tokens` writes now require `uid` matches the
  caller. Push registration via `src/lib/push.js` already sets `uid`, so
  this is safe to deploy.

What's **not** yet in this branch (deliberately, because it requires the
backfill to run first):

- Per-doc tenant scoping on operational collection rules.
- Scoped queries in the client & builder portals.

## The staged rollout

### Step 0 — deploy the safe pieces first

```
firebase deploy --only firestore:rules,functions
```

This ships:

- `fcm_tokens` lockdown (C-3).
- New notification fan-out logic (C-2). Legacy notification writes that
  set neither `recipientUids` nor `recipientRole` now resolve to
  "staff only" — narrower than before, but covers the existing flows
  (CO approval pings, inspection results, billing alerts).
- The `backfillScoping` callable (not yet wired to any UI).

Verify everything still works: push notifications, CO approvals, etc.

### Step 1 — backfill scoping fields on existing data

Once Step 0 is happy, from the Firebase functions shell or a Settings-page
button (your call):

```js
firebase.functions().httpsCallable('backfillScoping')({ dryRun: true })
```

Returns a per-collection summary of how many docs need touching. When the
counts look right:

```js
firebase.functions().httpsCallable('backfillScoping')({})
```

Re-running is safe (idempotent). After this completes, every operational
doc has `tenantId` and `clientUids`.

### Step 2 — add scoped queries to portal hooks

In `src/hooks/useFirestore.js`, change the client- and builder-portal
queries to filter by tenant/clientUids at the Firestore layer:

```js
// before
const q = query(collection(db, 'jobs'), orderBy(...))

// after — client portal
const q = query(
  collection(db, 'jobs'),
  where('clientUids', 'array-contains', auth.currentUser.uid),
  orderBy(...),
)

// after — builder portal
const q = query(
  collection(db, 'jobs'),
  where('tenantId', '==', tenantId),
  orderBy(...),
)
```

Internal staff queries can stay unscoped (rules will still allow them).
Push, verify each portal sees only its expected data.

### Step 3 — tighten the rules

Replace each operational-collection rule with the scoped version. Sketch
(copy into firestore.rules):

```
function ownsTenant(data) {
  return isStaff()
      || data.tenantId == request.auth.token.tenantId
      || request.auth.uid in data.clientUids;
}

match /jobs/{doc=**} {
  allow read:  if signedIn() && ownsTenant(resource.data);
  allow create: if signedIn() && (isStaff() || ownsTenant(request.resource.data));
  allow update, delete: if signedIn() && ownsTenant(resource.data);
}
```

Apply the same pattern to extras, submits, history, etc.

Deploy:
```
firebase deploy --only firestore:rules
```

If anything looks wrong, **immediately revert**:
```
git revert <commit-sha> && firebase deploy --only firestore:rules
```

### Step 4 — clean up

Once Step 3 has been stable for a day or two:

- Remove the fallback in DataContext's portal queries that handled
  pre-backfill docs (no fallback was added in this branch; you'd add it
  if Step 2 needed defensive handling).
- Restrict `notifications` writes in `firestore.rules` so non-staff users
  can only create notifications they're the recipient of (or that target
  their own tenantId). This finishes C-2.

## Rollback playbook

Any deploy can be rolled back with `firebase deploy --only firestore:rules`
pointed at the previous rules. Keep a clean `main` baseline of the rules
file so you can revert in seconds.

The backfill is non-destructive — it only adds fields, never overwrites
or removes — so re-running or rolling back the data is safe.
