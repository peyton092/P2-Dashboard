import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useRef, useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { Dialog, DialogBody, DialogFooter } from '../dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'

afterEach(cleanup)

// jsdom has no Tab key. This does what a browser does with one: it moves focus to
// the next tabbable element in document order, or the previous one with shift, and
// leaves the rest to the page. Whatever keeps focus inside the dialog has to do it.
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
function pressTab({ shift = false } = {}) {
  const stops = [...document.querySelectorAll(TABBABLE)].filter((el) => !el.closest('[inert]'))
  const at = stops.indexOf(document.activeElement)
  const next = stops[(at + (shift ? -1 : 1) + stops.length) % stops.length]
  act(() => { next.focus() })
}

// A click as a mouse sends it, which is how a click on the scrim reaches the dialog.
function press(el) {
  fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(el, { button: 0 })
  fireEvent.pointerUp(el, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(el, { button: 0 })
  fireEvent.click(el, { button: 0 })
}

// jsdom has no layout, so it cannot say which of two layers is on top. What an element
// asks for can be read: a class such as z-(--z-popup), whose number is the scale in
// src/index.css, or a number written out. The browser check of the real stacking is in
// the task 3 fix round report.
const scale = Object.fromEntries(
  [...readFileSync(resolve(import.meta.dirname, '../../../index.css'), 'utf8').matchAll(/--z-([a-z]+):\s*(\d+)\s*;/g)]
    .map(([, name, value]) => [name, Number(value)]),
)
const layerOf = (el) => {
  for (const name of el.classList) {
    const fromScale = /^z-\(--z-([a-z]+)\)$/.exec(name)
    if (fromScale) return scale[fromScale[1]] ?? null
    const written = /^z-(?:\[(\d+)\]|(\d+))$/.exec(name)
    if (written) return Number(written[1] ?? written[2])
  }
  return null
}
// The highest layer that an element or any element around it asks for.
const highestLayerAround = (el) => {
  let top = null
  for (let node = el; node; node = node.parentElement) {
    const layer = layerOf(node)
    if (layer != null && (top == null || layer > top)) top = layer
  }
  return top
}

// A page with an opener, the way a screen uses the dialog.
function Page({ onClose = () => {}, children, ...props }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Edit job</button>
      <Dialog
        open={open}
        onClose={() => { onClose(); setOpen(false) }}
        title="Edit job details"
        {...props}
      >
        {children ?? (
          <>
            <DialogBody>
              <label>
                Job name
                <input defaultValue="QBS 003" />
              </label>
            </DialogBody>
            <DialogFooter>
              <button type="button">Discard</button>
              <button type="button">Save job</button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </>
  )
}

const opener = () => screen.getByRole('button', { name: 'Edit job' })
// Focus the opener, as a keyboard user arrives at it, and open the dialog.
const openIt = async () => {
  act(() => { opener().focus() })
  fireEvent.click(opener())
  return screen.findByRole('dialog')
}
const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
const focusIsInside = (dialog) => waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

describe('Dialog', () => {
  it('renders nothing while it is closed', () => {
    render(<Page />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a modal dialog named by its title', async () => {
    render(<Page />)
    const dialog = await openIt()

    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = screen.getByRole('heading', { name: 'Edit job details' })
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(screen.getByRole('dialog', { name: 'Edit job details' })).toBe(dialog)
  })

  it('describes itself with the description, when it has one', async () => {
    render(<Page description="Changes save to the job record." />)
    const dialog = await openIt()

    const description = screen.getByText('Changes save to the job record.')
    expect(dialog.getAttribute('aria-describedby')).toBe(description.id)
  })

  it('has nothing to be described by when it has no description', async () => {
    render(<Page />)
    const dialog = await openIt()
    expect(dialog.hasAttribute('aria-describedby')).toBe(false)
  })

  it('moves focus inside when it opens', async () => {
    render(<Page />)
    const dialog = await openIt()
    await focusIsInside(dialog)
  })

  it('moves focus to the element initialFocusRef names', async () => {
    function WithInitialFocus() {
      const reason = useRef(null)
      return (
        <Page initialFocusRef={reason}>
          <DialogBody>
            <input aria-label="First field" />
            <input ref={reason} aria-label="Reason" />
          </DialogBody>
        </Page>
      )
    }
    render(<WithInitialFocus />)
    await openIt()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Reason')))
  })

  it('calls onClose when Escape is pressed, and goes when the page closes it', async () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    const dialog = await openIt()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    await gone()
  })

  it('calls onClose when the scrim is clicked', async () => {
    const onClose = vi.fn()
    const { baseElement } = render(<Page onClose={onClose} />)
    await openIt()

    press(baseElement.querySelector('[data-slot="dialog-scrim"]'))

    expect(onClose).toHaveBeenCalledTimes(1)
    await gone()
  })

  it('calls onClose when the space around the panel is clicked', async () => {
    const onClose = vi.fn()
    const { baseElement } = render(<Page onClose={onClose} />)
    await openIt()

    press(baseElement.querySelector('[data-slot="dialog-viewport"]'))

    expect(onClose).toHaveBeenCalledTimes(1)
    await gone()
  })

  it('stays open when the panel itself is clicked', async () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    const dialog = await openIt()

    press(screen.getByRole('heading', { name: 'Edit job details' }))
    press(dialog)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBe(dialog)
  })

  it('has a named close button, last in the tab order, that calls onClose', async () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    const dialog = await openIt()

    const close = screen.getByRole('button', { name: 'Close' })
    expect([...dialog.querySelectorAll('button')].at(-1)).toBe(close)

    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    await gone()
  })

  it('wraps focus from the last element to the first when Tab is pressed', async () => {
    render(<Page />)
    const dialog = await openIt()
    await focusIsInside(dialog)

    const inside = [...dialog.querySelectorAll(TABBABLE)]
    const first = inside[0]
    const last = inside.at(-1)
    expect(first.tagName).toBe('INPUT')
    expect(last.getAttribute('aria-label')).toBe('Close')

    act(() => { last.focus() })
    pressTab()

    await waitFor(() => expect(document.activeElement).toBe(first))
  })

  it('wraps focus from the first element to the last when Shift and Tab are pressed', async () => {
    render(<Page />)
    const dialog = await openIt()
    await focusIsInside(dialog)

    const inside = [...dialog.querySelectorAll(TABBABLE)]
    act(() => { inside[0].focus() })
    pressTab({ shift: true })

    await waitFor(() => expect(document.activeElement).toBe(inside.at(-1)))
  })

  it('returns focus to the opener when it closes', async () => {
    render(<Page />)
    const dialog = await openIt()
    await focusIsInside(dialog)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await gone()

    await waitFor(() => expect(document.activeElement).toBe(opener()))
  })

  it('has no accessibility violations while it is open', async () => {
    render(<Page description="Changes save to the job record." />)
    await openIt()

    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('draws a black scrim at 70 percent and a panel in the design system colors', async () => {
    const { baseElement } = render(<Page />)
    const dialog = await openIt()

    const scrim = baseElement.querySelector('[data-slot="dialog-scrim"]')
    expect(scrim.classList.contains('bg-black/70')).toBe(true)
    for (const name of ['bg-surface-2', 'border', 'border-white/10', 'rounded-[10px]']) {
      expect(dialog.classList.contains(name), name).toBe(true)
    }
  })

  it.each([
    ['sm', 'max-w-sm'],
    ['md', 'max-w-lg'],
    ['lg', 'max-w-2xl'],
  ])('is no wider than %s allows (%s)', async (size, width) => {
    render(<Page size={size} />)
    const dialog = await openIt()
    expect(dialog.classList.contains(width)).toBe(true)
  })

  it('is small unless it is told a size', async () => {
    render(<Page />)
    const dialog = await openIt()
    expect(dialog.classList.contains('max-w-sm')).toBe(true)
  })
})

describe('a Select inside a dialog', () => {
  // A controlled select with a readout of what was picked, as a form in a dialog has.
  const TradeSelect = () => {
    const [trade, setTrade] = useState('electrical')
    return (
      <>
        <span id="trade-label">Trade</span>
        <Select value={trade} onValueChange={setTrade}>
          <SelectTrigger aria-labelledby="trade-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="electrical">Electrical</SelectItem>
            <SelectItem value="hvac">HVAC</SelectItem>
          </SelectContent>
        </Select>
        <p data-testid="picked">{trade}</p>
      </>
    )
  }

  // Base UI draws a list that opens from inside a dialog into the dialog's own portal,
  // after the viewport, so the list is only seen if its layer is above the viewport's.
  it('opens its list in a layer above the dialog, so the list is not hidden under the panel', async () => {
    const { baseElement } = render(
      <Page>
        <DialogBody><TradeSelect /></DialogBody>
      </Page>,
    )
    await openIt()

    fireEvent.click(screen.getByRole('combobox', { name: 'Trade' }))
    const list = await screen.findByRole('listbox')

    const scrim = baseElement.querySelector('[data-slot="dialog-scrim"]')
    const viewport = baseElement.querySelector('[data-slot="dialog-viewport"]')
    expect(layerOf(scrim), 'the scrim').toBe(layerOf(viewport))
    expect(highestLayerAround(list), 'the list is in a layer above the dialog').toBeGreaterThan(layerOf(viewport))
  })

  it('takes a pick, and the dialog stays open', async () => {
    const onClose = vi.fn()
    render(
      <Page onClose={onClose}>
        <DialogBody><TradeSelect /></DialogBody>
      </Page>,
    )
    const dialog = await openIt()

    fireEvent.click(screen.getByRole('combobox', { name: 'Trade' }))
    const option = await screen.findByRole('option', { name: 'HVAC' })
    await act(async () => { fireEvent.mouseMove(option) })
    await act(async () => { fireEvent.click(option) })

    await waitFor(() => expect(screen.getByTestId('picked').textContent).toBe('hvac'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBe(dialog)
  })
})

describe('the parts of a dialog', () => {
  it('DialogBody and DialogFooter pass a class name and their children through', async () => {
    render(
      <Page>
        <DialogBody className="body-extra">Body text</DialogBody>
        <DialogFooter className="footer-extra"><button type="button">Done</button></DialogFooter>
      </Page>,
    )
    await openIt()

    expect(screen.getByText('Body text').classList.contains('body-extra')).toBe(true)
    expect(screen.getByRole('button', { name: 'Done' }).parentElement.classList.contains('footer-extra')).toBe(true)
  })

  it('DialogFooter makes every button in it at least 44 pixels tall under 768 pixels', async () => {
    render(<Page />)
    await openIt()

    // The rule is on the footer, so a button that a screen puts there does not have to ask.
    const footer = screen.getByRole('button', { name: 'Save job' }).parentElement
    expect(footer.getAttribute('data-slot')).toBe('dialog-footer')
    expect(footer.classList.contains('max-md:[&>button]:min-h-11')).toBe(true)
  })

  it('DialogTitle sets the title in the display face', async () => {
    render(<Page />)
    await openIt()

    const title = screen.getByRole('heading', { name: 'Edit job details' })
    expect(title.tagName).toBe('H2')
    expect(title.classList.contains('font-display')).toBe(true)
  })
})
