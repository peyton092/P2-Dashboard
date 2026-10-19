import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'
import NoAccessScreen from '../../components/NoAccessScreen'

// The screen a signed in person sees when their account has no role yet, read the way a
// screen reader and a keyboard read it.

afterEach(cleanup)

// A test marked it.fails is one this screen does not pass yet. The change that makes it pass
// takes the mark off, in the same commit.

describe('the no access screen', () => {
  it.fails('is the main content of the page, under one level one heading', () => {
    render(<NoAccessScreen email="new.user@example.com" onLogout={() => {}} />)

    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['No access yet'])
  })

  it('signs out from a button the keyboard reaches', () => {
    const onLogout = vi.fn()
    render(<NoAccessScreen email="new.user@example.com" onLogout={onLogout} />)

    const button = screen.getByRole('button', { name: 'Sign out' })
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<NoAccessScreen email="new.user@example.com" onLogout={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
