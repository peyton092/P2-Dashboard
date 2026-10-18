import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { callableMessage } from '@/lib/callableError'

// The one path a write takes, so that every write tells the person what happened.
//
//   const { run, busy, error } = useMutation()
//   const { ok, value } = await run(() => updateMaterial(id, patch), {
//     success: 'Material saved.',
//     error: 'Could not save the material. Try again.',
//     undo: () => updateMaterial(id, previous),
//   })
//   if (ok) closeTheForm()
//
// run calls fn and waits for it, then toasts the success words, or the error words with the
// reason underneath when the error carries a readable one. It never rejects, so a caller
// does not need a try block, and it resolves to { ok: true, value } or { ok: false, error },
// so a form is closed or cleared only when the write went through. error in the result and
// in the hook is the sentence a person reads: the reason the error gave (callableMessage
// drops a bare SDK code such as "internal" and keeps the sentence the Cloud Functions write
// for people), or the error words when there was no reason. The hook's error is null until
// a run fails and is cleared when the next one starts.
//
// With undo, the success toast carries an Undo button. Pressing it runs undo through the
// same path: Undone when it worked, and Could not undo, with the reason, when it did not.
// undo may be async. Without success words, an undoable write says Done so that the Undo
// has a toast to sit on. A success with no words, and no undo, shows nothing: use that
// where the screen already shows the result, such as a notification turning read.
//
// busy is true while any run of this hook is out, counted, so that two overlapping runs do
// not flicker it off in between. run is the same function on every render, so it is safe in
// a dependency list. Once the screen is gone nothing is set, but the toast is still shown,
// because the write still happened and the person still needs to know how it ended.
const ERROR_WORDS = 'Something went wrong. Try again.'
const UNDO_ERROR_WORDS = 'Could not undo. Try again.'

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

  const run = useCallback(async function run(fn, { success, error: errorWords = ERROR_WORDS, undo } = {}) {
    // Only a run that was counted in is counted out, whatever happens to the screen between.
    const counted = mounted.current
    if (counted) {
      setInFlight(count => count + 1)
      setError(null)
    }
    try {
      const value = await fn()
      const title = success || (undo ? 'Done.' : '')
      if (title) {
        toastRef.current(undo
          ? { tone: 'success', title, action: { label: 'Undo', onClick: () => run(undo, { success: 'Undone.', error: UNDO_ERROR_WORDS }) } }
          : { tone: 'success', title })
      }
      return { ok: true, value }
    } catch (err) {
      const message = callableMessage(err, errorWords)
      toastRef.current(message === errorWords
        ? { tone: 'error', title: errorWords }
        : { tone: 'error', title: errorWords, description: message })
      if (counted && mounted.current) setError(message)
      return { ok: false, error: message }
    } finally {
      if (counted && mounted.current) setInFlight(count => count - 1)
    }
  }, [])

  return { run, busy: inFlight > 0, error }
}
