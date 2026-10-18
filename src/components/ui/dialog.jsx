import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconButton } from "./icon-button"

// A modal dialog on Base UI, which supplies role="dialog", aria-labelledby from the
// title, aria-describedby from the description, the focus trap, Escape, and the
// return of focus to whatever had it when the dialog opened. Base UI does not set
// aria-modal, so the popup does.
//
//   <Dialog open={open} onClose={() => setOpen(false)} title="Edit job" size="md">
//     <DialogBody>…</DialogBody>
//     <DialogFooter>…</DialogFooter>
//   </Dialog>
//
// onClose is called for Escape, for a click on the scrim or the space around the
// panel, and for the close button. The page decides whether the dialog closes, by
// setting open. Focus goes to the first thing a person can use, or to the element
// initialFocusRef names, such as the field a form begins with.
const SIZE = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
}

function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-display text-xl leading-tight font-semibold text-foreground", className)}
      {...props} />
  );
}

function DialogBody({ className, ...props }) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("px-5 pb-4 text-sm", className)}
      {...props} />
  );
}

// The actions, Cancel first. Stacked and full width on a phone, and in one row at
// the right from 640 pixels. Every button in it is at least 44 pixels tall under 768
// pixels, so a screen that puts a button here does not have to remember to ask.
function DialogFooter({ className, ...props }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col gap-2 border-t border-white/10 px-5 py-4 max-md:[&>button]:min-h-11 sm:flex-row sm:justify-end",
        className
      )}
      {...props} />
  );
}

function Dialog({ open, onClose, title, description, children, size = "sm", initialFocusRef }) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="dialog-scrim"
          className="fixed inset-0 z-[60] bg-black/70 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        {/* The viewport scrolls, so a dialog taller than the screen can be read to
            the end, and m-auto on the panel centers it when it is not. */}
        <DialogPrimitive.Viewport
          data-slot="dialog-viewport"
          className="fixed inset-0 z-[60] flex overflow-y-auto overscroll-contain p-4">
          <DialogPrimitive.Popup
            data-slot="dialog-popup"
            aria-modal="true"
            initialFocus={initialFocusRef}
            className={cn(
              "relative m-auto w-full rounded-[10px] border border-white/10 bg-surface-2 text-foreground shadow-xl outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none",
              SIZE[size] ?? SIZE.sm
            )}>
            <div className="px-5 pt-5 pr-14 pb-4">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogPrimitive.Description
                  data-slot="dialog-description"
                  className="mt-1.5 text-sm text-zinc-300">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {children}
            {/* Last in the document so that focus starts on the first thing a
                person can use, and still the first thing a touch screen reader
                can find to leave by. */}
            <DialogPrimitive.Close
              render={<IconButton label="Close" className="absolute top-2 right-2" />}>
              <XIcon aria-hidden="true" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { Dialog, DialogTitle, DialogBody, DialogFooter }
