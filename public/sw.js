// CACHE_NAME is rewritten at build time (see vite.config.js → swCacheVersion
// plugin) so every release ships a fresh static cache and the activate
// handler can sweep the old ones. The literal token below is what gets
// replaced; leave it intact for non-Vite serve paths (the SW still works,
// you just get the dev-mode cache name).
const CACHE_NAME = 'p2-control-__P2_CACHE_VERSION__'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons.svg',
  '/p2-logo.svg',
  '/p2-mark.svg',
]

// In-memory write queue — survives until SW is terminated
const writeQueue = []

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  // Network-first: Firestore, Firebase APIs — queue writes when offline
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.pathname.startsWith('/api/')
  ) {
    if (request.method !== 'GET') {
      e.respondWith(
        fetch(request.clone()).catch(async () => {
          const body = await request.text().catch(() => '')
          // Strip auth-sensitive headers before persisting. The page re-mints
          // a fresh ID token on replay (see main.jsx FLUSH_QUEUE handler) so
          // bearer tokens never sit in localStorage.
          const SENSITIVE = /^(authorization|cookie|x-firebase|x-goog-firebase)/i
          const headers = Object.fromEntries(
            [...request.headers.entries()].filter(([k]) => !SENSITIVE.test(k)),
          )
          const entry = {
            url: request.url,
            method: request.method,
            headers,
            body,
            timestamp: Date.now(),
          }
          writeQueue.push(entry)
          // Notify all clients so they can persist to localStorage
          const clients = await self.clients.matchAll()
          clients.forEach((c) => c.postMessage({ type: 'WRITE_QUEUED', entry }))
          // Register background sync if available
          self.registration.sync?.register('p2-sync-writes').catch(() => {})
          return new Response(JSON.stringify({ queued: true }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          })
        })
      )
    } else {
      e.respondWith(
        fetch(request).catch(() =>
          new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
        )
      )
    }
    return
  }

  // HTML navigation — network-first, fall back to /index.html for offline SPA
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    )
    return
  }

  // Cache-first: static assets. Skip caching non-GETs, opaque responses,
  // anything outside our origin, and any response that opts out via Cache-
  // Control (Firestore + auth APIs already returned above, but extra belt).
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    e.respondWith(fetch(request))
    return
  }
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response
        }
        const cc = response.headers.get('cache-control') || ''
        if (/no-store|private/i.test(cc)) return response
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        return response
      })
    })
  )
})

// ── Background sync — replay queued writes ────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'p2-sync-writes') {
    event.waitUntil(replayQueue())
  }
})

async function replayQueue() {
  const toRetry = writeQueue.splice(0)
  const failed = []
  for (const entry of toRetry) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body || undefined,
      })
      if (!res.ok) failed.push(entry)
    } catch {
      failed.push(entry)
    }
  }
  // Put failed ones back
  writeQueue.unshift(...failed)

  // Notify clients so they can clear localStorage queue too
  const clients = await self.clients.matchAll()
  clients.forEach((c) => c.postMessage({ type: 'FLUSH_QUEUE', replayed: toRetry.length - failed.length }))
}

// ── Online event — trigger replay ─────────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'ONLINE' && writeQueue.length > 0) replayQueue()
})
