import { act, fireEvent } from '@testing-library/react'

// jsdom has the keyboard events but not what a browser does with them, so these two do that
// part, the way a browser does it, and leave the rest to the page.

// What can take focus with Tab, in document order.
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Tab moves focus to the next element that takes it, or the previous one with Shift, past
// anything inert. Whatever keeps focus inside a dialog has to do it itself.
export function pressTab({ shift = false } = {}) {
  const stops = [...document.querySelectorAll(TABBABLE)].filter((el) => !el.closest('[inert]'))
  const at = stops.indexOf(document.activeElement)
  const next = stops[(at + (shift ? -1 : 1) + stops.length) % stops.length]
  act(() => { next.focus() })
}

// Space on a checkbox, a radio or a button presses it: the keydown, the keyup, and then the
// click that toggles the box or runs the button, unless a handler stopped the key.
export function pressSpace(el = document.activeElement) {
  const down = fireEvent.keyDown(el, { key: ' ', code: 'Space' })
  const up = fireEvent.keyUp(el, { key: ' ', code: 'Space' })
  const pressable = el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type))
  if (down && up && pressable) act(() => { el.click() })
}
