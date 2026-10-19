import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import {
  GaugeIcon, RadarIcon, DollarSignIcon, HardHatIcon, TriangleAlertIcon, BellIcon, SettingsIcon,
} from 'lucide-react'
import { axe } from '@/test/axe'
import { openSettled } from '@/test/dialog'
import MobileNav from '../../components/shell/MobileNav'

// The phone navigation: four pages on a bar at the bottom of the screen, and the rest in a
// drawer that the More button opens. Read the way a screen reader and a keyboard read it.

afterEach(cleanup)

const PRIMARY = [
  { id: 'command-center', label: 'Command', Icon: GaugeIcon },
  { id: 'war-room', label: 'War Room', Icon: RadarIcon },
  { id: 'billing-queue', label: 'Billing', Icon: DollarSignIcon, count: 3 },
  { id: 'jobs', label: 'Jobs', Icon: HardHatIcon },
]
const MORE = [
  { id: 'alerts', label: 'Alerts', Icon: TriangleAlertIcon, count: 2 },
  { id: 'notifications', label: 'Notifs', Icon: BellIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
]

// The bar as the app uses it, with the page it shows held in state.
function Nav({ start = 'jobs' }) {
  const [active, setActive] = useState(start)
  return <MobileNav primary={PRIMARY} more={MORE} activeId={active} onSelect={setActive} />
}

const bar = () => screen.getByRole('navigation', { name: 'Mobile navigation' })
const more = () => within(bar()).getByRole('button', { name: /^More/ })
const openDrawer = async () => {
  act(() => { more().focus() })
  fireEvent.click(more())
  return openSettled('More pages')
}

// A test marked it.fails is one this screen does not pass yet. The change that makes it pass
// takes the mark off, in the same commit.

describe('the mobile navigation bar', () => {
  it.fails('marks the page that is open, and no other, as the current page', () => {
    render(<Nav start="jobs" />)

    const current = within(bar()).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current.map((button) => button.textContent)).toEqual(['Jobs'])
  })

  it.fails('gives every button on the bar a target at least 44 pixels tall', () => {
    render(<Nav />)

    for (const button of within(bar()).getAllByRole('button')) {
      expect(button.classList.contains('min-h-11'), button.textContent).toBe(true)
    }
  })
})

describe('the More pages drawer', () => {
  it.fails('opens as a modal dialog named More pages, with focus inside it', async () => {
    render(<Nav />)

    const drawer = await openDrawer()

    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(drawer.contains(document.activeElement)).toBe(true)
  })

  it.fails('marks the page that is open as the current page in the drawer too', async () => {
    render(<Nav start="alerts" />)

    const drawer = await openDrawer()

    const current = within(drawer).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Alerts')
  })

  it.fails('gives every page in the drawer a target at least 44 pixels tall', async () => {
    render(<Nav />)

    const drawer = await openDrawer()

    for (const name of ['Alerts', 'Notifs', 'Settings']) {
      expect(within(drawer).getByRole('button', { name: new RegExp(`^${name}`) }).classList.contains('min-h-11'), name).toBe(true)
    }
  })

  it.fails('closes on Escape and gives focus back to the More button', async () => {
    render(<Nav />)
    const drawer = await openDrawer()

    fireEvent.keyDown(drawer, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(more()))
  })

  it.fails('goes to the page that is picked, and closes', async () => {
    render(<Nav />)
    const drawer = await openDrawer()

    fireEvent.click(within(drawer).getByRole('button', { name: /^Settings/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await openDrawer()
    const current = within(screen.getByRole('dialog')).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current.map((button) => button.textContent)).toEqual(['Settings'])
  })

  it.fails('has no accessibility violations while it is open', async () => {
    render(<Nav start="alerts" />)
    await openDrawer()

    expect(await axe(document.body)).toHaveNoViolations()
  })
})
