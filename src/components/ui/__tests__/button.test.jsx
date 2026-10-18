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

  it('darkens a little on hover and draws a brand colored focus ring', () => {
    expect(classes).toContain('hover:bg-brand/90')
    expect(classes).toContain('focus-visible:ring-brand/40')
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
