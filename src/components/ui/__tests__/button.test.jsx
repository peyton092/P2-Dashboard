import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Button } from '../button'
import { buttonVariants } from '../button-variants'

afterEach(cleanup)

// White on the brand orange is 2.76 to 1, under the 4.5 to 1 that text this small
// needs, so a brand button sets its text in the near black brand foreground.
describe('the brand variant', () => {
  const classes = buttonVariants({ variant: 'brand' }).split(/\s+/)

  it('fills with the brand color and sets its text in the brand foreground', () => {
    expect(classes).toContain('bg-brand')
    expect(classes).toContain('text-brand-foreground')
  })

  it('never sets its text in white', () => {
    expect(classes).not.toContain('text-white')
    expect(classes.filter((name) => /(^|:)text-white/.test(name))).toEqual([])
  })

  it('darkens a little on hover', () => {
    expect(classes).toContain('hover:bg-brand/90')
  })

  it('is what a Button renders for variant brand', () => {
    render(<Button variant="brand">Save job</Button>)
    const button = screen.getByRole('button', { name: 'Save job' })
    expect(button.className).toContain('bg-brand')
    expect(button.className).toContain('text-brand-foreground')
    expect(button.className).not.toContain('text-white')
  })

  it('leaves the default variant as it was', () => {
    const base = buttonVariants({ variant: 'default' })
    expect(base).toContain('bg-primary')
    expect(base).toContain('text-primary-foreground')
    expect(base).not.toContain('bg-brand')
  })
})

// Keyboard focus is the one brand ring of the stylesheet (src/index.css), 2 pixels with a
// 2 pixel offset. A button that drew a ring of its own as well showed two, and one that said
// outline-none would hide the brand ring now that the rule is in the base layer.
describe('the focus ring of a button', () => {
  const VARIANTS = ['default', 'brand', 'outline', 'secondary', 'ghost', 'destructive', 'link']

  it.each(VARIANTS)('is the one brand ring for the %s variant, with no ring of its own beside it', (variant) => {
    const classes = buttonVariants({ variant }).split(/\s+/)
    expect(classes.filter((name) => /(^|:)focus(-visible)?:/.test(name))).toEqual([])
  })

  it.each(VARIANTS)('does not turn the outline off for the %s variant', (variant) => {
    const classes = buttonVariants({ variant }).split(/\s+/)
    expect(classes.filter((name) => /(^|:)outline-(none|hidden)$/.test(name))).toEqual([])
  })

  it('is a button that does not submit a form unless it is told to', () => {
    render(
      <form>
        <Button>Save job</Button>
        <Button type="submit">Send</Button>
      </form>,
    )
    expect(screen.getByRole('button', { name: 'Save job' }).getAttribute('type')).toBe('button')
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('type')).toBe('submit')
  })
})
