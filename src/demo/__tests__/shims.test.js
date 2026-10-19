import { describe, it, expect, vi, afterEach } from 'vitest'
import { initializeApp } from '../shims/app'
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL } from '../shims/storage'
import { getMessaging, getToken, isSupported, onMessage } from '../shims/messaging'
import { getFunctions } from '../shims/functions'
import { deviceStorage, announceSaveFailed, DEMO_SAVE_FAILED_EVENT } from '../device'

// The smaller shims. Storage keeps uploads in memory on the device and gives back a
// link the browser can open without a network: a data URL for an image of up to
// 400 KB, and an object URL for anything else. Messaging says it is not supported, so
// the app never asks for a push token.

const KB = 1024

const fileOf = (size, type, name = 'upload.bin') => new File([new Uint8Array(size).fill(65)], name, { type })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the demo app', () => {
  it('carries no Firebase configuration, whatever it is given', () => {
    const app = initializeApp({ demo: {} })
    expect(app.name).toBe('[DEFAULT]')
    expect(JSON.stringify(app.options)).toBe('{}')
    expect(typeof app.demoStore).toBe('function')
    expect(typeof app.demoSession).toBe('function')
  })

  it('makes its store once, when it is first asked for it', () => {
    const seed = vi.fn(() => ({ jobs: { a: { id: 'QBS-001' } } }))
    const app = initializeApp({ demo: { store: { seed, version: 'test' } } })
    expect(seed).not.toHaveBeenCalled()
    expect(app.demoStore()).toBe(app.demoStore())
    expect(app.demoStore().get('jobs', 'a')).toEqual({ id: 'QBS-001' })
    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('hands its parts to the functions shim', () => {
    const app = initializeApp({})
    expect(getFunctions(app).app).toBe(app)
  })

  it('keeps saved state for its own seed version and build alone', async () => {
    vi.resetModules()
    vi.stubGlobal('__BUILD_DATE__', '2026-10-19')
    const { DEMO_STATE_VERSION } = await import('../firebase')
    const { DEMO_SEED_VERSION } = await import('../seed')
    expect(DEMO_STATE_VERSION).toBe(`${DEMO_SEED_VERSION} built 2026-10-19`)
  })
})

describe('storage', () => {
  const storage = () => getStorage(initializeApp({}))

  it('names a reference by its path', () => {
    const r = ref(storage(), 'jobs/QBS-001/files/plan.pdf')
    expect(r.fullPath).toBe('jobs/QBS-001/files/plan.pdf')
    expect(r.name).toBe('plan.pdf')
  })

  it('gives a data URL for a small image, which the browser opens with no network', async () => {
    const r = ref(storage(), 'daily_reports/2026-10-19/QBS-001/photo.png')
    const result = await uploadBytes(r, fileOf(10, 'image/png', 'photo.png'))
    expect(result.ref).toBe(r)
    expect(result.metadata).toMatchObject({ fullPath: r.fullPath, size: 10, contentType: 'image/png' })
    await expect(getDownloadURL(r)).resolves.toBe(`data:image/png;base64,${btoa('A'.repeat(10))}`)
  })

  it('gives an object URL for a larger image and for a document', async () => {
    const createObjectURL = vi.fn(() => 'blob:demo/1')
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }))
    const s = storage()
    const big = ref(s, 'jobs/QBS-001/files/site.jpg')
    await uploadBytes(big, fileOf(400 * KB + 1, 'image/jpeg', 'site.jpg'))
    await expect(getDownloadURL(big)).resolves.toBe('blob:demo/1')
    const pdf = ref(s, 'jobs/QBS-001/files/plan.pdf')
    await uploadBytes(pdf, fileOf(20, 'application/pdf', 'plan.pdf'))
    await expect(getDownloadURL(pdf)).resolves.toBe('blob:demo/1')
    expect(createObjectURL).toHaveBeenCalledTimes(2)
  })

  it('refuses a link to something that was never uploaded, with the code storage uses', async () => {
    await expect(getDownloadURL(ref(storage(), 'nothing/here.png'))).rejects.toMatchObject({ code: 'storage/object-not-found' })
  })

  it('runs a resumable upload as the folders screen does, reporting progress and then completing', async () => {
    const s = storage()
    const r = ref(s, 'jobs/QBS-001/files/notes.pdf')
    const progress = []
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(r, fileOf(2048, 'application/pdf', 'notes.pdf'))
      expect(task.snapshot.ref).toBe(r)
      task.on('state_changed',
        (snap) => progress.push(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
        reject,
        resolve,
      )
    })
    expect(progress[progress.length - 1]).toBe(100)
    const task = uploadBytesResumable(r, fileOf(16, 'application/pdf', 'notes.pdf'))
    await expect(task).resolves.toMatchObject({ ref: r, state: 'success', totalBytes: 16 })
  })
})

describe('the storage of the device', () => {
  it('answers true when a write is kept, and false when the browser refuses it', () => {
    expect(deviceStorage().setItem('p2-demo-probe', 'kept')).toBe(true)
    expect(window.localStorage.getItem('p2-demo-probe')).toBe('kept')
    window.localStorage.removeItem('p2-demo-probe')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    expect(deviceStorage().setItem('p2-demo-probe', 'too much')).toBe(false)
  })

  it('tells the page when a save did not fit, with an event the banner listens for', () => {
    const heard = vi.fn()
    window.addEventListener(DEMO_SAVE_FAILED_EVENT, heard)
    announceSaveFailed()
    window.removeEventListener(DEMO_SAVE_FAILED_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('messaging', () => {
  it('is not supported, and does nothing when called anyway', async () => {
    await expect(isSupported()).resolves.toBe(false)
    const messaging = getMessaging(initializeApp({}))
    await expect(getToken(messaging, { vapidKey: 'x' })).resolves.toBeNull()
    const stop = onMessage(messaging, () => {})
    expect(typeof stop).toBe('function')
    expect(() => stop()).not.toThrow()
  })
})
