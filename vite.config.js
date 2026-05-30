import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const buildDate = new Date().toISOString().slice(0, 10)
const appVersion = 'V5.2'

// Manual chunk groups. Default Vite bundling rolls React + Firebase + the
// entry into one ~900 kB blob that ships before first paint. Splitting them
// lets the browser parse in parallel and lets Firebase submodules cache
// independently across releases.
//
// IMPORTANT: only group libraries that are ALREADY in the eager graph.
// Grouping a lazy-only library (recharts, jspdf) under a named chunk pulls
// it into the preload graph and undoes the lazy-loading win.
function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined
  if (id.includes('/firebase/firestore/')) return 'vendor-firebase-firestore'
  if (id.includes('/firebase/auth/'))      return 'vendor-firebase-auth'
  if (id.includes('/firebase/storage/'))   return 'vendor-firebase-storage'
  if (id.includes('/firebase/functions/')) return 'vendor-firebase-functions'
  if (id.includes('/firebase/'))           return 'vendor-firebase-core'
  if (id.includes('/@firebase/'))          return 'vendor-firebase-core'
  if (id.includes('/react-dom/') ||
      id.includes('/react/') ||
      id.includes('/scheduler/'))          return 'vendor-react'
  return undefined
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__:  JSON.stringify(buildDate),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: { manualChunks },
    },
  },
})
