import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// Both portals send messages, reply to them, and the builder portal changes the status of
// a message and marks updates read. Each of those tells the person how it ended, and a
// form or a reply box is cleared only when its write went through. A reply is two writes,
// the reply and then moving an open message to In Progress, and each one says so if it
// fails on its own. Everything that would reach Firebase is replaced.
const mocks = vi.hoisted(() => ({
  data: null,
  addSubmit: vi.fn(),
  addSubmitReply: vi.fn(),
  updateSubmit: vi.fn(),
  updateNotification: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ auth: {}, storage: {}, db: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../brand/Brand', () => ({
  default: () => null,
  BrandMark: () => null,
}))
vi.mock('../../hooks/useFirestore', () => ({
  approveExtra: vi.fn(),
  rejectExtra: vi.fn(),
  useJobFiles: () => ({ files: [], loading: false, error: null }),
  useSubmitReplies: () => ({ replies: [], loading: false, error: null }),
  addSubmit: mocks.addSubmit,
  addSubmitReply: mocks.addSubmitReply,
  updateSubmit: mocks.updateSubmit,
  addJobFile: vi.fn(),
  updateNotification: mocks.updateNotification,
}))

import ClientPortal from '../ClientPortal'
import QBSBuilderPortal from '../QBSBuilderPortal'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

const JOB = {
  id: 'QBS-003', _docId: 'job3', name: 'Lee Residence', client: 'Dana Lee', address: '123 Main St',
  status: 'active', tenantId: 'qbs', qbsPM: 'Taylor Hensley', insp: {},
}
const TICKET = {
  _docId: 's1', subject: 'Gate code', body: 'What is the gate code?', category: 'Question', priority: 'Medium',
  status: 'Open', jobId: 'QBS-003', portal: 'Client', createdAt: { seconds: 1760000000 },
}

const portalData = (role, over = {}) => ({
  jobs: [JOB],
  extras: [],
  submits: [TICKET],
  notifs: [],
  loading: false,
  error: null,
  role,
  tenantId: role === 'builder' ? 'qbs' : null,
  uid: 'u1',
  scope: { role, tenantId: role === 'builder' ? 'qbs' : null, uid: 'u1' },
  ...over,
})

beforeEach(() => {
  for (const mock of [mocks.addSubmit, mocks.addSubmitReply, mocks.updateSubmit, mocks.updateNotification, mocks.toast]) {
    mock.mockReset()
  }
})

afterEach(cleanup)

const wrap = (ui) => <ToastContext.Provider value={mocks.toast}>{ui}</ToastContext.Provider>
const press = (el) => act(async () => { fireEvent.click(el) })
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)

// A real pointer moves over an option before it clicks, and the option ignores a click until then.
async function choose(trigger, optionName) {
  await act(async () => { fireEvent.mouseDown(trigger) })
  const option = await screen.findByRole('option', { name: optionName })
  await act(async () => { fireEvent.mouseMove(option) })
  await act(async () => { fireEvent.click(option) })
}

const PORTALS = [
  {
    name: 'the client portal',
    role: 'client',
    reply: 'Send reply',
    async open(over) {
      mocks.data = portalData('client', over)
      render(wrap(<ClientPortal clientName="Lee Homes" userName="Dana Lee" />))
      fireEvent.click(screen.getAllByRole('button', { name: /Messages/ })[0])
    },
    newMessage: async () => {
      fireEvent.click(screen.getByRole('button', { name: /New message/ }))
      const project = screen.getAllByRole('combobox').find((el) => /Select a project/.test(el.textContent))
      await choose(project, /QBS-003/)
      fireEvent.change(screen.getByPlaceholderText('Brief summary'), { target: { value: 'Gate code' } })
      fireEvent.change(screen.getByPlaceholderText('How can P2 help?'), { target: { value: 'What is the gate code?' } })
    },
    sendNew: 'Send to P2',
  },
  {
    name: 'the builder portal',
    role: 'builder',
    reply: 'Send Reply',
    async open(over) {
      mocks.data = portalData('builder', over)
      render(wrap(<QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />))
      fireEvent.click(screen.getAllByRole('button', { name: /Submit/ })[0])
    },
    newMessage: async () => {
      fireEvent.click(screen.getByRole('button', { name: /New message/ }))
      fireEvent.change(screen.getByPlaceholderText('Brief summary'), { target: { value: 'Panel location' } })
      fireEvent.change(screen.getByPlaceholderText('Describe in detail…'), { target: { value: 'Where does the panel go?' } })
    },
    sendNew: 'Send to P2',
  },
]

describe.each(PORTALS)('$name', (portal) => {
  const submits = (status) => [{ ...TICKET, portal: portal.role === 'builder' ? 'Builder' : 'Client', status }]
  const openThread = async (status = 'Open') => {
    await portal.open({ submits: submits(status) })
    fireEvent.click(screen.getByRole('button', { name: /Gate code/ }))
  }
  const box = () => screen.getByPlaceholderText('Write a reply…')
  const send = () => screen.getByRole('button', { name: new RegExp(`^(${portal.reply}|Sending…)$`) })
  const write = (text = 'The code is 4417') => fireEvent.change(box(), { target: { value: text } })

  describe('sending a new message', () => {
    it('says the message went to P2, and returns to the inbox', async () => {
      await portal.open({ submits: [] })
      await portal.newMessage()
      await press(screen.getByRole('button', { name: portal.sendNew }))

      expect(mocks.addSubmit).toHaveBeenCalledTimes(1)
      expect(toastCalls()).toEqual([{ tone: 'success', title: 'Message sent to P2.' }])
      expect(screen.queryByPlaceholderText('Brief summary')).toBeNull()
    })

    it('reads Sending and takes no second press while the write is out', async () => {
      const pending = deferred()
      mocks.addSubmit.mockReturnValue(pending.promise)
      await portal.open({ submits: [] })
      await portal.newMessage()
      await press(screen.getByRole('button', { name: portal.sendNew }))

      const sending = screen.getByRole('button', { name: /^(Sending…|Submitting…)$/ })
      expect(sending.disabled).toBe(true)
      expect(mocks.addSubmit).toHaveBeenCalledTimes(1)

      await act(async () => { pending.resolve() })
      expect(screen.queryByPlaceholderText('Brief summary')).toBeNull()
    })
  })

  describe('replying', () => {
    it('writes the reply, says it was sent, and clears the box', async () => {
      await openThread('In Progress')
      write()
      await press(send())

      expect(mocks.addSubmitReply).toHaveBeenCalledTimes(1)
      expect(mocks.addSubmitReply.mock.calls[0][0]).toBe('s1')
      expect(mocks.addSubmitReply.mock.calls[0][1]).toMatchObject({ body: 'The code is 4417' })
      expect(mocks.updateSubmit).not.toHaveBeenCalled()
      expect(toastCalls()).toEqual([{ tone: 'success', title: 'Reply sent.' }])
      expect(box().value).toBe('')
    })

    it('moves an open message to In Progress with the reply, and says nothing more', async () => {
      await openThread('Open')
      write()
      await press(send())

      expect(mocks.updateSubmit).toHaveBeenCalledTimes(1)
      expect(mocks.updateSubmit).toHaveBeenCalledWith('s1', { status: 'In Progress' })
      expect(toastCalls()).toEqual([{ tone: 'success', title: 'Reply sent.' }])
    })

    it('reads Sending and takes no second press while the reply is out', async () => {
      const pending = deferred()
      mocks.addSubmitReply.mockReturnValue(pending.promise)
      await openThread('In Progress')
      write()
      await press(send())

      expect(send().textContent.trim()).toBe('Sending…')
      expect(send().disabled).toBe(true)
      expect(mocks.addSubmitReply).toHaveBeenCalledTimes(1)

      await act(async () => { pending.resolve() })
      await waitFor(() => expect(box().value).toBe(''))
    })

    it('keeps the reply, says why, and does not touch the status, when the reply is refused', async () => {
      mocks.addSubmitReply.mockRejectedValue(refused())
      await openThread('Open')
      write()
      await press(send())

      expect(toastCalls()).toEqual([{
        tone: 'error',
        title: 'Could not send your reply. Try again.',
        description: 'Missing or insufficient permissions.',
      }])
      expect(box().value).toBe('The code is 4417')
      expect(mocks.updateSubmit).not.toHaveBeenCalled()
      expect(send().disabled).toBe(false)
    })

    it('clears the box, because the reply is in, and says the status did not move, when only that fails', async () => {
      mocks.updateSubmit.mockRejectedValue(refused())
      await openThread('Open')
      write()
      await press(send())

      expect(toastCalls()).toEqual([
        { tone: 'success', title: 'Reply sent.' },
        {
          tone: 'error',
          title: 'The reply was sent, but the message did not move to In Progress.',
          description: 'Missing or insufficient permissions.',
        },
      ])
      expect(box().value).toBe('')
    })

    it('cannot be sent empty', async () => {
      await openThread('Open')
      expect(send().disabled).toBe(true)
      write('   ')
      expect(send().disabled).toBe(true)
    })
  })
})

describe('the status of a message in the builder portal', () => {
  const open = async () => {
    mocks.data = portalData('builder', { submits: [{ ...TICKET, portal: 'Builder' }] })
    render(wrap(<QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />))
    fireEvent.click(screen.getAllByRole('button', { name: /Submit/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /Gate code/ }))
    return screen.getAllByRole('combobox').find((el) => /Open/.test(el.textContent))
  }

  it('writes the status and says what it was set to', async () => {
    await choose(await open(), 'Resolved')

    expect(mocks.updateSubmit).toHaveBeenCalledWith('s1', { status: 'Resolved' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Status set to resolved.' }])
  })

  it('does not make the reply button read Sending while the status is being saved', async () => {
    const pending = deferred()
    mocks.updateSubmit.mockReturnValue(pending.promise)
    const trigger = await open()
    fireEvent.change(screen.getByPlaceholderText('Write a reply…'), { target: { value: 'Hello' } })

    await choose(trigger, 'Resolved')

    expect(screen.getByRole('button', { name: 'Send Reply' }).disabled).toBe(false)
    await act(async () => { pending.resolve() })
  })

  it('says it could not change the status, with the reason, when the write is refused', async () => {
    mocks.updateSubmit.mockRejectedValue(refused())
    await choose(await open(), 'Resolved')

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not change the status. Try again.',
      description: 'Missing or insufficient permissions.',
    }])
  })
})

describe('the updates in the builder portal', () => {
  const UNREAD = { _docId: 'n1', msg: 'QBS-003 electrical rough in passed', type: 'success', read: false, createdAt: { seconds: 1760000000 } }
  const open = () => {
    mocks.data = portalData('builder', { notifs: [UNREAD] })
    render(wrap(<QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />))
    fireEvent.click(screen.getAllByRole('button', { name: /Alerts/ })[0])
  }
  const update = () => screen.getByRole('button', { name: /QBS-003 electrical rough in passed/ })

  it('marks an update read when it is opened, and says nothing, since the dot goes', async () => {
    open()
    await press(update())

    expect(mocks.updateNotification).toHaveBeenCalledWith('n1', { read: true })
    expect(toastCalls()).toEqual([])
  })

  it('says it could not mark the update read, with the reason, when the write is refused', async () => {
    mocks.updateNotification.mockRejectedValue(refused())
    open()
    await press(update())

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not mark the update read. Try again.',
      description: 'Missing or insufficient permissions.',
    }])
  })

  it('writes nothing for an update that is read already', async () => {
    mocks.data = portalData('builder', { notifs: [{ ...UNREAD, read: true }] })
    render(wrap(<QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />))
    fireEvent.click(screen.getAllByRole('button', { name: /Alerts/ })[0])
    await press(update())
    expect(mocks.updateNotification).not.toHaveBeenCalled()
  })
})
