import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { pressTab } from '@/test/keyboard'

// The dialog an owner creates accounts in, open, read the way a screen reader and a
// keyboard read it. What it sends is covered in src/__tests__/CreateUserModal.test.jsx.
// Importing App.jsx pulls in the whole app, so everything that would reach Firebase is
// replaced.
vi.mock('../../firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(), getFunctions: vi.fn() }))

import { CreateUserModal } from '../../App'

afterEach(cleanup)

const NAME = 'Create User Account'

// The dialog over a page that has a control of its own, as it is in the app, so that focus
// has somewhere outside the dialog to go if the dialog does not keep it.
function openOverPage() {
  render(
    <>
      <button type="button">Manage users</button>
      <CreateUserModal onClose={() => {}} />
    </>,
  )
  return screen.findByRole('dialog', { name: NAME })
}
const focusIsInside = (dialog) => waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

describe('the create user dialog, open', () => {
  it('is a modal dialog whose title is a heading', async () => {
    const dialog = await openOverPage()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = screen.getByRole('heading', { name: NAME })
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
  })

  it('keeps Tab inside the dialog, from its last control round to its first', async () => {
    const dialog = await openOverPage()
    await focusIsInside(dialog)

    const inside = [...dialog.querySelectorAll('button, input, select, textarea')].filter((el) => !el.disabled)
    act(() => { inside.at(-1).focus() })
    pressTab()

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    // The page behind is hidden from a screen reader while the dialog is open.
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Manage users', hidden: true }))
  })

  it('keeps Shift and Tab inside the dialog, from its first control round to its last', async () => {
    const dialog = await openOverPage()
    await focusIsInside(dialog)

    const inside = [...dialog.querySelectorAll('button, input, select, textarea')].filter((el) => !el.disabled)
    act(() => { inside[0].focus() })
    pressTab({ shift: true })

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('has no accessibility violations, for each role it can create', async () => {
    const dialog = await openOverPage()
    await focusIsInside(dialog)
    expect(await axe(document.body)).toHaveNoViolations()

    for (const role of ['builder', 'client']) {
      fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
      expect(await axe(document.body), role).toHaveNoViolations()
    }
  })
})
