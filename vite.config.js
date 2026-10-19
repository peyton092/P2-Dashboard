import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join, normalize } from 'node:path'

const buildDate = new Date().toISOString().slice(0, 10)
const appVersion = 'V5.2'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const publicDir = fileURLToPath(new URL('./public', import.meta.url))

// ── The demo build ────────────────────────────────────────────────────────────
//
// vite build --mode demo (npm run build:demo) builds the same app into dist-demo, with
// every Firebase package the app imports swapped for an in memory shim under src/demo,
// and src/firebase.js, which holds the Firebase configuration, swapped for
// src/demo/firebase.js, which holds none. Nothing in the demo can reach a Firebase or
// Google service. docs/demo-preview.md says how it is published. Every other mode is
// the production build, and nothing here applies to it.

const FIREBASE_SHIMS = ['app', 'auth', 'firestore', 'functions', 'storage', 'messaging']
  .map((name) => ({ find: new RegExp(`^firebase/${name}$`), replacement: join(srcDir, 'demo', 'shims', `${name}.js`) }))

// The service workers stay out of the demo: sw.js caches the app for offline use, and
// firebase-messaging-sw.js holds the Firebase configuration.
const LEFT_OUT = ['sw.js', 'firebase-messaging-sw.js']

const DEMO_FILES = {
  // Every path is the app, as on any host of a single page app.
  '_redirects': '/*  /index.html  200\n',
  '_headers': [
    '/*',
    '  X-Robots-Tag: noindex, nofollow',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
  'robots.txt': 'User-agent: *\nDisallow: /\n',
}

// The one place a screen names the Firebase project, the System card of Settings,
// reads differently in the demo, so that no project identifier is in the demo at all.
// If the screen changes, the demo build stops here rather than ship the identifier.
const DEMO_WORDING = [
  { file: join(srcDir, 'components', 'SettingsPage.jsx'), from: "value: 'p2-dashboard'", to: "value: 'None in the demo'" },
]

// What the demo build must never hold: the hosts of Firebase and Google, a Firebase
// key, and the project's own identifiers. The build fails when a file it writes has one.
const NEVER_IN_DEMO = /firebaseio|firebaseapp|googleapis|cloudfunctions\.net|AIzaSy|identitytoolkit|securetoken|666712594799|p2-dashboard/

function demoBuild() {
  const realFirebase = normalize(join(srcDir, 'firebase.js'))
  const demoFirebase = join(srcDir, 'demo', 'firebase.js')
  return {
    name: 'p2-demo-build',
    enforce: 'pre',
    // Any import that resolves to src/firebase.js, by whatever path, gets the demo's.
    async resolveId(source, importer, options) {
      if (!importer || !/firebase(?:\.js)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && normalize(resolved.id) === realFirebase ? demoFirebase : null
    },
    transform(code, id) {
      const wording = DEMO_WORDING.find(({ file }) => normalize(id.split('?')[0]) === normalize(file))
      if (!wording) return null
      if (!code.includes(wording.from)) this.error(`${wording.file} no longer has ${wording.from}. Update DEMO_WORDING in vite.config.js.`)
      return { code: code.replace(wording.from, wording.to), map: null }
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' }]
    },
    // The public files, less the service workers, and the files a static host reads.
    // Then every file of the build is checked for what the demo must never hold.
    generateBundle(_options, bundle) {
      for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
        if (!entry.isFile() || LEFT_OUT.includes(entry.name)) continue
        this.emitFile({ type: 'asset', fileName: entry.name, source: readFileSync(join(publicDir, entry.name)) })
      }
      for (const [fileName, source] of Object.entries(DEMO_FILES)) this.emitFile({ type: 'asset', fileName, source })
      for (const [fileName, output] of Object.entries(bundle)) {
        const text = output.type === 'chunk' ? output.code : typeof output.source === 'string' ? output.source : ''
        const found = NEVER_IN_DEMO.exec(text)
        if (found) this.error(`The demo build would hold ${found[0]} in ${fileName}.`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
    plugins: [react(), tailwindcss(), ...(demo ? [demoBuild()] : [])],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_DATE__:  JSON.stringify(buildDate),
      ...(demo ? { 'import.meta.env.VITE_DEMO': JSON.stringify('1') } : {}),
    },
    resolve: {
      alias: demo
        ? [...FIREBASE_SHIMS, { find: '@', replacement: srcDir }]
        : { '@': srcDir },
    },
    ...(demo ? { publicDir: false, build: { outDir: 'dist-demo', sourcemap: false } } : {}),
  }
})
