import { Children, cloneElement, useId } from "react"

import { cn } from "@/lib/utils"

// A label, one control, and the hint and the error that belong to it. It does the
// wiring that a loose <label> and <p> leave undone: the label points at the control
// by id, the control points at the hint and the error with aria-describedby, and an
// error marks the control invalid. The one child is cloned to take the props, so it
// can be an Input, a Textarea or a plain element, as long as it passes id and the
// aria attributes on to the element a person types in.
//
// id is the control's id. It is made up when it is not given, so a label is never
// left loose.
function Field({ id, label, hint, error, required = false, className, children }) {
  const generated = useId()
  const fieldId = id ?? generated
  const control = Children.only(children)

  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [control.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ")

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-xs font-medium text-zinc-200">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-critical">*</span>}
      </label>
      {cloneElement(control, {
        id: fieldId,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : control.props["aria-invalid"],
        "aria-required": required ? true : control.props["aria-required"],
      })}
      {hint && <p id={hintId} className="text-xs text-neutral">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs text-critical">{error}</p>}
    </div>
  );
}

export { Field }
