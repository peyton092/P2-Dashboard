import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PencilIcon } from 'lucide-react'
import { axe } from '@/test/axe'
import { IconButton } from '../icon-button'

afterEach(cleanup)

describe('IconButton', () => {
  it('renders a button named by its label', () => {
    render(<IconButton label="Edit change order"><PencilIcon aria-hidden="true" /></IconButton>)

    const button = screen.getByRole('button', { name: 'Edit change order' })
    expect(button.getAttribute('aria-label')).toBe('Edit change order')
  })

  it('is type button, so it never submits a form', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <IconButton label="Edit change order"><PencilIcon aria-hidden="true" /></IconButton>
      </form>,
    )

    const button = screen.getByRole('button', { name: 'Edit change order' })
    expect(button.getAttribute('type')).toBe('button')
    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('has a hit area of 44 pixels under 768 pixels and 36 pixels above', () => {
    render(<IconButton label="Edit change order"><PencilIcon aria-hidden="true" /></IconButton>)

    const classes = screen.getByRole('button').classList
    for (const name of ['min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-9']) {
      expect(classes.contains(name), name).toBe(true)
    }
  })

  it('passes its other props to the button', () => {
    const onClick = vi.fn()
    render(
      <IconButton label="Edit change order" onClick={onClick} className="extra" data-testid="edit">
        <PencilIcon aria-hidden="true" />
      </IconButton>,
    )

    const button = screen.getByTestId('edit')
    expect(button.classList.contains('extra')).toBe(true)
    expect(button.classList.contains('min-h-11')).toBe(true)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire while it is disabled', () => {
    const onClick = vi.fn()
    render(<IconButton label="Edit change order" disabled onClick={onClick}><PencilIcon aria-hidden="true" /></IconButton>)

    fireEvent.click(screen.getByRole('button', { name: 'Edit change order' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows its label as a tooltip to a mouse', () => {
    render(<IconButton label="Edit change order"><PencilIcon aria-hidden="true" /></IconButton>)
    expect(screen.getByRole('button').getAttribute('title')).toBe('Edit change order')
  })

  it('refuses to render without a label in development, because it would have no name', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(import.meta.env.DEV).toBe(true)
      expect(() => render(<IconButton><PencilIcon aria-hidden="true" /></IconButton>)).toThrow(/label/i)
      expect(() => render(<IconButton label=""><PencilIcon aria-hidden="true" /></IconButton>)).toThrow(/label/i)
    } finally {
      quiet.mockRestore()
    }
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<IconButton label="Edit change order"><PencilIcon aria-hidden="true" /></IconButton>)
    expect(await axe(container)).toHaveNoViolations()
  })
})
