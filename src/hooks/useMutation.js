import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { callableMessage } from '@/lib/callableError'
import { logError } from '@/lib/errorLogger'

// The one path a write takes, so that every write tells the person what happened.
//
//   const { run, busy, error } = useMutation()
//   const { ok, value } = await run(() => updateMaterial(id, patch), {
//     success: 'Material saved.',
//     error: 'Could not save the material. Try again.',
//     undo: () => updateMaterial(id, previous),
//     queue: true,
//   })
//   if (ok) closeTheForm()
//
// run calls fn and waits for it, then toasts the success words, or the error words with the
// reason underneath when the error carries a readable one. It never rejects, so a caller
// does not need a try block, and it resolves to { ok: true, value } or { ok: false, error },
// so a form is closed or cleared only when the write went through. error in the result and
// in the hook is the sentence a person reads: the reason the error gave (callableMessage
// drops a bare SDK code such as "internal", puts a plain sentence on the Firestore codes that
// have one, and keeps the sentence the Cloud Functions write for people), or the error words
// when there was no reason. The hook's error is null until a run fails and is cleared when
// the next one starts. Every failure is also reported to the error logger, with the source
// mutation, because the rejection that used to reach it unhandled is handled here.
//
// With undo, the success toast carries an Undo button. Pressing it runs undo through the
// same path: Undone when it worked, and Could not undo, with the reason, when it did not.
// undo may be async. Without success words, an undoable write says Done so that the Undo
// has a toast to sit on. A success with no words, and no undo, shows nothing: use that
// where the screen already shows the result, such as a notification turning read.
//
// A Firestore write resolves when the server has acknowledged it, and while the device is
// offline it does not, though the entry is already in the local cache and will be sent when
// the connection is back. A run that is given queue: true says that fn is exactly that: one
// Firestore write (updateDoc, setDoc, addDoc, deleteDoc, a batch, or a Promise.all of those),
// applied on this device at once, with nothing after it that depends on the server's answer,
// and a caller that does not use value. Such a run that is still out after OFFLINE_WAIT_MS
// while the device is offline resolves { ok: true, queued: true } and says it was saved on
// this device, with no success words and no Undo. The write itself is still watched: if it is
// refused later the person is told, and if it goes through later nothing more is shown. While
// the device is online the run waits for the acknowledgement, however long it takes, and the
// check is made again each OFFLINE_WAIT_MS in case the device went offline meanwhile.
//
// queue is false unless it is given, and then run waits for fn however long it takes and
// starts no timer. That is right for everything that is not one Firestore write. Nothing
// queues a call to a Cloud Function or to Auth, so "saved on this device" would be false of
// it. A function that awaits one thing and then does more has not done the rest while the
// first await is still out, and gives no value back, so whatever the caller does next would
// work on half of it. An undo takes the queue of the run it undoes.
//
// busy is true while any run of this hook is out, counted, so that two overlapping runs do
// not flicker it off in between, and false once a run has resolved queued. run is the same
// function on every render, so it is safe in a dependency list. Once the screen is gone
// nothing is set, but the toast is still shown, because the write still happened and the
// person still needs to know how it ended.
export const OFFLINE_WAIT_MS = 2500

const ERROR_WORDS = 'Something went wrong. Try again.'
const UNDO_ERROR_WORDS = 'Could not undo. Try again.'
const QUEUED_WORDS = 'Saved on this device. It will sync when you are back online.'

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

// Settles with the outcome of the work, or with { queued: true } when it is still out and the
// device is offline at a check. A rejection of the work rejects this, unless it came after.
function settleOrQueue(work) {
  return new Promise((resolve, reject) => {
    let timer
    const check = () => {
      if (offline()) resolve({ queued: true })
      else timer = setTimeout(check, OFFLINE_WAIT_MS)
    }
    timer = setTimeout(check, OFFLINE_WAIT_MS)
    work.then(
      (value) => { clearTimeout(timer); resolve({ value }) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

export function useMutation() {
  const toast = useToast()
  const toastRef = useRef(toast)
  const mounted = useRef(false)
  const [inFlight, setInFlight] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const run = useCallback(async function run(fn, { success, error: errorWords = ERROR_WORDS, undo, queue = false } = {}) {
    // Only a run that was counted in is counted out, whatever happens to the screen between.
    const counted = mounted.current
    if (counted) {
      setInFlight(count => count + 1)
      setError(null)
    }

    // Tells the person, and the error log, that the work failed. Gives back the sentence.
    const fail = (err) => {
      const message = callableMessage(err, errorWords)
      toastRef.current(message === errorWords
        ? { tone: 'error', title: errorWords }
        : { tone: 'error', title: errorWords, description: message })
      // The logger never throws, but run promises never to reject, so it does not rely on that.
      try { logError(err, 'mutation') } catch { /* the log does not decide how a write ends */ }
      return message
    }

    try {
      // fn is called here and now, so that a throw before it returns a promise is a failure
      // like any other.
      const work = (async () => fn())()
      const outcome = queue ? await settleOrQueue(work) : { value: await work }
      if (outcome.queued) {
        // The write is still out. Say where the entry is, and keep watching it.
        work.then(undefined, (err) => {
          const message = fail(err)
          if (mounted.current) setError(message)
        })
        toastRef.current({ tone: 'info', title: QUEUED_WORDS })
        return { ok: true, value: undefined, queued: true }
      }
      const { value } = outcome
      const title = success || (undo ? 'Done.' : '')
      if (title) {
        toastRef.current(undo
          ? { tone: 'success', title, action: { label: 'Undo', onClick: () => run(undo, { success: 'Undone.', error: UNDO_ERROR_WORDS, queue }) } }
          : { tone: 'success', title })
      }
      return { ok: true, value }
    } catch (err) {
      const message = fail(err)
      if (counted && mounted.current) setError(message)
      return { ok: false, error: message }
    } finally {
      if (counted && mounted.current) setInFlight(count => count - 1)
    }
  }, [])

  return { run, busy: inFlight > 0, error }
}
