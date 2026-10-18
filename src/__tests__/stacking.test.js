import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Everything that floats above the page takes its z-index from one scale, declared
// once in src/index.css, and not from a number of its own. A list that opens from a
// control has to be above the dialog the control is in, and a toast above them all,
// and that is only true if the numbers are chosen in one place and in order.
//
// jsdom draws nothing, so what a test can pin is the scale, its order, and which
// files ask for which layer. The browser check is in the task 3 fix round report.

const src = resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(resolve(src, file), 'utf8')

const LAYERS = ['nav', 'dialog', 'popup', 'palette', 'toast']

const scale = Object.fromEntries(
  [...read('index.css').matchAll(/--z-([a-z]+):\s*(\d+)\s*;/g)].map(([, name, value]) => [name, Number(value)]),
)

describe('the stacking scale in index.css', () => {
  it('declares the five layers, and no other', () => {
    expect(Object.keys(scale)).toEqual(LAYERS)
  })

  it.each(LAYERS.slice(1).map((layer, i) => [layer, LAYERS[i]]))('puts %s above %s', (layer, below) => {
    expect(scale[layer], `${layer} is ${scale[layer]} and ${below} is ${scale[below]}`).toBeGreaterThan(scale[below])
  })

  it('has the values the plan gives', () => {
    expect(scale).toEqual({ nav: 50, dialog: 60, popup: 70, palette: 90, toast: 100 })
  })
})

describe('the files that float above the page', () => {
  const CONSUMERS = [
    ['components/shell/MobileNav.jsx', 'nav'],
    ['components/ui/dialog.jsx', 'dialog'],
    ['components/ui/select.jsx', 'popup'],
    ['components/CommandPalette.jsx', 'palette'],
    ['components/ui/toast.jsx', 'toast'],
  ]

  it.each(CONSUMERS)('%s takes the %s layer from the scale', (file, layer) => {
    expect(read(file)).toContain(`z-(--z-${layer})`)
  })

  it.each(CONSUMERS)('%s asks for no number of its own at or above the lowest layer', (file) => {
    expect(scale.nav, 'the scale is declared').toBeGreaterThan(0)
    const literals = [...read(file).matchAll(/(?<![\w-])z-(?:\[(\d+)\]|(\d+))(?![\w-])/g)]
      .map(([, bracketed, plain]) => Number(bracketed ?? plain))
    // Small numbers order a part inside a layer: a scroll arrow in a list, the backdrop
    // under the mobile bar.
    expect(literals.filter((n) => n >= scale.nav)).toEqual([])
  })
})
