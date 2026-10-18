import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

// Importing App.jsx pulls in the whole app, so everything that would reach
// Firebase is replaced: the app's own firebase.js, httpsCallable, the password
// reset email, and the two calls the old modal used to make from the browser.
const mocks = vi.hoisted(() => ({
  auth: { name: 'the-auth' },
  functions: { name: 'the-functions' },
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  setDoc: vi.fn(),
}))

vi.mock('../firebase', () => ({
  auth: mocks.auth,
  functions: mocks.functions,
  db: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('firebase/functions', () => ({
  httpsCallable: mocks.httpsCallable,
  getFunctions: vi.fn(),
}))
vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  createUserWithEmailAndPassword: mocks.createUserWithEmailAndPassword,
}))
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  setDoc: mocks.setDoc,
}))

import { CreateUserModal } from '../App'

const SUCCESS = (email) => `Account created. ${email} will receive an email to set their password.`

beforeEach(() => {
  mocks.callable.mockReset().mockResolvedValue({ data: { uid: 'new-uid' } })
  mocks.httpsCallable.mockReset().mockReturnValue(mocks.callable)
  mocks.sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
  mocks.createUserWithEmailAndPassword.mockReset()
  mocks.setDoc.mockReset()
})

afterEach(cleanup)

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

function openModal(onClose = vi.fn()) {
  render(<CreateUserModal onClose={onClose} />)
  return onClose
}

describe('CreateUserModal dialog behavior', () => {
  it('is a modal dialog named by its title', () => {
    openModal()
    const dialog = screen.getByRole('dialog', { name: 'Create User Account' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(document.getElementById(titleId).textContent).toContain('Create User Account')
  })

  it('takes the dark theme from the document and names its own text color', () => {
    // It renders outside the app shell. index.html puts the dark class on the
    // document root, so the dialog needs no scope of its own, but it still sets
    // its foreground so the text on the dark card never depends on what is behind it.
    openModal()
    const overlay = screen.getByRole('dialog').parentElement
    expect(overlay.classList.contains('dark')).toBe(false)
    expect(overlay.classList.contains('text-foreground')).toBe(true)
  })

  it('focuses the Name field when it opens', () => {
    openModal()
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  it('closes on Escape, and only on Escape', () => {
    const onClose = openModal()
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape from inside a field', () => {
    const onClose = openModal()
    fireEvent.keyDown(screen.getByLabelText('Email'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once it is closed', () => {
    const onClose = vi.fn()
    const { unmount } = render(<CreateUserModal onClose={onClose} />)
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls the newest onClose, and does not take focus back when its parent re-renders', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<CreateUserModal onClose={first} />)
    fireEvent.focus(screen.getByLabelText('Email'))
    screen.getByLabelText('Email').focus()
    rerender(<CreateUserModal onClose={second} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Email'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('has a close button with an accessible name', () => {
    const onClose = openModal()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives focus back to the element that opened it', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<CreateUserModal onClose={() => {}} />)
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('CreateUserModal fields', () => {
  it('labels every field, with each label pointing at its input', () => {
    openModal()
    for (const name of ['Name', 'Email', 'Role']) {
      const field = screen.getByLabelText(name)
      const label = document.querySelector(`label[for="${field.id}"]`)
      expect(field.id).toBeTruthy()
      expect(label?.textContent).toBe(name)
    }
  })

  it('has no password field', () => {
    openModal()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('offers exactly the four roles', () => {
    openModal()
    const options = within(screen.getByLabelText('Role')).getAllByRole('option')
    expect(options.map(o => o.value)).toEqual(['owner', 'internal', 'builder', 'client'])
  })

  it('shows Tenant only for a builder, with the two builder tenants', () => {
    openModal()
    expect(screen.queryByLabelText('Tenant')).toBeNull()
    fill('Role', 'builder')
    const options = within(screen.getByLabelText('Tenant')).getAllByRole('option')
    expect(options.map(o => o.value)).toEqual(['qbs', 'vision'])
    fill('Role', 'internal')
    expect(screen.queryByLabelText('Tenant')).toBeNull()
  })

  it('shows Client job ids only for a client, and explains the format', () => {
    openModal()
    expect(screen.queryByLabelText('Client job ids')).toBeNull()
    fill('Role', 'client')
    const field = screen.getByLabelText('Client job ids')
    expect(field.required).toBe(true)
    const hint = document.getElementById(field.getAttribute('aria-describedby'))
    expect(hint.textContent).toMatch(/commas or spaces/)
    fill('Role', 'owner')
    expect(screen.queryByLabelText('Client job ids')).toBeNull()
  })

  it('requires an email', () => {
    openModal()
    expect(screen.getByLabelText('Email').required).toBe(true)
    expect(screen.getByLabelText('Email').type).toBe('email')
  })

  it('uses no em or en dashes in its copy', () => {
    openModal()
    fill('Role', 'client')
    expect(document.body.textContent).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('CreateUserModal submit', () => {
  it('creates the account through the createUser callable, then emails a password reset', async () => {
    openModal()
    fill('Name', '  Pat Lee ')
    fill('Email', ' pat@example.com ')
    submit()

    expect(await screen.findByText(SUCCESS('pat@example.com'))).toBeTruthy()
    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.functions, 'createUser')
    expect(mocks.callable).toHaveBeenCalledTimes(1)
    expect(mocks.callable).toHaveBeenCalledWith({
      email: 'pat@example.com',
      displayName: 'Pat Lee',
      role: 'internal',
    })
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(mocks.auth, 'pat@example.com')
    expect(mocks.callable.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendPasswordResetEmail.mock.invocationCallOrder[0],
    )
  })

  it('sends the tenant for a builder', async () => {
    openModal()
    fill('Email', 'bo@qbs.example.com')
    fill('Role', 'builder')
    submit()
    await screen.findByText(SUCCESS('bo@qbs.example.com'))
    expect(mocks.callable).toHaveBeenLastCalledWith({
      email: 'bo@qbs.example.com',
      displayName: '',
      role: 'builder',
      tenantId: 'qbs',
    })

    fill('Email', 'vi@vision.example.com')
    fill('Tenant', 'vision')
    submit()
    await screen.findByText(SUCCESS('vi@vision.example.com'))
    expect(mocks.callable).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'builder', tenantId: 'vision' }))
  })

  it('sends client job ids as an upper case array split on commas and spaces', async () => {
    openModal()
    fill('Name', 'Lee Homes')
    fill('Email', 'lee@example.com')
    fill('Role', 'client')
    fill('Client job ids', ' qbs-018, QBS-032  vis-041 ,, ')
    submit()
    await screen.findByText(SUCCESS('lee@example.com'))
    expect(mocks.callable).toHaveBeenCalledWith({
      email: 'lee@example.com',
      displayName: 'Lee Homes',
      role: 'client',
      clientJobIds: ['QBS-018', 'QBS-032', 'VIS-041'],
    })
  })

  it('never sends a tenant or job ids for roles that do not use them', async () => {
    openModal()
    fill('Email', 'o@example.com')
    fill('Role', 'builder')
    fill('Role', 'client')
    fill('Client job ids', 'QBS-001')
    fill('Role', 'owner')
    submit()
    await screen.findByText(SUCCESS('o@example.com'))
    expect(mocks.callable).toHaveBeenCalledWith({ email: 'o@example.com', displayName: '', role: 'owner' })
  })

  it('clears the identifying fields after success and keeps the dialog open', async () => {
    const onClose = openModal()
    fill('Name', 'Pat Lee')
    fill('Email', 'pat@example.com')
    submit()
    await screen.findByText(SUCCESS('pat@example.com'))
    expect(screen.getByLabelText('Name').value).toBe('')
    expect(screen.getByLabelText('Email').value).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the callable error message as it is, sends no email and keeps the fields', async () => {
    mocks.callable.mockRejectedValue(Object.assign(new Error('An account with that email already exists.'), { code: 'functions/already-exists' }))
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('An account with that email already exists.')
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(screen.queryByText(/Account created/)).toBeNull()
    expect(screen.getByLabelText('Email').value).toBe('pat@example.com')
  })

  it('shows a plain message when the error has none', async () => {
    mocks.callable.mockRejectedValue({})
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Could not create the account. Try again.')
  })

  it('shows a plain message instead of the bare code the SDK uses when the request got no reply', async () => {
    // With no reply from the server, FunctionsError.message is just the code.
    openModal()
    fill('Email', 'pat@example.com')
    for (const code of ['internal', 'unavailable', 'not-found', 'permission-denied', 'unauthenticated']) {
      mocks.callable.mockRejectedValueOnce(Object.assign(new Error(code), { code: `functions/${code}` }))
      submit()
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe('Could not create the account. Try again.')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create Account' }).disabled).toBe(false))
    }
  })

  it('treats the status name the SDK uses when the server sent no message as a bare code too', async () => {
    // A reply with a status but no message gives "INTERNAL" or "NOT_FOUND" (upper case,
    // with underscores) for the code "functions/internal" or "functions/not-found".
    openModal()
    fill('Email', 'pat@example.com')
    const cases = [
      ['internal', 'INTERNAL'],
      ['not-found', 'NOT_FOUND'],
      ['deadline-exceeded', 'DEADLINE_EXCEEDED'],
      ['permission-denied', 'Permission-Denied'],
      ['unauthenticated', 'Unauthenticated'],
    ]
    for (const [code, message] of cases) {
      mocks.callable.mockRejectedValueOnce(Object.assign(new Error(message), { code: `functions/${code}` }))
      submit()
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe('Could not create the account. Try again.')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create Account' }).disabled).toBe(false))
    }
  })

  it('still shows a real message that merely starts with the code name', async () => {
    mocks.callable.mockRejectedValue(
      Object.assign(new Error('Internal accounts need an owner.'), { code: 'functions/internal' }),
    )
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Internal accounts need an owner.')
  })

  it('shows the message the function sent, whatever its code', async () => {
    mocks.callable.mockRejectedValue(Object.assign(new Error('Owner access required.'), { code: 'functions/permission-denied' }))
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Owner access required.')
  })

  it('clears an old error when the form is submitted again', async () => {
    mocks.callable.mockRejectedValueOnce(new Error('Choose a role.'))
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    await screen.findByRole('alert')
    submit()
    await screen.findByText(SUCCESS('pat@example.com'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the account exists but the email failed, and clears the form so it is not submitted twice', async () => {
    mocks.sendPasswordResetEmail.mockRejectedValue(Object.assign(new Error('Firebase: Error (auth/too-many-requests).'), { code: 'auth/too-many-requests' }))
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    const note = await screen.findByText(/Account created for pat@example.com, but the email did not send/)
    expect(note.textContent).toContain('Forgot password')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(SUCCESS('pat@example.com'))).toBeNull()
    expect(screen.getByLabelText('Email').value).toBe('')
  })

  it('disables the button while the account is being created and ignores a second submit', async () => {
    let finish
    mocks.callable.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    openModal()
    fill('Email', 'pat@example.com')
    submit()
    const button = await screen.findByRole('button', { name: 'Creating…' })
    expect(button.disabled).toBe(true)
    fireEvent.submit(button.closest('form'))
    expect(mocks.callable).toHaveBeenCalledTimes(1)
    finish({ data: { uid: 'u' } })
    await screen.findByText(SUCCESS('pat@example.com'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Account' }).disabled).toBe(false))
  })

  it('no longer creates accounts or user documents from the browser', async () => {
    openModal()
    fill('Email', 'pat@example.com')
    fill('Role', 'client')
    fill('Client job ids', 'QBS-001')
    submit()
    await screen.findByText(SUCCESS('pat@example.com'))
    expect(mocks.createUserWithEmailAndPassword).not.toHaveBeenCalled()
    expect(mocks.setDoc).not.toHaveBeenCalled()
  })
})
