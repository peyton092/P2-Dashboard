import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { pressTab } from '@/test/keyboard'
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

// A person on a keyboard reaches the page past the whole sidebar with one link, the first
// thing Tab finds. It is hidden until it has focus, and then it shows. It goes to the main
// landmark, which can take focus from it but is not a stop of its own in the tab order.
describe('the skip link', () => {
  const renderShell = () =>
    render(
      <AppShell sidebar={<nav aria-label="Sidebar"><button type="button">Command Center</button></nav>} mobileNav={null}>
        <h1>Page</h1>
        <button type="button">Export</button>
      </AppShell>,
    )
  const skip = () => screen.getByRole('link', { name: 'Skip to content' })

  it('is the first thing Tab reaches, ahead of the sidebar', () => {
    renderShell()
    act(() => { document.body.focus() })
    pressTab()
    expect(document.activeElement).toBe(skip())
  })

  it('goes to the main landmark, which takes focus but is not a tab stop', () => {
    renderShell()
    const main = screen.getByRole('main')
    expect(skip().getAttribute('href')).toBe(`#${main.id}`)
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('is hidden until it has focus, and then shows', () => {
    renderShell()
    const classes = [...skip().classList]
    expect(classes).toContain('sr-only')
    expect(classes).toContain('focus:not-sr-only')
  })

  // The main landmark takes focus only from the skip link, as a place to start from, and is
  // not a control, so it draws no ring around the whole page.
  it('does not draw the focus ring around the whole page when the link takes focus there', () => {
    renderShell()
    expect([...screen.getByRole('main').classList]).toContain('outline-none')
  })

  it('has no accessibility violations with the link focused', async () => {
    const { container } = renderShell()
    act(() => { skip().focus() })
    expect(await axe(container)).toHaveNoViolations()
  })
})
