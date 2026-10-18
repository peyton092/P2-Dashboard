import { cn } from "@/lib/utils"
import { Button } from "./button"

// A button that is only an icon. The label is the only name it has, so it is
// required: a screen reader says it, and a mouse shows it as a tooltip. The hit
// area is 44 pixels square under 768 pixels, where it is touched, and 36 above.
function IconButton({ label, children, className, ...buttonProps }) {
  if (import.meta.env.DEV && !label) {
    throw new Error("IconButton needs a label, because the icon alone gives the button no name.")
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      {...buttonProps}
      aria-label={label}
      className={cn("min-h-11 min-w-11 md:min-h-9 md:min-w-9", className)}>
      {children}
    </Button>
  );
}

export { IconButton }
