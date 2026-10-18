# Security model

How access to P2 Field Control is decided and enforced. Roles are exactly `owner`, `internal`, `builder` and `client`; staff means owner or internal. Tenants are exactly `p2-core`, `qbs` and `vision`. The rules are in `firestore.rules` and `storage.rules`, the privileged actions in `functions/`, and the tests that prove both in `tests/rules/` and `functions/test/`.

## Roles and claims

- A role is assigned by editing the person's `users/{uid}` document, never by the person. An owner writes any record and is the only one who deletes one. Internal staff write only builder and client records, and only over a record that is one too, so they cannot mint or change an owner or another staff account; a builder record needs tenant `qbs` or `vision`. Builders and clients write no `users` document, their own included, apart from their own `termsAcceptances`.
- The `onUserWritten` trigger copies the document into the person's Auth custom claims, `{ role, tenantId, clientJobIds }`. A builder keeps tenant `qbs` or `vision` (any other value leaves them with none), every other role gets `p2-core`, and only a client carries `clientJobIds`. It revokes the person's refresh tokens when an existing role changes or is removed, so old claims last no longer than the current ID token. A new document never lowers an account that is already owner or internal.
- Owners create accounts with the `createUser` callable. It makes the Auth account with a random password, sets the claims, writes the document and returns the uid; the browser then emails the person a link to choose their own password. There is no public sign up.
- A token without claims falls back to the `users` document. `userRole()`, `userTenant()` and `userClientJobIds()` in `firestore.rules`, the same fallback in `storage.rules`, `requireAuth` in `functions/lib/authz.js` and `resolveSession` in `src/lib/session.js` all read the token first and the document second. A user with no valid role, or a builder with no tenant `qbs` or `vision`, gets the No Access screen and is shown no operational data.

## Scope fields and who stamps them

A job's scope is `{ tenantId, clientUids }`. Jobs, change orders (`extras`), submissions (`submits`) and notifications each carry both, and the rules read them to decide who may see the document.

- `createJob` sets the job's `tenantId` and an empty `clientUids`, and the callables write each notification with the scope of its job.
- `onUserWritten` links a client's uid into `clientUids` of every job in their `clientJobIds`, and out of any job that no longer should list them.
- `onJobWritten` gives the scope to every change order, submission and notification that names a job when the job's tenant or clients change. `onExtraWritten` and `onSubmitWritten` stamp a document from its job when it lacks the scope. A submission created by a builder keeps its own tenant when its job is in another one. A job with no tenant is given `qbs` on itself, because every job from before tenants were recorded belongs to QBS.
- `backfillScopes` does all of this for what already exists (see Deploying). The rules apply no default: a document that was never stamped is staff only.

## Who reads what

Read isolation is enforced by the database, not by the portals' JavaScript. Earlier versions of this file listed it as a known limitation; it is closed.

- Staff read every collection the rules define.
- A builder whose tenant is `qbs` or `vision` reads scoped documents whose `tenantId` is theirs. A builder with no tenant, or with `p2-core`, reads nothing scoped.
- A client reads scoped documents whose `clientUids` list their uid.
- `jobs/{id}/files` is read with its job, and `submits/{id}/replies` with its submission.
- Everything else is staff only: `qb_config`, `cc_config`, `config`, `agent_alerts`, `crew_scores`, `app_settings`, `materials`, `subs`, `permits`, `daily_reports`, `urgent_items`, `history` and `supplier_invoices`. A user also reads their own `users` document, staff read `fcm_tokens` and `error_logs`, and any path no rule matches is denied.
- The portals ask for exactly this. `queryFor` in `src/hooks/useFirestore.js` filters a builder by `tenantId` and a client by `clientUids`, so Firestore can prove each query stays in scope, and a scope that may read nothing subscribes to nothing. `firestore.indexes.json` holds the eight composite indexes those queries need.

## What builders and clients may write

Staff write everything scoped. The portals write only this:

- Notifications: anyone who may read one may change its `read` flag and nothing else.
- Submissions: each is created as the person signed in (`createdBy` is their uid). A client names one of their jobs, lists only themselves in `clientUids` and names no tenant. A builder carries their own tenant and lists no clients. Anyone who may read one may move its status to Open, In Progress or Resolved and change nothing else.
- Replies: anyone who may read the submission may reply, as themselves and under their own role. Staff reply as internal or owner, so nobody else can post as P2.
- Client uploads: a client listed on a job may record a file under `jobs/{id}/files` (a name, an https link, `source` of `client-upload`, their own uid) and upload it to Storage.
- Their own push token in `fcm_tokens`, their own `termsAcceptances`, and error reports in `error_logs` as themselves.

## Callables and their guards

Every callable runs its guard before it reads anything, taking the caller's role from the token claims and then from the `users` document. The change order, inspection and job callables also take the actor from the signed in token, never from the request, validate what they are sent, and write the change, its notification and its history line in one transaction.

- Owner only: `createUser`, `backfillScopes`.
- Staff only: `sendExtraToBuilder`, `createJob`, `passInspection`, `failInspection`.
- `approveExtra` and `rejectExtra`: staff, the builder whose tenant owns the change order, and the clients linked to its job. A change order that is already decided is refused.
- Any signed in caller: `qbAuth`, `qbCallback`, `qbDisconnect`, `ccAuth`, `ccCallback`, `ccDisconnect` and `ccSyncPhotos` (see Known residuals).
- The triggers take no caller. `onNotificationCreated` sends a push only to the devices of people the notification is in scope for, and a notification with no scope fields reaches staff only.

## Storage

- `jobs/{jobDocId}/client-uploads/`: any signed in user may read. Staff, and a user the job's `clientUids` list, may write, and every file there must be a JPEG, PNG, HEIC, WebP or PDF under 25 MB.
- Every other path is staff only, with the same 25 MB cap on writes. Nobody may read or write directly under `jobs/`.
- The rules read Firestore (the job's `clientUids`, and the `users` document for a token without claims), so the Cloud Storage service agent needs Firestore read access. The first Storage rules deploy offers to grant it; accept.

## Deploying

Order matters: the browser has no Firestore fallbacks any more, so the indexes, rules and functions it depends on must be live before the new hosting build.

1. Indexes first: `firebase deploy --only firestore:indexes`. Wait until all eight finish building. Until then builder and client list queries fail with FAILED_PRECONDITION and the portals show their empty state.
2. Rules and functions together: `firebase deploy --only firestore:rules,storage:rules,functions`.
3. Open the callables to the browser: `node functions/scripts/grant-public-invoker.js`. It grants `allUsers` the Cloud Run invoker role on each callable's service (each callable still checks its caller), needs the `iam.allowedPolicyMemberDomains` organization policy loosened and a Firebase CLI login, and its list must gain every new callable.
4. Hosting last: `firebase deploy --only hosting`.
5. Sign in as an owner, open Settings and press "Backfill access scopes" once. It sets the claims of every user with a role, every job's tenant (`qbs` when it has none) and `clientUids` (exactly the clients whose `users` document lists the job), then stamps change orders, submissions and notifications. It is safe to run again. Until it has run, documents without scope fields are staff only and the portals show "No projects are linked to your account yet."
6. Make sure every staff account has a `users` document with its role. The No Access screen, the claims sync and push targeting all depend on it, and an account with claims but no document receives no push.
7. In the Firebase console, turn off self sign up. Under Authentication, review the user list, delete accounts you do not recognise, and review `users` documents that have no role.
8. In a later phase, consider disabling email enumeration protection exceptions and enabling App Check.

## Known residuals

- `fcm_tokens` are never removed on sign out, so a device keeps the scope of the last person who registered it.
- Client uploads are readable by any signed in user who knows the path.
- A builder offboarded by deleting their `users` document can have an earlier misfiled submission follow its job.
- The QuickBooks, CompanyCam and photo sync callables only check that the caller is signed in, so any builder or client account can disconnect an integration or start a sync (the audit's finding on `requireAuth`, still open).

## Running the rules tests

`npm run test:rules` starts the Firestore and Storage emulators (ports 8080 and 9199, set in `firebase.json`) and runs `tests/rules/*.test.mjs` one file at a time against `firestore.rules` and `storage.rules`. It needs Java 17 or later (CI uses 21), and both ports must be free. Run it before every rules deploy. The functions tests run with `cd functions && npm test`.
