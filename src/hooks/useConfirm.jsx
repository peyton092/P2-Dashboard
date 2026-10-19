import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// The question that comes before a consequential action. A screen asks, and puts dialog
// in its markup:
//
//   const { ask, dialog } = useConfirm()
//   ask({
//     title: 'Disconnect QuickBooks?',
//     body: 'Automatic sync of invoices stops until you reconnect.',
//     confirmLabel: 'Disconnect',
//     tone: 'critical',
//     onConfirm: () => run(() => qbDisconnect(), { success: 'QuickBooks disconnected.' }),
//   })
//   return <>{...}{dialog}</>
//
// Work that goes to the server keeps the dialog open while it runs, with the confirm
// button reading Working, and closes it when the work went through. onConfirm gives back
// what run of useMutation gives, { ok }. When ok is false the dialog stays open, and the
// error toast that run showed is on top of it, so the person can try again or cancel. A
// result that is not { ok: false }, such as nothing at all, or the { ok: true, queued: true }
// that a run given queue: true gives for a write that was saved on the device while it was
// offline, counts as done.
//
// Work that is a local change or one Firestore applies at once (dismissing an alert,
// taking a line off a form) passes instant: the dialog closes first and the work follows,
// and a failure is reported by the toast alone.
//
// A question is answered once. The popup stays on the screen, and focused, through its exit,
// so a second Enter on the confirm button can arrive after the first, or in the same turn,
// and a confirm after the question was answered or cancelled does nothing. A question that
// is asked while another is still out is a new one: it opens ready to answer, and the work
// of the first, ending later, does not close it or take it out of Working. Cancel stays on
// while work is out, which is how that happens.
//
// Focus goes back to the control that asked, which Dialog does when it closes. The words
// of the question stay on the dialog while it fades out. Nothing is drawn until the first
// question is asked, so a list with a row for every phase of every job, each row able to
// ask, does not carry a dialog for each of them.
export function useConfirm() {
  const [request, setRequest] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  // These are read in the same turn they are written, which state is not, so they are refs:
  // the number of the question on the dialog now, whether it is open and unanswered, and
  // whether the work for it is out.
  const latest = useRef(0)
  const waiting = useRef(false)
  const working = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const ask = useCallback((next) => {
    latest.current += 1
    waiting.current = true
    working.current = false
    setRequest({ ...next, id: latest.current })
    setBusy(false)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    waiting.current = false
    setOpen(false)
  }, [])

  const confirm = useCallback(async () => {
    if (!request || !waiting.current || working.current) return
    const mine = request.id
    if (request.instant) {
      waiting.current = false
      setOpen(false)
      await request.onConfirm()
      return
    }
    working.current = true
    setBusy(true)
    let result
    try {
      result = await request.onConfirm()
    } finally {
      // Only the question that is on the dialog now is settled by its own work. If another was
      // asked while this one was out, the dialog is that one's, and Working is its own.
      if (latest.current === mine) {
        working.current = false
        if (mounted.current) setBusy(false)
      }
    }
    if (mounted.current && latest.current === mine && result?.ok !== false) {
      waiting.current = false
      setOpen(false)
    }
  }, [request])

  const dialog = request && (
    <ConfirmDialog
      open={open}
      onClose={close}
      onConfirm={confirm}
      busy={busy}
      title={request.title}
      body={request.body}
      confirmLabel={request.confirmLabel}
      tone={request.tone}
    />
  )

  return { ask, dialog }
}
