// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NoAccessScreen from '../NoAccessScreen'

afterEach(cleanup)

describe('NoAccessScreen', () => {
  it('shows the heading and the account email', () => {
    render(<NoAccessScreen email="new.user@example.com" onLogout={() => {}} />)
    expect(screen.getByText('No access yet')).toBeTruthy()
    expect(screen.getByText('new.user@example.com')).toBeTruthy()
  })

  it('calls onLogout when Sign out is clicked', () => {
    const onLogout = vi.fn()
    render(<NoAccessScreen email="a@b.co" onLogout={onLogout} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
