import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act, fireEvent, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/toast'
import { axe } from '@/test/axe'
import { initialFocusLanded } from '@/test/dialog'

// The bar above the demo: what it says, the role switcher, and Reset sample data,
// which asks first. The session and the store are stood in for, so this is the banner
// alone. How it sits above the app is checked in a real browser (see the task report).

const session = vi.hoisted(() => {
  const subscribers = new Set()
  const state = { role: 'owner' }
  return {
    state,
    subscribers,
    emit(change) {
      state.role = change.role
      for (const subscriber of [...subscribers]) subscriber(change)
    },
  }
})

vi.mock('../demoSession', () => ({
  currentDemoRole: () => session.state.role,
  onDemoRoleChange: (subscriber) => {
    session.subscribers.add(subscriber)
    return () => session.subscribers.delete(subscriber)
  },
  switchDemoRole: vi.fn((role) => session.emit({ role, reason: 'switch' })),
}))

vi.mock('../firebase', () => ({ resetDemoState: vi.fn() }))

import DemoBanner from '../DemoBanner'
import { switchDemoRole } from '../demoSession'
import { resetDemoState } from '../firebase'

const renderBanner = () => render(<ToastProvider><DemoBanner /></ToastProvider>)

beforeEach(() => {
  session.state.role = 'owner'
  vi.mocked(switchDemoRole).mockClear()
  vi.mocked(resetDemoState).mockClear()
})

describe('the demo banner', () => {
  it('is a region named Demo controls that says what the demo is', () => {
    renderBanner()
    const region = screen.getByRole('region', { name: 'Demo controls' })
    expect(region.textContent).toContain("Demo preview with sample data. Nothing here is saved to P2's systems.")
  })

  it('offers Owner, Builder and Client, with the current one pressed', () => {
    renderBanner()
    const region = screen.getByRole('region', { name: 'Demo controls' })
    const buttons = ['Owner', 'Builder', 'Client'].map((name) => within(region).getByRole('button', { name }))
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    for (const button of buttons) expect(button.className).toContain('min-h-11')
  })

  it('switches the role, and shows the new one pressed', () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Builder' }))
    expect(switchDemoRole).toHaveBeenCalledWith('builder')
    expect(screen.getByRole('button', { name: 'Builder' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Owner' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('follows a role changed elsewhere, as when signing out brings the owner back, and says why', async () => {
    session.state.role = 'client'
    renderBanner()
    expect(screen.getByRole('button', { name: 'Client' }).getAttribute('aria-pressed')).toBe('true')
    act(() => session.emit({ role: 'owner', reason: 'sign-out' }))
    expect(screen.getByRole('button', { name: 'Owner' }).getAttribute('aria-pressed')).toBe('true')
    // The toast shows the words, and its live region says them.
    expect((await screen.findAllByText('There is no signing out of the demo, so it shows the owner again.')).length).toBeGreaterThan(0)
  })

  it('asks before it resets the sample data, and does nothing on Cancel', async () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset the sample data?' })
    await initialFocusLanded()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(resetDemoState).not.toHaveBeenCalled()
  })

  it('resets the sample data once it is confirmed, and says so', async () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset the sample data?' })
    await initialFocusLanded()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    expect((await screen.findAllByText('The sample data is back to how it started.')).length).toBeGreaterThan(0)
    expect(resetDemoState).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('marks the page while it is shown, so the shell gives up its height, and unmarks it when it goes', () => {
    const { unmount } = renderBanner()
    const root = document.documentElement
    expect(root.hasAttribute('data-demo-banner')).toBe(true)
    expect(root.style.getPropertyValue('--demo-banner-height')).toMatch(/^\d+(\.\d+)?px$/)
    unmount()
    expect(root.hasAttribute('data-demo-banner')).toBe(false)
    expect(root.style.getPropertyValue('--demo-banner-height')).toBe('')
  })

  it('has no accessibility violations', async () => {
    const { container } = renderBanner()
    expect(await axe(container)).toHaveNoViolations()
  })
})
