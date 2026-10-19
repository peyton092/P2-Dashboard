import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { pressSpace } from '@/test/keyboard'

// The terms a builder accepts before the portal opens. A person on a phone with a keyboard
// or a switch has to be able to check the box and press Accept (Review Focus 2 of the plan).
// Importing App.jsx pulls in the whole app, so everything that would reach Firebase is
// replaced.
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'builder1', email: 'builder1@qbs.test' } },
  setDoc: vi.fn(),
}))

vi.mock('../../firebase', () => ({
  auth: mocks.auth,
  db: {},
  functions: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  setDoc: mocks.setDoc,
}))

import { TermsGate } from '../../App'

beforeEach(() => {
  mocks.setDoc.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const AGREE = /I have read and agree to the P2 Field Control Terms of Access/
const accept = () => screen.getByRole('button', { name: 'Accept & Enter Portal' })
const open = (onAccept = vi.fn()) => {
  render(<TermsGate tenantId="qbs" tenantName="QBS Builder Portal" onAccept={onAccept} />)
  return onAccept
}

describe('the terms gate', () => {
  it('is the main content of the page, under one level one heading', () => {
    open()

    expect(screen.getByRole('main')).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent.trim()).toMatch(/^Terms of Access/)
  })

  it('asks for agreement with a real checkbox, named by what is agreed to, and starts unchecked', () => {
    open()

    const box = screen.getByRole('checkbox', { name: AGREE })
    expect(box.tagName).toBe('INPUT')
    expect(box.checked).toBe(false)
    expect(accept().disabled).toBe(true)
  })

  it('checks the box with Space from the keyboard, and then Accept can be pressed', async () => {
    const onAccept = open()

    const box = screen.getByRole('checkbox', { name: AGREE })
    act(() => { box.focus() })
    expect(document.activeElement).toBe(box)
    pressSpace()

    expect(box.checked).toBe(true)
    expect(accept().disabled).toBe(false)

    act(() => { accept().focus() })
    await act(async () => { pressSpace() })
    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('unchecks the box with Space too, and Accept goes off again', () => {
    open()

    const box = screen.getByRole('checkbox', { name: AGREE })
    act(() => { box.focus() })
    pressSpace()
    pressSpace()

    expect(box.checked).toBe(false)
    expect(accept().disabled).toBe(true)
  })

  it('reads out an acceptance that could not be recorded as an alert', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.setDoc.mockRejectedValue(new Error('offline'))
    const onAccept = open()

    fireEvent.click(screen.getByText(AGREE))
    await act(async () => { fireEvent.click(accept()) })

    expect(screen.getByRole('alert').textContent).toBe('Could not record your acceptance. Check your connection and try again.')
    expect(onAccept).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it('has no accessibility violations, before and after the box is checked', async () => {
    const { container } = render(<TermsGate tenantId="qbs" tenantName="QBS Builder Portal" onAccept={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()

    fireEvent.click(screen.getByText(AGREE))
    expect(await axe(container)).toHaveNoViolations()
  })
})
