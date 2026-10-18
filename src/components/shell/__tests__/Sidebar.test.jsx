import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Sidebar from '../Sidebar'

// Brand looks for logo files over the network when it mounts; this test is about
// the buttons, so it gets a stand in that renders nothing.
vi.mock('@/components/brand/Brand', () => ({
  default: () => null,
  BrandMark: () => null,
}))

afterEach(cleanup)

const renderSidebar = (props = {}) =>
  render(<Sidebar sections={[]} userLabel="P2 Field Services" onLogout={() => {}} {...props} />)

describe('Sidebar Manage users', () => {
  it('is shown to the owner and opens the create user dialog', () => {
    const onCreateUser = vi.fn()
    renderSidebar({ role: 'owner', onCreateUser })
    fireEvent.click(screen.getByRole('button', { name: /Manage users/ }))
    expect(onCreateUser).toHaveBeenCalledTimes(1)
  })

  it('is hidden from internal staff, because only an owner can create users', () => {
    renderSidebar({ role: 'internal', onCreateUser: vi.fn() })
    expect(screen.queryByRole('button', { name: /Manage users/ })).toBeNull()
  })

  it('is hidden from builders and clients', () => {
    for (const role of ['builder', 'client', undefined, null]) {
      renderSidebar({ role, onCreateUser: vi.fn() })
      expect(screen.queryByRole('button', { name: /Manage users/ })).toBeNull()
      cleanup()
    }
  })

  it('is hidden when there is nothing to open, even for the owner', () => {
    renderSidebar({ role: 'owner' })
    expect(screen.queryByRole('button', { name: /Manage users/ })).toBeNull()
  })

  it('is hidden while the sidebar is collapsed', () => {
    renderSidebar({ role: 'owner', onCreateUser: vi.fn(), collapsed: true })
    expect(screen.queryByRole('button', { name: /Manage users/ })).toBeNull()
  })

  it('still shows Sign out to everyone', () => {
    renderSidebar({ role: 'internal', onCreateUser: vi.fn() })
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeTruthy()
  })
})
