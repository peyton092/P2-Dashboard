# CompanyCam — Connect Setup

The **Connect CompanyCam** button in Settings uses the same OAuth pattern as
QuickBooks. Three things need to happen before it works in production:

1. Loosen one Org Policy (one-time) — required for any Firebase callable to be
   reachable from the browser. *If you already did this for QuickBooks, it's
   done — skip to step 2.*
2. Register a CompanyCam OAuth app — gives you a Client ID + Client Secret.
3. Plug those credentials into Firebase Secrets and redeploy the IAM.

Everything else (the OAuth flow, token storage, disconnect) is already built.

---

## 1. Loosen the Org Policy that blocks `allUsers`

Same fix as QuickBooks — see [`QUICKBOOKS_SETUP.md`](./QUICKBOOKS_SETUP.md)
step 1. The `grant-public-invoker.js` script now also grants the three
CompanyCam functions (`ccauth`, `cccallback`, `ccdisconnect`).

```bash
node functions/scripts/grant-public-invoker.js
```

---

## 2. Register a CompanyCam OAuth app

1. Go to https://app.companycam.com → sign in with an account on a plan that
   includes API/integration access.
2. Open **Account → Integrations → Developer / API** (or visit
   https://app.companycam.com/oauth/applications) → **New Application**.
3. Name: `P2 Field Control`.
4. Set the **Redirect URI** to EXACTLY:

   ```
   https://p2-dashboard.web.app/
   ```

   (trailing slash matters — it must match `CC_REDIRECT_URI`)

5. Scopes: `read` is enough to pull jobsite photos. (Override with the
   `CC_SCOPES` env var if you need `write`/`destroy`.)
6. Copy the **Client ID** (UID) and **Client Secret** somewhere safe.

---

## 3. Push the credentials into Firebase Secrets and redeploy

From the project root:

```bash
# Client ID — paste when prompted
npx firebase functions:secrets:set CC_CLIENT_ID

# Client Secret — paste when prompted
npx firebase functions:secrets:set CC_CLIENT_SECRET

# Redeploy so the functions pick up the new secret versions
npx firebase deploy --only functions:ccAuth,functions:ccCallback,functions:ccDisconnect,functions:ccSyncPhotos,functions:ccSyncPhotosScheduled
```

## Photo sync

Once connected, **Settings → CompanyCam → Sync photos now** runs `ccSyncPhotos`,
and `ccSyncPhotosScheduled` runs automatically every 6 hours. The sync pulls
CompanyCam projects, matches them to P2 jobs **by street address**, and writes
each photo into `jobs/{jobDocId}/files` (source `companycam`). Those files
surface in the Client Portal "Photos" tab and project documents — no extra
wiring. A summary of the last run (projects scanned, projects matched, photos
written) is stored at `cc_config/sync` and shown in Settings.

If photos aren't matching, confirm the P2 job `address` and the CompanyCam
project street address refer to the same place — matching is tolerant of
suffix abbreviations (Drive/Dr) but not of different addresses.

**Test it:** open https://p2-dashboard.web.app → Settings → **Connect
CompanyCam**. You should be redirected to CompanyCam, asked to authorize, and
bounced back with a green "CompanyCam connected successfully!" banner.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Click Connect → "Could not connect to CompanyCam. Try again." | Functions deployed but secrets still placeholder | Step 3 above |
| Click Connect → "CompanyCam integration is not deployed on the server yet." | Functions never deployed | Deploy `ccAuth`, `ccCallback`, `ccDisconnect` |
| Redirect fails: `redirect_uri_mismatch` | CompanyCam redirect URI doesn't match exactly | Check trailing slash in step 2.4 |
| 403 Forbidden in the browser console when clicking Connect | Org policy still blocking allUsers | Step 1 above |
| "OAuth state expired" after redirect | Took longer than 10 min between Connect and authorize | Click Connect again |

## How the callback is routed

Both QuickBooks and CompanyCam redirect back to `https://p2-dashboard.web.app/`
with `?code=…&state=…`. Intuit additionally appends `&realmId=…`; CompanyCam
does not. `src/App.jsx` uses the **presence of `realmId`** to decide whether to
call `qbCallback` or `ccCallback`.

## Files involved

- `functions/index.js` — Cloud Functions code (ccAuth, ccCallback, ccDisconnect)
- `src/components/SettingsPage.jsx` — Connect/Disconnect UI
- `src/App.jsx` — callback routing on `?code=…&state=…` (no `realmId`)
- Firestore: `cc_config/tokens` — connection state (read by SettingsPage)
- Firestore: `cc_config/oauth_states` — one-time CSRF tokens (auto-cleaned)
