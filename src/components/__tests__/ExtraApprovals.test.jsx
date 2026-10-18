import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// Both portals let the builder or the client approve a change order or ask for a
// revision. The decision, the notification and the history entry are written by
// the approveExtra and rejectExtra Cloud Functions, so the portals call those
// two helpers and write nothing else themselves. Everything that would reach
// Firebase is replaced: the helpers module records each call, and the three
// writers the portals used to call are there as spies to prove they stay unused.
const mocks = vi.hoisted(() => ({
  data: { jobs: [], extras: [], submits: [], notifs: [], loading: false },
  approveExtra: vi.fn(),
  rejectExtra: vi.fn(),
  updateExtra: vi.fn(),
  addNotification: vi.fn(),
  addHistory: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ auth: {}, storage: {}, db: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({
  approveExtra: mocks.approveExtra,
  rejectExtra: mocks.rejectExtra,
  updateExtra: mocks.updateExtra,
  addNotification: mocks.addNotification,
  addHistory: mocks.addHistory,
  useJobFiles: () => ({ files: [], loading: false, error: null }),
  useSubmitReplies: () => ({ replies: [], loading: false, error: null }),
  addSubmit: vi.fn(),
  addSubmitReply: vi.fn(),
  updateSubmit: vi.fn(),
  addJobFile: vi.fn(),
  updateNotification: vi.fn(),
}))

import ClientPortal from '../ClientPortal'
import QBSBuilderPortal from '../QBSBuilderPortal'

const JOB = {
  id: 'QBS-003',
  _docId: 'job3',
  name: 'Lee Residence',
  client: 'Dana Lee',
  address: '123 Main St',
  status: 'active',
  phase: 'rough-in',
  qbsPM: 'Taylor Hensley',
  insp: {},
}

const extra = (over) => ({ id: 'CO-004', _docId: 'x1', job: 'QBS-003', desc: 'Backflow preventer', amount: 4100, status: 'Sent to Builder', ...over })

// An error as the Functions SDK throws it.
const sdkError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` })

// The two portals, each opened on the screen that lists the change orders.
const PORTALS = [
  {
    name: 'ClientPortal',
    open() {
      render(
        <ToastContext.Provider value={mocks.toast}>
          <ClientPortal clientName="Lee Homes" userName="Dana Lee" />
        </ToastContext.Provider>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: /Approvals/ })[0])
    },
    approveButton: /^Approve$/,
  },
  {
    name: 'QBSBuilderPortal',
    open() {
      render(
        <ToastContext.Provider value={mocks.toast}>
          <QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />
        </ToastContext.Provider>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: /Extras/ })[0])
      // The Extras tab opens on the Pending filter; the other states are one click away.
    },
    approveButton: /Approve change order/,
  },
]

beforeEach(() => {
  // The portals log a failed call before they show it; the tests that make one fail stay quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const mock of [mocks.approveExtra, mocks.rejectExtra, mocks.updateExtra, mocks.addNotification, mocks.addHistory, mocks.toast]) {
    mock.mockReset()
  }
  mocks.approveExtra.mockResolvedValue({ ok: true })
  mocks.rejectExtra.mockResolvedValue({ ok: true })
  mocks.data = { jobs: [JOB], extras: [], submits: [], notifs: [], loading: false }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const requestRevision = () => screen.getByRole('button', { name: 'Request revision' })
const noOtherWriters = () => {
  expect(mocks.updateExtra).not.toHaveBeenCalled()
  expect(mocks.addNotification).not.toHaveBeenCalled()
  expect(mocks.addHistory).not.toHaveBeenCalled()
}

describe.each(PORTALS)('$name change orders', (portal) => {
  describe('which change orders can be decided', () => {
    it.each([
      ['Sent to Builder'],
      ['pending'],
      [undefined],
    ])('offers Approve and Request revision for status %s', (status) => {
      mocks.data.extras = [extra({ status })]
      portal.open()
      expect(screen.getByRole('button', { name: portal.approveButton })).toBeTruthy()
      expect(requestRevision()).toBeTruthy()
    })

    it.each([['Approved'], ['approved'], ['Rejected'], ['rejected']])('offers no decision for status %s', (status) => {
      mocks.data.extras = [extra({ status })]
      portal.open()
      // The Pending filter of the builder portal hides decided ones; open All.
      const all = screen.queryByRole('button', { name: /^All/ })
      if (all) fireEvent.click(all)
      expect(screen.queryByRole('button', { name: portal.approveButton })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Request revision' })).toBeNull()
    })

    it('never shows a draft, which has not been sent', () => {
      mocks.data.extras = [extra({ status: 'Draft', desc: 'Not sent yet', id: 'CO-009', _docId: 'x9' })]
      portal.open()
      const all = screen.queryByRole('button', { name: /^All/ })
      if (all) fireEvent.click(all)
      expect(screen.queryByText('Not sent yet')).toBeNull()
      expect(screen.queryByRole('button', { name: portal.approveButton })).toBeNull()
    })

    it('shows a sent change order next to a draft without the draft', () => {
      mocks.data.extras = [
        extra({ desc: 'Sent one' }),
        extra({ status: 'Draft', desc: 'Draft one', id: 'CO-009', _docId: 'x9' }),
      ]
      portal.open()
      expect(screen.getByText('Sent one')).toBeTruthy()
      expect(screen.queryByText('Draft one')).toBeNull()
    })
  })

  describe('approving', () => {
    it('calls approveExtra with the document id, and writes nothing else from the browser', async () => {
      mocks.data.extras = [extra()]
      portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await waitFor(() => expect(mocks.approveExtra).toHaveBeenCalledTimes(1))
      expect(mocks.approveExtra).toHaveBeenCalledWith('x1')
      noOtherWriters()
      expect(mocks.rejectExtra).not.toHaveBeenCalled()
    })

    it('shows the sentence the function wrote when it refuses', async () => {
      mocks.approveExtra.mockRejectedValue(sdkError('failed-precondition', 'This change order has already been decided.'))
      mocks.data.extras = [extra()]
      portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(await screen.findByText('This change order has already been decided.')).toBeTruthy()
      noOtherWriters()
    })

    it('shows the permission message to someone who may not act on it', async () => {
      mocks.approveExtra.mockRejectedValue(sdkError('permission-denied', 'You can only act on change orders for your own projects.'))
      mocks.data.extras = [extra()]
      portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(await screen.findByText('You can only act on change orders for your own projects.')).toBeTruthy()
    })

    it('shows a plain message when no reply came back, not the bare code', async () => {
      mocks.approveExtra.mockRejectedValue(sdkError('internal', 'internal'))
      mocks.data.extras = [extra()]
      portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(await screen.findByText('Could not save approval. Check your connection and try again.')).toBeTruthy()
      expect(screen.queryByText('internal')).toBeNull()
    })

    it('lets the person try again after a failure', async () => {
      mocks.approveExtra.mockRejectedValueOnce(sdkError('internal', 'internal'))
      mocks.data.extras = [extra()]
      portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await screen.findByText('Could not save approval. Check your connection and try again.')
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await waitFor(() => expect(mocks.approveExtra).toHaveBeenCalledTimes(2))
    })

    it('refuses to call the function for a change order with no document id', () => {
      mocks.data.extras = [extra({ _docId: undefined })]
      portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(mocks.approveExtra).not.toHaveBeenCalled()
    })
  })

  describe('asking for a revision', () => {
    const open = () => {
      mocks.data.extras = [extra()]
      portal.open()
      fireEvent.click(requestRevision())
      return screen.getByPlaceholderText('What should be revised? (required)')
    }
    const send = () => screen.getByRole('button', { name: 'Send revision request' })

    it('needs a note before it can be sent', () => {
      const note = open()
      expect(send().disabled).toBe(true)
      fireEvent.change(note, { target: { value: '   ' } })
      expect(send().disabled).toBe(true)
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      expect(send().disabled).toBe(false)
    })

    it('stops a note at the 1000 characters the function accepts', () => {
      expect(open().getAttribute('maxlength')).toBe('1000')
    })

    it('calls rejectExtra with the document id and the trimmed note, and writes nothing else', async () => {
      const note = open()
      fireEvent.change(note, { target: { value: '  Use the 200A panel  ' } })
      fireEvent.click(send())
      await waitFor(() => expect(mocks.rejectExtra).toHaveBeenCalledTimes(1))
      expect(mocks.rejectExtra).toHaveBeenCalledWith('x1', 'Use the 200A panel')
      noOtherWriters()
      expect(mocks.approveExtra).not.toHaveBeenCalled()
    })

    it('closes the form once the function has accepted it', async () => {
      const note = open()
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      await waitFor(() => expect(screen.queryByPlaceholderText('What should be revised? (required)')).toBeNull())
    })

    it('keeps the form and the note, and shows the message, when the function refuses', async () => {
      mocks.rejectExtra.mockRejectedValue(sdkError('failed-precondition', 'This change order has already been decided.'))
      const note = open()
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      expect(await screen.findByText('This change order has already been decided.')).toBeTruthy()
      expect(screen.getByPlaceholderText('What should be revised? (required)').value).toBe('Use the 200A panel')
      noOtherWriters()
    })

    it('shows a plain message when no reply came back', async () => {
      mocks.rejectExtra.mockRejectedValue(sdkError('internal', 'internal'))
      const note = open()
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      const message = await screen.findByText(/Check your connection and try again\./)
      expect(message.textContent).not.toBe('internal')
    })
  })
})

describe('ClientPortal', () => {
  it('thanks the client with a toast when an approval goes through, as before', async () => {
    mocks.data.extras = [extra()]
    PORTALS[0].open()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Change order approved', description: 'CO-004 · $4,100' })
  })

  it('tells the client the revision request went through', async () => {
    mocks.data.extras = [extra()]
    PORTALS[0].open()
    fireEvent.click(requestRevision())
    fireEvent.change(screen.getByPlaceholderText('What should be revised? (required)'), { target: { value: 'Use the 200A panel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send revision request' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'info', title: 'Revision requested', description: 'P2 has been notified about CO-004.' })
  })

  it('does not toast a failed approval', async () => {
    mocks.approveExtra.mockRejectedValue(sdkError('internal', 'internal'))
    mocks.data.extras = [extra()]
    PORTALS[0].open()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    await screen.findByText(/Check your connection/)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('counts a change order as awaiting approval in either casing, and leaves out drafts and decided ones', () => {
    mocks.data.extras = [
      extra({ _docId: 'a', id: 'CO-001', status: 'Sent to Builder' }),
      extra({ _docId: 'b', id: 'CO-002', status: 'pending' }),
      extra({ _docId: 'c', id: 'CO-003', status: 'Draft' }),
      extra({ _docId: 'd', id: 'CO-005', status: 'Approved' }),
      extra({ _docId: 'e', id: 'CO-006', status: 'rejected' }),
    ]
    render(<ToastContext.Provider value={mocks.toast}><ClientPortal clientName="Lee Homes" userName="Dana Lee" /></ToastContext.Provider>)
    const tile = screen.getByText('Awaiting approval').closest('div').parentElement
    expect(within(tile).getByText('2')).toBeTruthy()
  })
})

describe('QBSBuilderPortal', () => {
  it('lists a change order under its decided state however the status is spelled', () => {
    mocks.data.extras = [
      extra({ _docId: 'a', id: 'CO-001', desc: 'Pending Title Case', status: 'Sent to Builder' }),
      extra({ _docId: 'b', id: 'CO-002', desc: 'Approved Title Case', status: 'Approved' }),
      extra({ _docId: 'c', id: 'CO-003', desc: 'Approved lower case', status: 'approved' }),
      extra({ _docId: 'd', id: 'CO-005', desc: 'Rejected Title Case', status: 'Rejected' }),
      extra({ _docId: 'e', id: 'CO-006', desc: 'Draft one', status: 'Draft' }),
    ]
    PORTALS[1].open()
    expect(screen.getByText('Pending Title Case')).toBeTruthy()
    expect(screen.queryByText('Approved Title Case')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Approved/ }))
    expect(screen.getByText('Approved Title Case')).toBeTruthy()
    expect(screen.getByText('Approved lower case')).toBeTruthy()
    expect(screen.queryByText('Rejected Title Case')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Rejected/ }))
    expect(screen.getByText('Rejected Title Case')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(screen.getByText('Pending Title Case')).toBeTruthy()
    expect(screen.queryByText('Draft one')).toBeNull()
  })

  it('counts the filters by state, with no draft in All', () => {
    mocks.data.extras = [
      extra({ _docId: 'a', id: 'CO-001', status: 'Sent to Builder' }),
      extra({ _docId: 'b', id: 'CO-002', status: 'pending' }),
      extra({ _docId: 'c', id: 'CO-003', status: 'Approved' }),
      extra({ _docId: 'd', id: 'CO-005', status: 'approved' }),
      extra({ _docId: 'e', id: 'CO-006', status: 'Rejected' }),
      extra({ _docId: 'f', id: 'CO-007', status: 'Draft' }),
    ]
    PORTALS[1].open()
    expect(screen.getByRole('button', { name: /^Pending/ }).textContent).toBe('Pending2')
    expect(screen.getByRole('button', { name: /^Approved/ }).textContent).toBe('Approved2')
    expect(screen.getByRole('button', { name: /^Rejected/ }).textContent).toBe('Rejected1')
    expect(screen.getByRole('button', { name: /^All/ }).textContent).toBe('All5')
  })
})
