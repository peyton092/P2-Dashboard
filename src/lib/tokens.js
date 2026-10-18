// Design tokens for scripts and inline styles. src/index.css declares the same
// colors and font families as CSS custom properties, which Tailwind turns into
// utilities (bg-brand, text-success, font-display), and
// src/__tests__/tokens.test.js fails when the two disagree.
//
// The rule is that a color is written here or in index.css and nowhere else. It
// is the direction of travel and not yet the state of the code: screens still
// hold some colors of their own. src/__tests__/hex-literals.test.js counts them
// against a budget that every task lowers when it touches a file, until the
// budget reaches zero and the rule holds without exception.

// The brand orange. Reserved for navigation state, primary actions, the brand
// mark and the focus ring.
export const BRAND = '#F47920'

// Colors that carry status and nothing else.
export const SEMANTIC = {
  success:  '#22c55e',
  warning:  '#eab308',
  critical: '#ef4444',
  info:     '#3b82f6',
  cyan:     '#06b6d4',
  neutral:  '#9ca3af',
  mute:     '#6b7280',
}

// Every tone by name, for components that take a tone prop.
export const TONE_HEX = { brand: BRAND, ...SEMANTIC }

// Font family lists. Display is for page titles and numerals, body for text,
// mono for job ids, permit numbers, invoice numbers, amounts and timestamps.
export const FONT = {
  display: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  body:    "'Geist Variable', sans-serif",
  mono:    "'Geist Mono Variable', ui-monospace, monospace",
}

const HEX = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i

// Red, green and blue as numbers from 0 to 255, or null when the value is not
// a three or six digit hex color.
function channels(hex) {
  const match = typeof hex === 'string' ? HEX.exec(hex) : null
  if (!match) return null
  const digits = match[1] ? [...match[1]].map((digit) => digit + digit).join('') : match[2]
  return [0, 2, 4].map((start) => parseInt(digits.slice(start, start + 2), 16))
}

// For jsPDF, which takes numbers: hexToRgb(BRAND) is [244, 121, 32]. Anything
// that is not a hex color throws, because a PDF with a guessed color is worse
// than a PDF that fails loudly where the constant is declared.
export function hexToRgb(hex) {
  const rgb = channels(hex)
  if (!rgb) throw new TypeError(`Not a hex color: ${String(hex)}`)
  return rgb
}

// A hex color at an alpha from 0 to 1, as an rgba() string. It replaces the
// old habit of gluing two hex digits onto the end of a color. Anything that is
// not a hex color gives undefined, so React leaves the style out, which is what
// the browser did with the invalid string the old concatenation built.
export function withAlpha(hex, alpha) {
  const rgb = channels(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : undefined
}
