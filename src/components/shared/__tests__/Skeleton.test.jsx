import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'
import { PageSkeleton, Skeleton } from '../Skeleton'

afterEach(cleanup)

describe('PageSkeleton', () => {
  it('draws its figures as one strip with hairlines, as the stat band does, and not as separate tiles', () => {
    const { container } = render(<PageSkeleton tiles={5} rows={2} />)

    const grid = container.querySelector('.grid')
    expect(grid.children).toHaveLength(5)
    for (const cell of grid.children) {
      expect(cell.className).toMatch(/\bborder-l\b/)
      expect(cell.className).toMatch(/\bborder-t\b/)
      expect(cell.className).not.toMatch(/\brounded/)
    }
    const strip = grid.parentElement
    expect(strip.className).toMatch(/\brounded-\[10px\]/)
    expect(strip.className).toMatch(/\boverflow-hidden\b/)
  })

  it('lays the strip out the way the stat band does', () => {
    const { container } = render(<PageSkeleton tiles={5} rows={2} />)

    const grid = container.querySelector('.grid')
    for (const name of ['grid-cols-2', 'md:grid-cols-4', 'xl:grid-flow-col', 'xl:auto-cols-fr']) {
      expect(grid.classList.contains(name), name).toBe(true)
    }
  })

  it('stays hidden from a screen reader beyond its busy label', () => {
    const { container } = render(<PageSkeleton tiles={3} rows={1} />)

    // The page is one status region named Loading, which is busy.
    const page = screen.getByRole('status', { name: 'Loading' })
    expect(page).toBe(container.firstElementChild)
    expect(page.getAttribute('aria-busy')).toBe('true')

    // Every placeholder shape inside it is hidden, so a screen reader hears the one
    // label and not a row of empty boxes.
    const shapes = [...container.querySelectorAll('.p2-skeleton')]
    expect(shapes.length).toBeGreaterThan(0)
    for (const shape of shapes) expect(shape.getAttribute('aria-hidden')).toBe('true')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<PageSkeleton tiles={3} rows={2} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Skeleton', () => {
  it('hides itself from a screen reader', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)

    const shape = container.firstElementChild
    expect(shape.classList.contains('p2-skeleton')).toBe(true)
    expect(shape.getAttribute('aria-hidden')).toBe('true')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
