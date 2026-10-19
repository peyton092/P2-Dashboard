import { describe, it, expect, vi, afterEach } from 'vitest'
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

afterEach(cleanup)

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

describe('the sidebar', () => {
  it('marks the page that is open, and no other, as the current page', () => {
    renderSidebar()

    const current = pages().filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Job Status')
  })

  it('marks the current page while it is collapsed too, and keeps each name as a title', () => {
    renderSidebar({ collapsed: true })

    const current = pages().filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current.map((button) => button.getAttribute('title'))).toEqual(['Job Status'])
    expect(pages().map((button) => button.getAttribute('title'))).toEqual(['Command Center', 'Job Status', 'Notifications'])
  })

  it('names the Search button by its words while they show, and by a label when collapsed', () => {
    renderSidebar()
    const search = screen.getByRole('button', { name: /^Search/ })
    expect(search.hasAttribute('aria-label')).toBe(false)
    expect(search.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K')
    cleanup()

    renderSidebar({ collapsed: true })
    expect(screen.getByRole('button', { name: 'Search' }).getAttribute('aria-label')).toBe('Search')
  })

  it('names the workspace list by its label', () => {
    renderSidebar()

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeTruthy()
  })

  it('has no accessibility violations, open and collapsed', async () => {
    const { container, unmount } = renderSidebar()
    expect(await axe(container)).toHaveNoViolations()
    unmount()

    const collapsed = renderSidebar({ collapsed: true })
    expect(await axe(collapsed.container)).toHaveNoViolations()
  })
})
