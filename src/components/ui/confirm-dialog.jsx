import { Button } from "./button"
import { Dialog, DialogFooter } from "./dialog"

// A question with two answers. Cancel comes first in the document, so focus starts
// on it and Enter does not confirm by accident. While busy is true the work is
// running: the confirm button is off and says Working, so it cannot be pressed twice.
//
//   <ConfirmDialog
//     open={open} onClose={close} onConfirm={reject} busy={busy}
//     title="Reject this change order?" body="The builder is told it was rejected."
//     confirmLabel="Reject" tone="critical" />
//
// The page decides when the dialog closes, as it does for Dialog.
function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "brand",
  busy = false,
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={body} size="sm">
      <DialogFooter>
        <Button type="button" variant="outline" className="h-11 md:h-8" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={tone === "critical" ? "destructive" : "brand"}
          className="h-11 md:h-8"
          disabled={busy}
          onClick={onConfirm}>
          {busy ? "Working" : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export { ConfirmDialog }
