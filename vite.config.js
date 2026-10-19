import { defineConfig, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'

const buildDate = new Date().toISOString().slice(0, 10)
const appVersion = 'V5.2'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
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
  // connect-src 'self' has the browser itself refuse any request the page makes to
  // another host, Firebase and Google included, should one ever be bundled. It leaves
  // the page's images, fonts and scripts as they are.
  '_headers': [
    '/*',
    '  X-Robots-Tag: noindex, nofollow',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    "  Content-Security-Policy: connect-src 'self'",
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

// The demo build reads no env file (envDir: false below). The .env.local that
// .env.example asks a developer for holds the Firebase web push key, and every build
// reads that file, so the demo would carry the key. These are the env files of every
// mode the app is built in; the build check also looks for their VITE_ values in what
// the demo build writes, so the key cannot reach the demo by another road either.
const ENV_FILES = ['.env', '.env.local', '.env.demo', '.env.demo.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local']

// The values the env files give VITE_ keys. Values of 8 characters or fewer, like true
// or 1, are left out, since they could be anywhere.
function envFileValues() {
  const values = new Set()
  for (const file of ENV_FILES) {
    let text
    try {
      text = readFileSync(join(rootDir, file), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const found = /^\s*(?:export\s+)?VITE_\w*\s*=\s*(.*?)\s*$/.exec(line)
      if (!found) continue
      const quoted = /^(['"`])(.*)\1$/.exec(found[1])
      const value = quoted ? quoted[2] : found[1].replace(/\s+#.*$/, '')
      if (value.length > 8) values.add(value)
    }
  }
  return [...values]
}

function demoBuild() {
  const realFirebase = normalize(join(srcDir, 'firebase.js'))
  const demoFirebase = join(srcDir, 'demo', 'firebase.js')
  let envValues = []
  return {
    name: 'p2-demo-build',
    enforce: 'pre',
    // No VITE_ value reaches the demo: not from an env file, which it does not read,
    // and not from the shell either. One that is set stops the build before it starts.
    configResolved(config) {
      const set = Object.keys(config.env).filter((key) => key.startsWith('VITE_'))
      if (set.length > 0) {
        throw new Error(`The demo build takes no VITE_ values, and ${set.join(', ')} is set. Unset it for npm run build:demo.`)
      }
      envValues = envFileValues()
    },
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
    // Every file of the build is checked for what the demo must never hold: the chunks,
    // the stylesheets and the page (this runs after every other plugin has added its
    // files, so the page is there), then the public files, less the service workers,
    // and the files a static host reads, each checked as it is added.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const decoder = new TextDecoder()
        const check = (fileName, source) => {
          const text = typeof source === 'string' ? source : decoder.decode(source)
          const found = NEVER_IN_DEMO.exec(text)
          if (found) this.error(`The demo build would hold ${found[0]} in ${fileName}.`)
          if (envValues.some((value) => text.includes(value))) this.error(`The demo build would hold the VITE_ value of an env file in ${fileName}.`)
        }
        for (const [fileName, output] of Object.entries(bundle)) check(fileName, output.type === 'chunk' ? output.code : output.source)
        // public/ at every depth, so a folder added there is copied too.
        const publicFiles = readdirSync(publicDir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => normalizePath(relative(publicDir, join(entry.parentPath ?? entry.path, entry.name))))
          .filter((fileName) => !LEFT_OUT.includes(fileName))
          .map((fileName) => [fileName, readFileSync(join(publicDir, fileName))])
        for (const [fileName, source] of [...publicFiles, ...Object.entries(DEMO_FILES)]) {
          check(fileName, source)
          this.emitFile({ type: 'asset', fileName, source })
        }
      },
    },
  }
}

// ── Every other build ─────────────────────────────────────────────────────────
//
// A build that is not the demo loads no demo module: nothing under src/demo, and not
// the sample data in scripts/demo-data.mjs. main.jsx reaches the demo only through an
// import() behind import.meta.env.VITE_DEMO === '1', which is false here, so the build
// drops it without loading it. Should anything else ever pull a demo module in, the
// build stops rather than ship it. src/__tests__/no-demo-in-prod.test.js reads the
// sources for the same thing.
function noDemoOutsideTheDemo() {
  const demoDir = `${normalizePath(join(srcDir, 'demo'))}/`
  const sampleData = normalizePath(join(rootDir, 'scripts', 'demo-data.mjs'))
  return {
    name: 'p2-no-demo-outside-the-demo',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      const path = normalizePath(id.split('?')[0])
      if (path.startsWith(demoDir) || path === sampleData) {
        this.error(`This build would load ${relative(rootDir, path)}, which only the demo build (npm run build:demo) may hold.`)
      }
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
    plugins: [react(), tailwindcss(), ...(demo ? [demoBuild()] : [noDemoOutsideTheDemo()])],
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
    ...(demo ? { envDir: false, publicDir: false, build: { outDir: 'dist-demo', sourcemap: false } } : {}),
  }
})
