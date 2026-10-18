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
// The page decides when the dialog closes, as it does for Dialog. The two callbacks
// are called with nothing, so neither is ever handed the click event.
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
        <Button type="button" variant="outline" onClick={() => onClose()}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={tone === "critical" ? "destructive" : "brand"}
          disabled={busy}
          onClick={() => onConfirm()}>
          {busy ? "Working" : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export { ConfirmDialog }
