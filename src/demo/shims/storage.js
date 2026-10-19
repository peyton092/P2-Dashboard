// firebase/storage for the demo build. An upload is kept in memory on this device and
// never leaves it. A download URL is one the browser opens with no network: a data URL
// for an image of up to 400 KB, which is also kept with the document that names it,
// and an object URL for anything else, which lasts while the page is open.
//
//   getStorage, ref                 references by path
//   uploadBytes                     resolves { ref, metadata }
//   uploadBytesResumable            a task with on('state_changed', progress, error,
//                                   complete), snapshot.ref and then, as the folders
//                                   screen uses it
//   getDownloadURL                  the URL above, or storage/object-not-found

export const DATA_URL_LIMIT = 400 * 1024

export class DemoStorageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FirebaseError'
    this.code = `storage/${code}`
  }
}

class StorageReference {
  constructor(storage, path) {
    this.storage = storage
    this.fullPath = path
    this.name = path.split('/').pop() ?? ''
    this.bucket = 'demo'
  }

  toString() {
    return `demo:/${this.fullPath}`
  }
}

const storages = new Map()

export function getStorage(app) {
  const key = app ?? 'default'
  if (!storages.has(key)) storages.set(key, { app, files: new Map(), links: new Map() })
  return storages.get(key)
}

const joined = (...parts) => parts.flatMap((part) => String(part).split('/')).filter(Boolean).join('/')

export function ref(parent, path = '') {
  if (parent instanceof StorageReference) return new StorageReference(parent.storage, joined(parent.fullPath, path))
  return new StorageReference(parent, joined(path))
}

const blobOf = (data, metadata) => (data instanceof Blob ? data : new Blob([data], { type: metadata?.contentType ?? '' }))

const metadataOf = (reference, blob) => ({
  bucket: reference.bucket,
  fullPath: reference.fullPath,
  name: reference.name,
  size: blob.size,
  contentType: blob.type || 'application/octet-stream',
})

function keep(reference, blob) {
  reference.storage.files.set(reference.fullPath, blob)
  reference.storage.links.delete(reference.fullPath)
}

export async function uploadBytes(reference, data, metadata) {
  const blob = blobOf(data, metadata)
  keep(reference, blob)
  return { ref: reference, metadata: metadataOf(reference, blob) }
}

class UploadTask {
  constructor(reference, blob) {
    this._observers = []
    this._done = false
    this.snapshot = { ref: reference, bytesTransferred: 0, totalBytes: blob.size, state: 'running', metadata: null, task: this }
    this._finished = new Promise((resolve) => {
      // In a macrotask, as an upload reports after it starts.
      setTimeout(() => {
        keep(reference, blob)
        this.snapshot = { ...this.snapshot, bytesTransferred: blob.size, state: 'success', metadata: metadataOf(reference, blob) }
        this._done = true
        for (const observer of [...this._observers]) observer.next?.(this.snapshot)
        for (const observer of [...this._observers]) observer.complete?.()
        resolve(this.snapshot)
      }, 0)
    })
  }

  on(_event, nextOrObserver, error, complete) {
    const observer = typeof nextOrObserver === 'function' || nextOrObserver == null
      ? { next: nextOrObserver, error, complete }
      : nextOrObserver
    if (this._done) {
      queueMicrotask(() => {
        observer.next?.(this.snapshot)
        observer.complete?.()
      })
    } else {
      this._observers.push(observer)
    }
    return () => {
      this._observers = this._observers.filter((o) => o !== observer)
    }
  }

  then(onFulfilled, onRejected) {
    return this._finished.then(onFulfilled, onRejected)
  }

  catch(onRejected) {
    return this._finished.catch(onRejected)
  }

  pause() { return false }

  resume() { return false }

  cancel() { return false }
}

export function uploadBytesResumable(reference, data, metadata) {
  return new UploadTask(reference, blobOf(data, metadata))
}

function dataUrlOf(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function getDownloadURL(reference) {
  const { files, links } = reference.storage
  const blob = files.get(reference.fullPath)
  if (!blob) throw new DemoStorageError('object-not-found', `Object ${reference.fullPath} does not exist.`)
  if (blob.type.startsWith('image/') && blob.size <= DATA_URL_LIMIT) return dataUrlOf(blob)
  if (typeof URL.createObjectURL !== 'function') return dataUrlOf(blob)
  if (!links.has(reference.fullPath)) links.set(reference.fullPath, URL.createObjectURL(blob))
  return links.get(reference.fullPath)
}
