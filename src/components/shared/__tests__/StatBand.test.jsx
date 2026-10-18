import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { axe } from '@/test/axe'
import { StatBand } from '../StatBand'

afterEach(cleanup)

const FIVE = [
  { label: 'Active jobs', value: 12, sub: '20 on roster' },
  { label: 'Completed', value: 8, sub: 'Lifetime closeouts', tone: 'success' },
  { label: 'At risk jobs', value: 3, sub: 'Warning and critical', tone: 'critical' },
  { label: 'Needs action', value: 5, sub: 'Failed inspection or open', tone: 'warning', note: 'Two are waiting on the builder' },
  { label: 'Blocked or stale', value: 0, sub: 'No blockers', tone: 'mute' },
]

const cells = (container) => [...container.querySelectorAll('[data-slot="stat"]')]
const valueOf = (label) => within(screen.getByText(label).closest('[data-slot="stat"]'))

describe('StatBand', () => {
  it('shows each stat as a label, a value, and the lines under it', () => {
    render(<StatBand stats={FIVE} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const needs = within(screen.getByText('Needs action').closest('li'))
    expect(needs.getByText('5')).toBeTruthy()
    expect(needs.getByText('Failed inspection or open')).toBeTruthy()
    expect(needs.getByText('Two are waiting on the builder')).toBeTruthy()
  })

  it('is a list that says so, because VoiceOver drops the list of a list with no bullets', () => {
    const { container } = render(<StatBand stats={FIVE} />)
    expect(container.querySelector('ul').getAttribute('role')).toBe('list')
  })

  it('leaves out the sub and the note when a stat has none', () => {
    render(<StatBand stats={[{ label: 'Active jobs', value: 12 }]} />)

    const cell = screen.getByText('Active jobs').closest('li')
    expect(cell.querySelectorAll('span')).toHaveLength(2)
  })

  it('shows a value of zero', () => {
    render(<StatBand stats={[{ label: 'Blocked', value: 0 }]} />)
    expect(valueOf('Blocked').getByText('0')).toBeTruthy()
  })

  it('names the strip when it is given a name', () => {
    render(<StatBand stats={FIVE} aria-label="Portfolio status" />)
    expect(screen.getByRole('region', { name: 'Portfolio status' })).toBeTruthy()
  })

  it('sets the label in 11 pixel capitals and the value in the display face at 32 pixels', () => {
    render(<StatBand stats={FIVE} />)

    const label = screen.getByText('Active jobs')
    for (const name of ['text-[11px]', 'uppercase']) expect(label.classList.contains(name), name).toBe(true)
    const value = screen.getByText('12')
    for (const name of ['font-display', 'text-[32px]', 'tabular-nums']) expect(value.classList.contains(name), name).toBe(true)
  })

  it('colors the value by its tone and leaves a stat with no tone in the text color', () => {
    render(<StatBand stats={FIVE} />)

    expect(screen.getByText('8').classList.contains('text-success')).toBe(true)
    expect(screen.getByText('3').classList.contains('text-critical')).toBe(true)
    expect(screen.getByText('5').classList.contains('text-warning')).toBe(true)
    expect(screen.getByText('0').classList.contains('text-mute')).toBe(true)
    expect(screen.getByText('12').classList.contains('text-foreground')).toBe(true)
  })

  it.each(['brand', 'success', 'warning', 'critical', 'info', 'cyan', 'neutral', 'mute'])(
    'knows the %s tone',
    (tone) => {
      render(<StatBand stats={[{ label: 'Stat', value: 7, tone }]} />)
      expect(screen.getByText('7').classList.contains(`text-${tone}`)).toBe(true)
    },
  )

  it.each(['purple', 'constructor', 'toString', '', null])('reads the tone %j as no tone', (tone) => {
    render(<StatBand stats={[{ label: 'Stat', value: 7, tone }]} />)
    expect(screen.getByText('7').className).toMatch(/\btext-foreground\b/)
  })

  it('keeps small text out of the dim mute color: the lines under a value are neutral', () => {
    render(<StatBand stats={FIVE} />)

    for (const text of ['20 on roster', 'Two are waiting on the builder', 'Active jobs']) {
      const el = screen.getByText(text)
      expect(el.classList.contains('text-neutral'), text).toBe(true)
      expect(el.classList.contains('text-mute'), text).toBe(false)
    }
  })

  it('is one strip: a single rounded frame, with hairlines and no rounded tile for any stat', () => {
    const { container } = render(<StatBand stats={FIVE} />)

    const band = container.firstElementChild
    expect(band.className).toMatch(/\brounded-/)
    // The frame clips the hairlines on its outer edge, which sit one pixel out.
    expect(band.classList.contains('overflow-hidden')).toBe(true)
    for (const name of ['-mt-px', '-ml-px']) expect(container.querySelector('ul').classList.contains(name), name).toBe(true)
    for (const cell of cells(container)) {
      expect(cell.className, 'the cell').not.toMatch(/\brounded/)
      expect(cell.className, 'the cell').toMatch(/\bborder-l\b/)
      expect(cell.className, 'the cell').toMatch(/\bborder-t\b/)
      expect(cell.querySelector('[class*="rounded"]'), 'inside the cell').toBeNull()
    }
  })

  it('lays the cells out two across on a phone, four on a tablet and in one row on a desktop', () => {
    const { container } = render(<StatBand stats={FIVE} />)

    const grid = container.querySelector('ul')
    for (const name of ['grid', 'grid-cols-2', 'md:grid-cols-4', 'xl:grid-flow-col', 'xl:auto-cols-fr']) {
      expect(grid.classList.contains(name), name).toBe(true)
    }
  })

  it('gives a desktop row of three or four stats equal cells with no empty column', () => {
    const { container } = render(<StatBand stats={FIVE.slice(0, 3)} />)

    const grid = container.querySelector('ul')
    expect(grid.classList.contains('md:grid-cols-3')).toBe(true)
    expect(grid.classList.contains('md:grid-cols-4')).toBe(false)
    expect(grid.classList.contains('xl:grid-cols-none')).toBe(true)
  })

  it('lets the odd stat out fill the last row of a phone, and a lone fifth fill the last row of a tablet', () => {
    const { container } = render(<StatBand stats={FIVE} />)

    const last = cells(container).at(-1)
    expect(last.classList.contains('col-span-2')).toBe(true)
    expect(last.classList.contains('md:col-span-4')).toBe(true)
    expect(last.classList.contains('xl:col-span-1')).toBe(true)
    for (const cell of cells(container).slice(0, -1)) expect(cell.className).not.toMatch(/col-span/)
  })

  it('spans nothing when the stats fill their rows', () => {
    const { container } = render(<StatBand stats={FIVE.slice(0, 4)} />)
    for (const cell of cells(container)) expect(cell.className).not.toMatch(/col-span/)
  })

  it('draws a stat with no click handler as plain text, not a button', () => {
    render(<StatBand stats={FIVE} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws a stat with a click handler as a button that spans its cell', () => {
    const onClick = vi.fn()
    render(<StatBand stats={[{ label: 'Needs action', value: 5, sub: 'Open the list', onClick }, { label: 'Other', value: 1 }]} />)

    const button = screen.getByRole('button', { name: /Needs action/ })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.closest('li')).toBe(screen.getByText('Needs action').closest('li'))
    for (const name of ['block', 'w-full', 'h-full']) expect(button.classList.contains(name), name).toBe(true)
    expect(screen.getAllByRole('button')).toHaveLength(1)

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('names a button by its label, its value and the line under it', () => {
    render(<StatBand stats={[{ label: 'Needs action', value: 5, sub: 'Open the list', onClick: () => {} }]} />)
    expect(screen.getByRole('button', { name: 'Needs action 5 Open the list' })).toBeTruthy()
  })

  it('shows a clickable stat\'s focus ring inside its cell, where the strip cannot clip it', () => {
    render(<StatBand stats={[{ label: 'Needs action', value: 5, onClick: () => {} }]} />)
    expect(screen.getByRole('button').classList.contains('focus-visible:-outline-offset-2')).toBe(true)
  })

  it('puts nothing a button cannot hold inside a button', () => {
    render(<StatBand stats={[{ label: 'Needs action', value: 5, sub: 'Open', note: 'Note', onClick: () => {} }]} />)
    expect(screen.getByRole('button').querySelectorAll('p, div, ul, h1, h2, h3, h4')).toHaveLength(0)
  })

  it('has no accessibility violations, with and without buttons', async () => {
    const { container } = render(
      <>
        <StatBand stats={FIVE} aria-label="Portfolio status" />
        <StatBand stats={FIVE.map((stat) => ({ ...stat, onClick: () => {} }))} aria-label="Clickable status" />
      </>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
