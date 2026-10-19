import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { GaugeIcon, HardHatIcon, BellIcon } from 'lucide-react'
import { axe } from '@/test/axe'
import Sidebar from '../../components/shell/Sidebar'

// Brand looks for logo files over the network when it mounts; this test is about the
// navigation, so it gets a stand in that renders nothing.
vi.mock('@/components/brand/Brand', () => ({
  default: () => null,
  BrandMark: () => null,
}))

// The desktop sidebar, read the way a screen reader and a keyboard read it.

// axe tells an icon font from words by drawing a button's text on a canvas, when the button
// has a name of its own as well as words. jsdom has no canvas and says so on stderr; the check
// is skipped either way, so the canvas answers nothing, quietly.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SECTIONS = [
  { heading: 'Command', items: [{ id: 'command-center', label: 'Command Center', Icon: GaugeIcon }] },
  {
    heading: 'Field',
    items: [
      { id: 'jobs', label: 'Job Status', Icon: HardHatIcon, count: 4 },
      { id: 'notifications', label: 'Notifications', Icon: BellIcon },
    ],
  },
]
const TENANTS = [
  { id: 'p2-core', name: 'P2 Internal' },
  { id: 'qbs', name: 'QBS Builder Portal' },
]

const renderSidebar = (props = {}) =>
  render(
    <Sidebar
      sections={SECTIONS}
      activeId="jobs"
      onSelect={() => {}}
      onToggleCollapse={() => {}}
      tenants={TENANTS}
      tenantId="p2-core"
      onTenantChange={() => {}}
      role="owner"
      userLabel="P2 Field Services"
      onLogout={() => {}}
      onCreateUser={() => {}}
      {...props}
    />,
  )

const pages = () => within(screen.getByRole('navigation', { name: 'Workspace navigation' })).getAllByRole('button')

// A test marked it.fails is one this screen does not pass yet. The change that makes it pass
// takes the mark off, in the same commit.

describe('the sidebar', () => {
  it.fails('marks the page that is open, and no other, as the current page', () => {
    renderSidebar()

    const current = pages().filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Job Status')
  })

  it.fails('marks the current page while it is collapsed too, and keeps each name as a title', () => {
    renderSidebar({ collapsed: true })

    const current = pages().filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current.map((button) => button.getAttribute('title'))).toEqual(['Job Status'])
    expect(pages().map((button) => button.getAttribute('title'))).toEqual(['Command Center', 'Job Status', 'Notifications'])
  })

  it.fails('names the workspace list by its label', () => {
    renderSidebar()

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeTruthy()
  })

  it.fails('has no accessibility violations, open and collapsed', async () => {
    const { container, unmount } = renderSidebar()
    expect(await axe(container)).toHaveNoViolations()
    unmount()

    const collapsed = renderSidebar({ collapsed: true })
    expect(await axe(collapsed.container)).toHaveNoViolations()
  })
})
