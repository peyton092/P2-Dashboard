# Demo preview

The demo preview is the P2 Field Control app at a public link that opens on a phone or a computer with no sign in. It runs the same code and the same screens as the real app, on sample data that lives in the browser. Real data cannot be reached from it: the demo build holds no Firebase configuration and talks to no Firebase or Google service.

Link: (added by the controller after deployment)

## What it contains

1. The whole app, built from this repository: every screen of the owner and office dashboard, the builder portal and the client portal.
2. Sample data, made when the demo first opens on a device and dated from that day, so the newest job update is yesterday. It starts from the jobs, change orders, subs and materials of the emulator seed (`scripts/demo-data.mjs`), with every date moved by the same number of days, and adds what the screens need besides: four demo accounts, settings, submissions with replies, daily reports, alerts, crew scores, history, supplier invoices, permits, change orders in every status with line items, jobs in the QBS, Vision and P2 workspaces, and jobs that are blocked, at risk, on hold or part paid.
3. The changes a person makes, kept in that browser only (in localStorage, under `p2-demo-state`), so a reload keeps them. Nobody else sees them, and another phone starts from the sample data.

Every person, client, company and street address in the sample data is invented. The names that stay are the project managers and crew the app itself lists, and the suppliers the Invoice Auditor lists.

## What it never contains

1. No Firebase configuration, key or project identifier, and no request to Firebase, Google or any other outside service. The only requests the demo makes are for its own files on the host.
2. No real customer, job or account data. Nothing typed into the demo leaves the browser it was typed in.
3. No service worker, so the demo never caches itself over the real app and never asks to send notifications.
4. No place in search engines: every page and response asks not to be indexed.

## Roles

A bar at the top says that this is a demo with sample data, and switches who the demo is viewed as:

1. **Owner**: the full dashboard, with every screen in the sidebar (on a phone, the bottom bar and More).
2. **Builder**: the QBS builder portal, which shows exactly the QBS jobs. The first visit shows the terms of access, as the real portal does.
3. **Client**: the client portal of a home builder with three lots, which shows exactly those jobs.

The demo opens as the owner on a device that has chosen nothing, and as the last role chosen after that. Signing out from inside the app brings the owner back, because the demo has no signed out state.

What a person does goes through the same rules as the real app. A builder or a client approving a change order, staff passing an inspection or creating a job are checked and recorded as the Cloud Functions do it, with the same notification, the same history line and the same refusals, and every role sees the result in its own screens.

## Reset

**Reset sample data** in the bar asks first, then puts the sample data back as it was when the demo opened that day and forgets what the browser saved. The role stays as it is.

## What does not work in the demo

1. QuickBooks, CompanyCam, push notifications and the access scope backfill are turned off. A screen that shows the function's own words says "This is a demo. Connections to other systems are turned off."
2. Uploaded photos and documents stay in the browser for as long as the page is open (small images also with the record that names them). The app only links to secure web addresses, so an uploaded file shows as preview or link unavailable.
3. Creating a user account records the account, but no email is sent and nobody can sign in with it. The demo signs in only as its own accounts.
4. The background jobs of the real system do not run. A message a client sends reaches P2 but is not passed on to the builder portal, as the real system would do a moment later.

## How the build works

`npm run build:demo` runs `vite build --mode demo` and writes the site to `dist-demo`. In that mode `vite.config.js`:

1. points the six Firebase packages the app imports (`firebase/app`, `auth`, `firestore`, `functions`, `storage` and `messaging`) at small stand ins under `src/demo/shims`, which keep every collection in memory and answer the Cloud Functions the app calls (`src/demo/callables.js`) with the same transitions and refusals;
2. sends every import of `src/firebase.js` to `src/demo/firebase.js`, which builds the same exports from those stand ins with no configuration;
3. defines `import.meta.env.VITE_DEMO` as `'1'`, so `src/main.jsx` starts the demo from `src/demo/start.jsx`, which shows the demo bar above the app and registers no service worker;
4. leaves out `sw.js` and `firebase-messaging-sw.js`, and adds `_redirects` (every path opens the app), `_headers` (no indexing, no referrer, long caching of the hashed assets), `robots.txt` and a `noindex` tag in `index.html`;
5. fails the build if any file it writes holds a Firebase or Google host, a key or the project identifier.

The production build (`npm run build`) is not touched by any of this: the demo is reached only through a dynamic import that the production build drops, and its output is byte for byte what it was before the demo existed.

## How it is checked

1. The tests under `src/demo/__tests__` cover the stand ins, the Cloud Function rules, the sample data (every role sees something through the very queries the app builds, and the text holds no dashes, no Firebase strings and none of the emulator names), the role switching and the demo bar.
2. `src/__tests__/no-demo-in-prod.test.js` holds the one way into the demo code from the app.
3. The CI job `demo-build` builds both and fails if the production build holds sample data or demo code, or if the demo build holds a Firebase or Google host, a key, a project identifier or a service worker, or lacks `_redirects`.

## How to publish it

Build it, then publish the `dist-demo` folder as it is to a static host:

```
npm ci
npm run build:demo
```

To look at it on this machine first, `npx vite preview --mode demo` serves `dist-demo` with the same fallback to `index.html`.

The controller publishes `dist-demo` to Netlify as a prebuilt static site, with deployment protection off so the link opens without a password. Netlify reads `_redirects` and `_headers` from the folder. Another host needs the same two things: every path that is not a file answered with `index.html`, and the headers from `_headers`. The link goes at the top of this page. The demo is built and published again at the end of every later phase, so it shows the current app. When a change alters the sample data, change `DEMO_SEED_VERSION` in `src/demo/seed.js` too, so phones that kept the old data start again from the new.
