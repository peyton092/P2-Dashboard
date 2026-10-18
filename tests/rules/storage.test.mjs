import { before, after, beforeEach, describe, it } from 'node:test'
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes } from 'firebase/storage'
import { ALLOWED_UPLOAD_TYPES } from '../../src/lib/uploads.js'
import { setupEnv } from './helpers.mjs'

// Clients upload photos and documents for their own jobs under
// jobs/{jobDocId}/client-uploads/. The storage rule reads the job document from
// Firestore to see whether its clientUids list the uploader, so each test seeds
// the jobs first. Every other path is for staff only.

const MB = 1024 * 1024
const bytes = (size) => new Uint8Array(size)
const put = (storage, path, size, contentType) => uploadBytes(ref(storage, path), bytes(size), { contentType })

describe('storage rules', () => {
  let t
  // Each test writes under its own file name, so nothing one test uploads is seen by another.
  let n = 0
  const name = (ext) => `${Date.now()}-${++n}.${ext}`

  before(async () => {
    t = await setupEnv()
  })

  after(async () => {
    await t.env.cleanup()
  })

  beforeEach(async () => {
    await t.clearStorage()
    await t.env.clearFirestore()
    await t.seed(async (db) => {
      await setDoc(doc(db, 'jobs/qbs1'), { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'] })
      await setDoc(doc(db, 'jobs/vis1'), { id: 'VIS-001', tenantId: 'vision', clientUids: ['c2'] })
      await setDoc(doc(db, 'users/s9'), { role: 'internal' })
      await setDoc(doc(db, 'users/c9'), { role: 'client', clientJobIds: ['QBS-001'] })
    })
  })

  const client = () => t.storageAs('c1', { role: 'client', clientJobIds: ['QBS-001'] })
  const staff = () => t.storageAs('s1', { role: 'internal' })
  const owner = () => t.storageAs('o1', { role: 'owner' })
  const builder = () => t.storageAs('b1', { role: 'builder', tenantId: 'qbs' })

  describe('client uploads', () => {
    it('a client uploads a 1 MB JPEG to their own job', async () => {
      await assertSucceeds(put(client(), `jobs/qbs1/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
    })

    it('a client uploads a PDF to their own job', async () => {
      await assertSucceeds(put(client(), `jobs/qbs1/client-uploads/${name('pdf')}`, MB, 'application/pdf'))
    })

    it('a client cannot upload to a job that does not list them', async () => {
      await assertFails(put(client(), `jobs/vis1/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
    })

    it('a client cannot upload to a job that does not exist', async () => {
      await assertFails(put(client(), `jobs/nojob/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
    })

    it('a client cannot upload a zip file, even to their own job', async () => {
      await assertFails(put(client(), `jobs/qbs1/client-uploads/${name('zip')}`, MB, 'application/zip'))
    })

    // The rule takes exactly the types the app lets a person pick (ALLOWED_UPLOAD_TYPES),
    // so the two cannot drift apart: an SVG, which can carry script, is refused.
    it('a client uploads every type the app accepts, a WebP among them', async () => {
      if (!ALLOWED_UPLOAD_TYPES.includes('image/webp')) throw new Error('the app no longer accepts WebP')
      for (const type of ALLOWED_UPLOAD_TYPES) {
        await assertSucceeds(put(client(), `jobs/qbs1/client-uploads/${name('bin')}`, MB, type))
      }
    })

    it('a client cannot upload an SVG, or any other type the app does not accept', async () => {
      for (const type of ['image/svg+xml', 'image/gif', 'image/bmp', 'text/html', 'application/octet-stream']) {
        await assertFails(put(client(), `jobs/qbs1/client-uploads/${name('bin')}`, MB, type))
      }
    })

    it('a client cannot upload a file of 25 MB or more', async () => {
      await assertFails(put(client(), `jobs/qbs1/client-uploads/${name('jpg')}`, 25 * MB, 'image/jpeg'))
    })

    it('a client whose role is only in their users document uploads to a job that lists them, and no other', async () => {
      await t.seed((db) => setDoc(doc(db, 'jobs/qbs3'), { id: 'QBS-003', tenantId: 'qbs', clientUids: ['c9'] }))
      await assertSucceeds(put(t.storageAs('c9'), `jobs/qbs3/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
      await assertFails(put(t.storageAs('c9'), `jobs/qbs1/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
    })

    it('a builder cannot upload to a client uploads folder', async () => {
      await assertFails(put(builder(), `jobs/qbs1/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
    })

    it('staff upload to the client uploads folder of any job, with the same type and size limits', async () => {
      await assertSucceeds(put(staff(), `jobs/vis1/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
      await assertSucceeds(put(owner(), `jobs/qbs1/client-uploads/${name('pdf')}`, MB, 'application/pdf'))
      await assertFails(put(staff(), `jobs/qbs1/client-uploads/${name('zip')}`, MB, 'application/zip'))
      await assertFails(put(staff(), `jobs/qbs1/client-uploads/${name('svg')}`, MB, 'image/svg+xml'))
    })

    it('anyone signed in reads a client upload, and nobody signed out does', async () => {
      const path = `jobs/qbs1/client-uploads/${name('jpg')}`
      await t.env.withSecurityRulesDisabled((c) => put(c.storage(), path, 1024, 'image/jpeg'))
      await assertSucceeds(getBytes(ref(client(), path)))
      await assertSucceeds(getBytes(ref(builder(), path)))
      await assertFails(getBytes(ref(t.storageAnon(), path)))
    })

    it('nobody signed out uploads', async () => {
      await assertFails(put(t.storageAnon(), `jobs/qbs1/client-uploads/${name('jpg')}`, MB, 'image/jpeg'))
    })
  })

  describe('every other path', () => {
    const OTHER = (ext) => [`jobs/qbs1/files/${name(ext)}`, `daily_reports/2026-10-18/QBS-001/${name(ext)}`]

    it('staff upload anywhere', async () => {
      for (const storage of [staff(), owner()]) {
        for (const path of OTHER('pdf')) await assertSucceeds(put(storage, path, MB, 'application/pdf'))
      }
    })

    it('staff whose role is only in their users document upload too', async () => {
      for (const path of OTHER('jpg')) await assertSucceeds(put(t.storageAs('s9'), path, MB, 'image/jpeg'))
    })

    it('clients and builders cannot upload there', async () => {
      for (const storage of [client(), builder(), t.storageAs('c9')]) {
        for (const path of OTHER('jpg')) await assertFails(put(storage, path, MB, 'image/jpeg'))
      }
    })

    it('only staff read there', async () => {
      for (const path of OTHER('pdf')) {
        await t.env.withSecurityRulesDisabled((c) => put(c.storage(), path, 1024, 'application/pdf'))
        await assertSucceeds(getBytes(ref(staff(), path)))
        await assertFails(getBytes(ref(client(), path)))
        await assertFails(getBytes(ref(builder(), path)))
        await assertFails(getBytes(ref(t.storageAnon(), path)))
      }
    })
  })
})
