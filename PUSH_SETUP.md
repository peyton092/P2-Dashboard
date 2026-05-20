# Push Notifications — Setup

The plumbing is built. To turn it on you supply keys/credentials from the
Firebase console (and, for mobile, the platform projects). Nothing here needs
code changes.

## How it works

- Devices register via **Settings → Push Notifications → Enable on this device**
  (`src/lib/push.js`). Tokens are stored in Firestore `fcm_tokens/{token}`.
- The `onNotificationCreated` Cloud Function fires whenever a doc is added to
  the `notifications` collection (which already happens on CO approvals,
  inspection results, billing, etc.) and sends an FCM push to every registered
  token, pruning dead ones.

## Web push (1 key)

1. Firebase console → **Project settings → Cloud Messaging → Web configuration**
   → **Web Push certificates** → generate / copy the key pair (VAPID public key).
2. Put it in `.env.local`:
   ```
   VITE_FCM_VAPID_KEY=BPxxxxxxxx...
   ```
3. Rebuild + deploy hosting. `public/firebase-messaging-sw.js` is already in
   place and serves at the site root (required by FCM).

## Mobile push (Capacitor)

**Android (FCM):**
1. Firebase console → add an **Android app** with id `com.p2em.fieldcontrol`.
2. Download `google-services.json` into `android/app/` (after `npx cap add android`).
3. `npm run mobile:android` and run on a device.

**iOS (APNs):**
1. Apple Developer → create an APNs **Auth Key** (.p8).
2. Firebase console → **Cloud Messaging → Apple app configuration** → upload the
   key (Key ID + Team ID).
3. Firebase console → add an **iOS app** with bundle id `com.p2em.fieldcontrol`;
   download `GoogleService-Info.plist` into `ios/App/App/` (after `npx cap add ios`).
4. Enable **Push Notifications** + **Background Modes → Remote notifications**
   capabilities in Xcode. `npm run mobile:ios`, run on a real device (push does
   not work in the simulator).

## Deploy the Cloud Function

```bash
npx firebase deploy --only functions:onNotificationCreated
```

## Notes

- `fcm_tokens` accumulates one doc per device; invalid tokens are auto-pruned
  when a send fails as unregistered.
- Today the function broadcasts every notification to all devices. To target
  only the relevant user (e.g. a client gets only their project's events), add a
  `uid`/`tenant` field to notification docs and filter `fcm_tokens` on it — the
  token docs already store `uid`, `email`, and `platform`.
