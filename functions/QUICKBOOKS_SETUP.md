# QuickBooks Online — Connect Setup

Three things need to happen before the **Connect QuickBooks** button works in production:

1. Loosen one Org Policy (5 min, one-time) — required for any Firebase callable to be reachable from the browser.
2. Register an Intuit Developer App (15 min, one-time) — gives you Client ID + Client Secret.
3. Plug those credentials into Firebase Secrets and redeploy the IAM (2 min).

Everything else (the OAuth flow itself, token storage, refresh, disconnect) is already built and live.

---

## 1. Loosen the Org Policy that blocks `allUsers`

The `iam.allowedPolicyMemberDomains` org policy is currently denying Firebase from setting `allUsers` as the Cloud Run invoker. Without that, the browser cannot reach `qbAuth` / `qbCallback` / `qbDisconnect` — every call returns `403 Forbidden`.

**Fix (one click in the GCP Console):**

1. Open: https://console.cloud.google.com/iam-admin/orgpolicies/iam-allowedPolicyMemberDomains?project=p2-dashboard
2. Click **Manage Policy** (or **Edit**).
3. Under **Applies To**, choose **Override parent's policy**.
4. Under **Policy enforcement**, select **Replace**.
5. Under **Policy values**, choose **Allow All**.
6. Save.

This affects *only* the `p2-dashboard` project — everything else in your org keeps the same restriction.

After saving, run from the project root:

```bash
node functions/scripts/grant-public-invoker.js
```

(That script is included below — it grants `allUsers` invoker on the three QB functions.)

---

## 2. Register an Intuit Developer App

1. Go to https://developer.intuit.com → **Sign In** with the Intuit account that owns your QuickBooks Online company.
2. Top right → **Dashboard** → **Create an app** → **QuickBooks Online and Payments**.
3. Name: `P2 Field Control`. Scope: select **com.intuit.quickbooks.accounting**.
4. Open the app → **Keys & credentials** tab.
5. You'll see TWO key sets — **Development** (for sandbox) and **Production**. Use **Production** keys to connect your real company file.
6. Under the Production key set, set the **Redirect URI** to EXACTLY:

   ```
   https://p2-dashboard.web.app/
   ```

   (trailing slash matters)

7. Copy the **Client ID** and **Client Secret** somewhere safe.

---

## 3. Push the credentials into Firebase Secrets and redeploy

From the project root:

```bash
# Update Client ID — paste when prompted
npx firebase functions:secrets:set QB_CLIENT_ID

# Update Client Secret — paste when prompted
npx firebase functions:secrets:set QB_CLIENT_SECRET

# Redeploy so the functions pick up the new secret versions
npx firebase deploy --only functions:qbAuth,functions:qbCallback,functions:qbDisconnect
```

**Test it:** open https://p2-dashboard.web.app → Settings → **Connect QuickBooks**.
You should be redirected to Intuit, asked to pick the company file, and bounced back to the app with a green "QuickBooks connected successfully!" banner.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Click Connect → "Could not connect to QuickBooks. Try again." | Functions deployed but secrets still placeholder | Step 3 above |
| Click Connect → "QuickBooks integration is not deployed on the server yet." | Functions never deployed | `npx firebase deploy --only functions:qbAuth,functions:qbCallback,functions:qbDisconnect` |
| Redirect fails: `redirect_uri_mismatch` | Intuit redirect URI doesn't match exactly | Check trailing slash in step 2.6 |
| 403 Forbidden in the browser console when clicking Connect | Org policy still blocking allUsers | Step 1 above |
| "OAuth state expired" after redirect | Took longer than 10 min between Connect and Intuit redirect | Click Connect again |

## Files involved

- `functions/index.js` — Cloud Functions code (qbAuth, qbCallback, qbDisconnect)
- `src/components/SettingsPage.jsx` — Connect/Disconnect UI
- `src/App.jsx` — `qbCallback` wiring on `?code=…&state=…&realmId=…` URL
- Firestore: `qb_config/tokens` — connection state (read by SettingsPage)
- Firestore: `qb_config/oauth_states` — one-time CSRF tokens (auto-cleaned)
