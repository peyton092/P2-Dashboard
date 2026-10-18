import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const sw = read('../../public/sw.js')
const main = read('../main.jsx')

describe('service worker', () => {
  it('has no write queue', () => {
    expect(sw).not.toContain('writeQueue')
  })

  it('has no background sync listener', () => {
    expect(sw).not.toContain("addEventListener('sync'")
  })

  it('does not reference Firebase API hosts', () => {
    expect(sw).not.toContain('firestore.googleapis.com')
    expect(sw).not.toContain('identitytoolkit')
  })

  it('uses the bumped cache name', () => {
    expect(sw).toContain("CACHE_NAME = 'p2-control-v9'")
  })

  it('guards on same origin so cross origin requests pass through', () => {
    expect(sw).toContain('self.location.origin')
  })
})

describe('main.jsx', () => {
  it('does not mirror or replay an offline write queue', () => {
    expect(main).not.toContain('p2_offline_queue')
    expect(main).not.toContain('WRITE_QUEUED')
  })
})
