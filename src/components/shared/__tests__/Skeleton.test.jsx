import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PageSkeleton } from '../Skeleton'

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

    const page = container.firstElementChild
    expect(page.getAttribute('aria-busy')).toBe('true')
    expect(page.getAttribute('aria-label')).toBe('Loading')
    expect(container.querySelectorAll('.p2-skeleton').length).toBeGreaterThan(0)
  })
})
