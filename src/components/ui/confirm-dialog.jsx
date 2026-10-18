import { Button } from "./button"
import { Dialog, DialogFooter } from "./dialog"

// A question with two answers. Cancel comes first in the document, so focus starts
// on it and Enter does not confirm by accident. While busy is true the work is
// running: the confirm button says Working and ignores a press, so it cannot be
// pressed twice, and a status region reads Working to a screen reader. The button is
// aria-disabled and not natively disabled, so the person who pressed it keeps focus
// inside the dialog and does not land on the page behind it. Cancel stays on.
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
          focusableWhenDisabled
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => onConfirm()}>
          {busy ? "Working" : confirmLabel}
        </Button>
      </DialogFooter>
      {/* In the document from the start, so that the text which arrives in it is announced. */}
      <span role="status" className="sr-only">{busy ? "Working" : ""}</span>
    </Dialog>
  );
}

export { ConfirmDialog }
