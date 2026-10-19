import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'

// The sign in screen, read the way a screen reader and a keyboard read it. Importing App.jsx
// pulls in the whole app, so everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  sendReset: vi.fn(),
}))

vi.mock('../../firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  signInWithEmailAndPassword: mocks.signIn,
  sendPasswordResetEmail: mocks.sendReset,
}))

import { LoginScreen } from '../../App'

beforeEach(() => {
  mocks.signIn.mockReset().mockResolvedValue(undefined)
  mocks.sendReset.mockReset().mockResolvedValue(undefined)
})

afterEach(cleanup)

// The boxes are found by their type here, and not by their labels, so that each test below
// fails for what it is about and not because a label is missing.
const type = (kind, value) => fireEvent.change(document.querySelector(`input[type="${kind}"]`), { target: { value } })

// A test marked it.fails is one this screen does not pass yet. The change that makes it pass
// takes the mark off, in the same commit.

describe('the sign in screen', () => {
  it.fails('is the main content of the page, under one level one heading', () => {
    render(<LoginScreen />)

    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Sign In'])
  })

  it.fails('names the email box and the password box by their labels', () => {
    render(<LoginScreen />)

    expect(screen.getByLabelText('Email').getAttribute('type')).toBe('email')
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
  })

  it.fails('reads out a failed sign in as an alert', async () => {
    mocks.signIn.mockRejectedValue(Object.assign(new Error('Firebase: Error'), { code: 'auth/invalid-credential' }))
    render(<LoginScreen />)
    type('email', 'pat@p2em.com')
    type('password', 'not it')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign In' })) })

    expect(screen.getByRole('alert').textContent).toBe('Incorrect email or password.')
  })

  it.fails('reads out that the reset link went out, in a status', async () => {
    render(<LoginScreen />)
    type('email', 'pat@p2em.com')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' })) })

    expect(screen.getByRole('status').textContent).toContain('Reset link sent to pat@p2em.com')
  })

  it('has no accessibility violations, empty and with an error showing', async () => {
    mocks.signIn.mockRejectedValue(Object.assign(new Error('Firebase: Error'), { code: 'auth/too-many-requests' }))
    const { container } = render(<LoginScreen />)
    expect(await axe(container)).toHaveNoViolations()

    type('email', 'pat@p2em.com')
    type('password', 'not it')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign In' })) })
    expect(await axe(container)).toHaveNoViolations()
  })
})
