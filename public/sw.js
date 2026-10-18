// Static asset caching and SPA navigation fallback only.
// Data requests (Firestore, Firebase Auth, any other origin) are never touched:
// Firestore handles its own offline persistence.
const CACHE_NAME = 'p2-control-v9'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons.svg',
]

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

  // Only GET requests are ever handled; everything else goes straight to the network.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Cross-origin requests (every Firebase API included) pass through untouched.
  if (url.origin !== self.location.origin) return

  // Same-origin navigation: network first, fall back to cache, then the SPA shell.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    )
    return
  }

  // Other same-origin GET requests: cache first, then network.
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
    })
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
