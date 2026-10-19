import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { axe } from '@/test/axe'
import { pressSpace } from '@/test/keyboard'

// The staff inbox creates a submit, replies to one and changes its status. Each of those
// tells the person how it ended, and a form or a reply box is cleared only when its write
// went through. A reply is two writes, the reply and then moving an open submit to In
// Progress, and each one names itself if it fails on its own. Everything that would reach
// Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: { submits: [] },
  addSubmit: vi.fn(),
  addSubmitReply: vi.fn(),
  updateSubmit: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({
  addSubmit: mocks.addSubmit,
  addSubmitReply: mocks.addSubmitReply,
  updateSubmit: mocks.updateSubmit,
  useSubmitReplies: () => ({ replies: [], loading: false, error: null }),
}))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import SubmitInbox from '../SubmitInbox'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

const TICKET = {
  _docId: 's1', subject: 'Gate code', body: 'What is the gate code?', category: 'Question', priority: 'Medium',
  status: 'Open', portal: 'Client', createdAt: { toDate: () => new Date(2026, 9, 18) },
}

beforeEach(() => {
  for (const mock of [mocks.addSubmit, mocks.addSubmitReply, mocks.updateSubmit, mocks.toast]) mock.mockReset()
  mocks.data = { submits: [TICKET] }
})

afterEach(cleanup)

const open = () => render(<ToastContext.Provider value={mocks.toast}><SubmitInbox /></ToastContext.Provider>)
const press = (el) => act(async () => { fireEvent.click(el) })
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)

// A real pointer moves over an option before it clicks, and the option ignores a click until then.
async function choose(trigger, optionName) {
  await act(async () => { fireEvent.mouseDown(trigger) })
  const option = await screen.findByRole('option', { name: optionName })
  await act(async () => { fireEvent.mouseMove(option) })
  await act(async () => { fireEvent.click(option) })
}

// Each submit in the inbox is a button that opens its thread, so a keyboard reaches it with
// Tab and opens it with Space or Enter. It holds words only, laid out with spans, and its name
// is what it says, the subject first and the status last.
describe('the list of submits', () => {
  const BLOCKS = 'p, div, ul, ol, li, h1, h2, h3, h4, h5, h6, section, header, footer, table'
  const row = () => screen.getByRole('button', { name: /^Gate code.*Open$/ })

  it('opens a thread from the keyboard, by the button that names the submit', () => {
    open()
    const button = row()
    expect(button.getAttribute('type')).toBe('button')
    act(() => { button.focus() })
    expect(document.activeElement).toBe(button)

    pressSpace(button)

    expect(screen.getByRole('heading', { name: 'Gate code' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Write a reply…')).toBeTruthy()
  })

  it('holds nothing but phrasing content in a row, and hides the dots between its words', () => {
    open()
    expect([...row().querySelectorAll(BLOCKS)].map((el) => el.tagName)).toEqual([])
    expect(row().textContent).toContain('What is the gate code?')
    for (const dot of [...row().querySelectorAll('span')].filter((el) => el.textContent === '·')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('has no accessibility violations in the list', async () => {
    const { container } = open()
    expect(screen.getAllByRole('button', { name: /Gate code/ })).toHaveLength(1)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('creating a submit', () => {
  const start = () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /New Submit/ }))
    fireEvent.change(screen.getByPlaceholderText('Brief summary of the issue or request'), { target: { value: 'Panel location' } })
    fireEvent.change(screen.getByPlaceholderText('Describe the issue or request in detail…'), { target: { value: 'Where does the panel go?' } })
  }
  const send = () => screen.getByRole('button', { name: /^(Submit|Submitting…)$/ })

  it('writes the submit, says it was created, and returns to the inbox', async () => {
    start()
    await press(send())

    expect(mocks.addSubmit).toHaveBeenCalledTimes(1)
    expect(mocks.addSubmit.mock.calls[0][0]).toMatchObject({ subject: 'Panel location', body: 'Where does the panel go?', status: 'Open' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Submit created.' }])
    expect(screen.queryByPlaceholderText('Brief summary of the issue or request')).toBeNull()
  })

  it('reads Submitting and takes no second press while the write is out', async () => {
    const pending = deferred()
    mocks.addSubmit.mockReturnValue(pending.promise)
    start()
    await press(send())

    expect(send().textContent).toBe('Submitting…')
    expect(send().disabled).toBe(true)
    expect(mocks.addSubmit).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve() })
  })

  it('keeps the form with what was typed, and says why, when the write is refused', async () => {
    mocks.addSubmit.mockRejectedValue(refused())
    start()
    await press(send())

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not create the submit. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(screen.getByPlaceholderText('Brief summary of the issue or request').value).toBe('Panel location')
    expect(send().disabled).toBe(false)
  })
})

describe('replying', () => {
  const openThread = (status = 'Open') => {
    mocks.data = { submits: [{ ...TICKET, status }] }
    open()
    fireEvent.click(screen.getByText('Gate code'))
  }
  const box = () => screen.getByPlaceholderText('Write a reply…')
  const send = () => screen.getByRole('button', { name: /^(Send Reply|Sending…)$/ })
  const write = () => fireEvent.change(box(), { target: { value: 'The code is 4417' } })

  it('writes the reply as the P2 team, says it was sent, and clears the box', async () => {
    openThread('In Progress')
    write()
    await press(send())

    expect(mocks.addSubmitReply).toHaveBeenCalledWith('s1', { body: 'The code is 4417', author: 'P2 Team', authorRole: 'internal' })
    expect(mocks.updateSubmit).not.toHaveBeenCalled()
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Reply sent.' }])
    expect(box().value).toBe('')
  })

  it('moves an open submit to In Progress with the reply, and says nothing more', async () => {
    openThread('Open')
    write()
    await press(send())

    expect(mocks.updateSubmit).toHaveBeenCalledWith('s1', { status: 'In Progress' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Reply sent.' }])
  })

  it('keeps the reply, says why, and leaves the status alone, when the reply is refused', async () => {
    mocks.addSubmitReply.mockRejectedValue(refused())
    openThread('Open')
    write()
    await press(send())

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not send the reply. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(box().value).toBe('The code is 4417')
    expect(mocks.updateSubmit).not.toHaveBeenCalled()
    expect(send().disabled).toBe(false)
  })

  it('clears the box, because the reply is in, and says the status did not move, when only that fails', async () => {
    mocks.updateSubmit.mockRejectedValue(refused())
    openThread('Open')
    write()
    await press(send())

    expect(toastCalls()).toEqual([
      { tone: 'success', title: 'Reply sent.' },
      {
        tone: 'error',
        title: 'The reply was sent, but the submit did not move to In Progress.',
        description: 'You do not have permission to do that.',
      },
    ])
    expect(box().value).toBe('')
  })

  it('reads Sending and takes no second press while the reply is out', async () => {
    const pending = deferred()
    mocks.addSubmitReply.mockReturnValue(pending.promise)
    openThread('In Progress')
    write()
    await press(send())

    expect(send().textContent.trim()).toBe('Sending…')
    expect(send().disabled).toBe(true)
    await act(async () => { pending.resolve() })
  })
})

describe('the status of a submit', () => {
  const open_ = () => {
    open()
    fireEvent.click(screen.getByText('Gate code'))
    return screen.getAllByRole('combobox').find((el) => /Open/.test(el.textContent))
  }

  it('writes the status and says what it was set to', async () => {
    await choose(open_(), 'Resolved')

    expect(mocks.updateSubmit).toHaveBeenCalledWith('s1', { status: 'Resolved' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Status set to resolved.' }])
  })

  it('says it could not change the status, with the reason, when the write is refused', async () => {
    mocks.updateSubmit.mockRejectedValue(refused())
    await choose(open_(), 'In Progress')

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not change the status. Try again.',
      description: 'You do not have permission to do that.',
    }])
  })

  it('does not make the reply button read Sending while the status is being saved', async () => {
    const pending = deferred()
    mocks.updateSubmit.mockReturnValue(pending.promise)
    const trigger = open_()
    fireEvent.change(screen.getByPlaceholderText('Write a reply…'), { target: { value: 'Hello' } })

    await choose(trigger, 'Resolved')

    expect(screen.getByRole('button', { name: 'Send Reply' }).disabled).toBe(false)
    await act(async () => { pending.resolve() })
  })
})
