import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'
import AppShell from '../AppShell'

afterEach(cleanup)

const classesOf = (el) => el.className.split(/\s+/).filter(Boolean)

describe('the AppShell content container', () => {
  const renderShell = () => {
    render(
      <AppShell sidebar={<nav>Sidebar</nav>} mobileNav={<div>Mobile</div>}>
        <p>Page</p>
      </AppShell>,
    )
    return classesOf(screen.getByText('Page').parentElement)
  }

  it('fills the width of the screen: no cap and no centering below 1800 pixels', () => {
    const classes = renderShell()

    const always = classes.filter((name) => !name.includes(':'))
    expect(always).toContain('w-full')
    expect(always).not.toContain('mx-auto')
    expect(always.filter((name) => name.startsWith('max-w-'))).toEqual([])
    expect(classes).not.toContain('max-w-[1400px]')
  })

  it('keeps the gutters: 16 pixels on a phone, 24 above 640 and 32 above 1024', () => {
    const classes = renderShell()
    for (const name of ['px-4', 'sm:px-6', 'lg:px-8']) expect(classes, name).toContain(name)
  })

  it('caps the content at 1760 pixels, centered, only above 1800 pixels', () => {
    const classes = renderShell()

    expect(classes).toContain('min-[1800px]:max-w-[1760px]')
    expect(classes).toContain('min-[1800px]:mx-auto')
    expect(classes.filter((name) => /max-w-/.test(name))).toEqual(['min-[1800px]:max-w-[1760px]'])
  })

  it('uses no 2xl utility for the cap, because 2xl starts at 1536 pixels and not 1800', () => {
    expect(renderShell().filter((name) => name.startsWith('2xl:'))).toEqual([])
  })
})

describe('the AppShell landmarks', () => {
  const renderShell = () =>
    render(
      <AppShell sidebar={<nav aria-label="Sidebar">Sidebar</nav>} mobileNav={<nav aria-label="Mobile navigation">Mobile</nav>}>
        <h1>Page</h1>
      </AppShell>,
    )

  it('holds the page in one main landmark', () => {
    renderShell()

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main').contains(screen.getByRole('heading', { name: 'Page' }))).toBe(true)
  })

  it('has no accessibility violations', async () => {
    const { container } = renderShell()
    expect(await axe(container)).toHaveNoViolations()
  })
})
