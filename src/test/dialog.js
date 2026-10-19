import { expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

// Base UI puts focus inside a dialog on the next animation frame after it mounts, and not
// when it mounts, so the dialog is on the screen before focus is in it. A test that moves
// focus itself, presses a button in the dialog, opens a list from it or runs axe over it
// waits for that first. If it does not, the frame arrives later on a slow machine and lands
// on top of what the test did. A red CI run in Task 3 came from that.

// Waits for focus to be inside the dialog with this name, which has just been opened, and
// gives the dialog back.
export async function openSettled(name) {
  const dialog = await screen.findByRole('dialog', { name })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
}

// Waits for focus to be on Cancel, where a ConfirmDialog puts it, so that Enter does not
// confirm by accident.
export const initialFocusLanded = () =>
  waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
