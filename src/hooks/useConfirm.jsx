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
// result that is not { ok: false }, such as nothing at all, counts as done.
//
// Work that is a local change or one Firestore applies at once (dismissing an alert,
// taking a line off a form) passes instant: the dialog closes first and the work follows,
// and a failure is reported by the toast alone.
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

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const ask = useCallback((next) => {
    setRequest(next)
    setOpen(true)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  const confirm = useCallback(async () => {
    if (!request) return
    if (request.instant) {
      setOpen(false)
      await request.onConfirm()
      return
    }
    setBusy(true)
    let result
    try {
      result = await request.onConfirm()
    } finally {
      if (mounted.current) setBusy(false)
    }
    if (mounted.current && result?.ok !== false) setOpen(false)
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
