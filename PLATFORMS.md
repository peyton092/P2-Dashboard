# Desktop & Mobile — Build Guide

P2 Field Control is one React + Vite codebase that ships to three targets. The
web build (`dist/`) is the single source of truth — desktop (Tauri) and mobile
(Capacitor) both wrap that same build. There is no separate app codebase.

```
src/  ──vite build──▶  dist/  ──┬─▶  Firebase Hosting   (web)
                                ├─▶  Tauri              (macOS / Windows / Linux desktop)
                                └─▶  Capacitor          (iOS / Android)
```

## Web (unchanged)

```bash
npm run dev      # http://localhost:5173
npm run build    # dist/
firebase deploy --only hosting
```

## Desktop — Tauri 2

Wraps `dist/` in a native window (~10 MB app vs ~180 MB for Electron).

**Prerequisites (one-time, per machine):**
- Rust toolchain — https://www.rust-lang.org/tools/install
- Platform deps per https://tauri.app/start/prerequisites/
  (Linux: `webkit2gtk`/`libsoup`; macOS: Xcode CLT; Windows: WebView2 + MSVC).

**Generate app icons (one-time):** drop a square 1024×1024 PNG and run
`npx tauri icon path/to/logo.png` (writes `src-tauri/icons/*`).

**Run / build:**
```bash
npm run desktop:dev      # hot-reload dev window (runs `npm run dev` under the hood)
npm run desktop:build    # signed installers in src-tauri/target/release/bundle/
```

Config lives in `src-tauri/tauri.conf.json`. `frontendDist` points at `../dist`,
`beforeBuildCommand` runs `npm run build`, so `desktop:build` always bundles the
current web build.

## Mobile — Capacitor 7

Wraps `dist/` as store-submittable iOS / Android apps. 100% of the web code is
reused — no React Native rewrite.

**Prerequisites (one-time, per machine):**
- iOS: macOS + Xcode + CocoaPods
- Android: Android Studio + JDK 17

**Add the native projects (one-time, run locally — they're git-ignored):**
```bash
npm install
npm run build
npx cap add ios
npx cap add android
```

**Iterate:**
```bash
npm run mobile:ios       # build web, sync, open Xcode
npm run mobile:android   # build web, sync, open Android Studio
npm run mobile:sync      # build web + copy into both native projects
```

Config lives in `capacitor.config.json` (`appId: com.p2em.fieldcontrol`,
`webDir: dist`).

## Notes & gotchas

- **Auth works in app webviews.** The app uses Firebase email/password sign-in,
  which works inside Tauri/Capacitor webviews. (Avoid `signInWithRedirect`/popup
  OAuth in native shells — not currently used here.)
- **QuickBooks / CompanyCam OAuth** redirect to `https://p2-dashboard.web.app/`.
  In native shells those flows should open the system browser; today they're
  driven from the web app and Settings, so connect integrations from the web
  build for now.
- **What can't be done in CI/cloud:** producing signed `.dmg`/`.msi`/`.AppImage`,
  `.ipa`, or `.apk` needs the platform toolchains above on a real machine. The
  configs here are ready; the binaries are built locally.
- `src-tauri/target/`, `src-tauri/gen/`, `/ios/`, and `/android/` are git-ignored
  — they're regenerated from the committed config.
