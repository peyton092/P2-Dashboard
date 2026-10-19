import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation } from './useMutation'

// A text box over a value that is stored somewhere else, such as the next action of a job in
// Firestore, and saved when the person leaves the box.
//
//   const field = useSavedField({
//     stored: job.nextAction || '',
//     enabled: !!job._docId,
//     normalize: (text) => text.trim(),
//     write: (value) => updateJob(job._docId, { nextAction: value }),
//     success: 'Next action saved.',
//     error: 'Could not save the next action. Try again.',
//   })
//   <input value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
//   {field.saving && <span>saving…</span>}
//
// What the box shows is what is stored while nothing has been typed in it, so a value that
// someone else saved shows up, and leaving the box without typing writes nothing, where the
// box used to write the old value back over the new one. Once something is typed, the box
// shows that, and a change made elsewhere does not take it away while it is being typed. It
// stays what was typed until it is dealt with: written, or found to be what is stored.
//
// Firestore applies a write to its cache at once, so the stored value is the new one before
// the server has answered, and goes back to the old one if the rules refuse the write. So the
// box is one box all along, and not made again when the stored value changes: it says saving
// from the moment it was left until run has the answer, and when the write is refused the
// typed text is still in it, under the error toast, to be written again by leaving the box
// again. When the write went through, the box shows what is stored, unless more was typed
// since. Leaving the box again while the write is out, with nothing new, writes nothing, and
// does not let go of the text either, because a refusal is going to need it.
//
// normalize is what is compared with what is stored and what is written: a box that trims
// gives it (text) => text.trim(). enabled is false where there is nowhere to write. write is
// one Firestore write and nothing else, because the box asks for the offline outcome of
// useMutation (queue: true): offline, a write that has not answered after a moment is
// reported as saved on this device.
//
// saveOnLeave is for a box whose text is worth more than its blur: a note that used to be
// written on every key. It also writes what was typed, through the same path and with the
// same words, when the box goes away without being left (the row is removed, the screen
// closes) and when the page is hidden (a reload). The toast shows for a screen that is gone.
export function useSavedField({ stored, enabled = true, normalize = (text) => text, write, success, error, saveOnLeave = false }) {
  const { run, busy: saving } = useMutation()
  const [draft, setDraft] = useState(null)

  // The typed text has been dealt with: show what is stored again, unless more was typed since.
  const settle = useCallback((saved) => setDraft((now) => (now === saved ? null : now)), [])

  const save = useCallback((now) => {
    if (!now.enabled || now.draft === null) return
    const next = now.normalize(now.draft)
    if (next === now.normalize(now.stored)) {
      // Nothing differs from what is stored. The text is let go of, unless a write of it is
      // still out: if that is refused, it is all the person has left.
      if (!now.saving) settle(now.draft)
      return
    }
    const typed = now.draft
    run(() => now.write(next), { success: now.success, error: now.error, queue: true }).then(({ ok }) => {
      if (ok) settle(typed)
    })
  }, [run, settle])

  const current = { draft, stored: stored ?? '', enabled, normalize, write, success, error, saving }
  // Read when the box goes away, by which time only the last render is left to ask.
  const latest = useRef(current)
  useLayoutEffect(() => { latest.current = current })

  useEffect(() => {
    if (!saveOnLeave) return undefined
    const leave = () => save(latest.current)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [saveOnLeave, save])

  return {
    value: draft ?? current.stored,
    onChange: (event) => setDraft(event.target.value),
    onBlur: () => save(current),
    saving,
  }
}
