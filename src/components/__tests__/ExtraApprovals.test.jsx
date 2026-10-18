import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'

// Both portals let the builder or the client approve a change order or ask for a
// revision. The decision, the notification and the history entry are written by
// the approveExtra and rejectExtra Cloud Functions, so the portals call those
// two helpers and write nothing else themselves. Everything that would reach
// Firebase is replaced: the helpers module records each call, and the three
// writers the portals used to call are there as spies to prove they stay unused.
//
// Nothing in the console is muted for the whole file. Each portal shows Brand, which asks
// the server whether the logo files exist and takes the answer a moment later: that answer
// is stubbed to arrive at once, and every render is wrapped in act() so the update it causes
// is part of the render. The one line a portal logs when a decision fails is expected by the
// tests that make one fail, which check it was logged (failWith), and by no other.
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
    log: '[Client]',
    async open() {
      await act(async () => {
        render(
          <ToastContext.Provider value={mocks.toast}>
            <ClientPortal clientName="Lee Homes" userName="Dana Lee" />
          </ToastContext.Provider>,
        )
      })
      fireEvent.click(screen.getAllByRole('button', { name: /Approvals/ })[0])
    },
    approveButton: /^Approve$/,
  },
  {
    name: 'QBSBuilderPortal',
    log: '[QBS]',
    async open() {
      await act(async () => {
        render(
          <ToastContext.Provider value={mocks.toast}>
            <QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />
          </ToastContext.Provider>,
        )
      })
      fireEvent.click(screen.getAllByRole('button', { name: /Extras/ })[0])
      // The Extras tab opens on the Pending filter; the other states are one click away.
    },
    approveButton: /Approve change order/,
  },
]

beforeEach(() => {
  // Brand asks the server whether the logo files exist. Here they do not, and the answer
  // comes at once, so the portals show the placeholder mark without reaching a network.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, headers: { get: () => null } })))
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
  vi.unstubAllGlobals()
})

// Makes a decision fail. A portal logs a failed call before it shows the message, so a test
// that makes one fail swallows exactly that line and gets the spy back to check it was
// logged. Anything else sent to console.error, a React warning included, goes on to the real
// console and shows up in the output.
const LOGGED_FAILURE = /^\[(Client|QBS)\] (Approve|Reject) failed:$/
function failWith(mock, error, { once = false } = {}) {
  const real = console.error
  const logged = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (!LOGGED_FAILURE.test(String(args[0]))) real(...args)
  })
  if (once) mock.mockRejectedValueOnce(error)
  else mock.mockRejectedValue(error)
  return logged
}

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
    ])('offers Approve and Request revision for status %s', async (status) => {
      mocks.data.extras = [extra({ status })]
      await portal.open()
      expect(screen.getByRole('button', { name: portal.approveButton })).toBeTruthy()
      expect(requestRevision()).toBeTruthy()
    })

    it.each([['Approved'], ['approved'], ['Rejected'], ['rejected']])('offers no decision for status %s', async (status) => {
      mocks.data.extras = [extra({ status })]
      await portal.open()
      // The Pending filter of the builder portal hides decided ones; open All.
      const all = screen.queryByRole('button', { name: /^All/ })
      if (all) fireEvent.click(all)
      expect(screen.queryByRole('button', { name: portal.approveButton })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Request revision' })).toBeNull()
    })

    it('never shows a draft, which has not been sent', async () => {
      mocks.data.extras = [extra({ status: 'Draft', desc: 'Not sent yet', id: 'CO-009', _docId: 'x9' })]
      await portal.open()
      const all = screen.queryByRole('button', { name: /^All/ })
      if (all) fireEvent.click(all)
      expect(screen.queryByText('Not sent yet')).toBeNull()
      expect(screen.queryByRole('button', { name: portal.approveButton })).toBeNull()
    })

    it('shows a sent change order next to a draft without the draft', async () => {
      mocks.data.extras = [
        extra({ desc: 'Sent one' }),
        extra({ status: 'Draft', desc: 'Draft one', id: 'CO-009', _docId: 'x9' }),
      ]
      await portal.open()
      expect(screen.getByText('Sent one')).toBeTruthy()
      expect(screen.queryByText('Draft one')).toBeNull()
    })
  })

  describe('approving', () => {
    it('calls approveExtra with the document id and the total it shows, and writes nothing else from the browser', async () => {
      mocks.data.extras = [extra()]
      await portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await waitFor(() => expect(mocks.approveExtra).toHaveBeenCalledTimes(1))
      expect(mocks.approveExtra).toHaveBeenCalledWith('x1', 4100)
      noOtherWriters()
      expect(mocks.rejectExtra).not.toHaveBeenCalled()
    })

    // The function refuses a decision at a total other than the stored one, which is
    // total, else amount, else 0, so the portal shows and sends exactly that.
    it.each([
      ['its total over its amount', { total: 4200, amount: 4100 }, 4200, '$4,200'],
      ['0 when it has neither', { amount: undefined }, 0, '$0'],
    ])('shows and sends %s', async (_label, over, expectedTotal, shown) => {
      mocks.data.extras = [extra(over)]
      await portal.open()
      expect(screen.getAllByText(shown).length).toBeGreaterThan(0)
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await waitFor(() => expect(mocks.approveExtra).toHaveBeenCalledWith('x1', expectedTotal))
    })

    it('shows the sentence the function wrote when it refuses, and logs the error', async () => {
      const refusal = sdkError('failed-precondition', 'This change order has already been decided.')
      const logged = failWith(mocks.approveExtra, refusal)
      mocks.data.extras = [extra()]
      await portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(await screen.findByText('This change order has already been decided.')).toBeTruthy()
      expect(logged).toHaveBeenCalledWith(`${portal.log} Approve failed:`, refusal)
      noOtherWriters()
    })

    it('shows the permission message to someone who may not act on it', async () => {
      const refusal = sdkError('permission-denied', 'You can only act on change orders for your own projects.')
      const logged = failWith(mocks.approveExtra, refusal)
      mocks.data.extras = [extra()]
      await portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(await screen.findByText('You can only act on change orders for your own projects.')).toBeTruthy()
      expect(logged).toHaveBeenCalledWith(`${portal.log} Approve failed:`, refusal)
    })

    it('shows a plain message when no reply came back, not the bare code', async () => {
      const failure = sdkError('internal', 'internal')
      const logged = failWith(mocks.approveExtra, failure)
      mocks.data.extras = [extra()]
      await portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(await screen.findByText('Could not save approval. Check your connection and try again.')).toBeTruthy()
      expect(screen.queryByText('internal')).toBeNull()
      expect(logged).toHaveBeenCalledWith(`${portal.log} Approve failed:`, failure)
    })

    it('lets the person try again after a failure', async () => {
      const logged = failWith(mocks.approveExtra, sdkError('internal', 'internal'), { once: true })
      mocks.data.extras = [extra()]
      await portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await screen.findByText('Could not save approval. Check your connection and try again.')
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      await waitFor(() => expect(mocks.approveExtra).toHaveBeenCalledTimes(2))
      expect(logged).toHaveBeenCalledTimes(1)
    })

    it('refuses to call the function for a change order with no document id, and says so without a dash', async () => {
      mocks.data.extras = [extra({ _docId: undefined })]
      await portal.open()
      fireEvent.click(screen.getByRole('button', { name: portal.approveButton }))
      expect(mocks.approveExtra).not.toHaveBeenCalled()
      expect(screen.getByText('This change order is missing an ID. Refresh and try again.')).toBeTruthy()
    })
  })

  describe('asking for a revision', () => {
    const open = async () => {
      mocks.data.extras = [extra()]
      await portal.open()
      fireEvent.click(requestRevision())
      return screen.getByPlaceholderText('What should be revised? (required)')
    }
    const send = () => screen.getByRole('button', { name: 'Send revision request' })

    it('needs a note before it can be sent', async () => {
      const note = await open()
      expect(send().disabled).toBe(true)
      fireEvent.change(note, { target: { value: '   ' } })
      expect(send().disabled).toBe(true)
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      expect(send().disabled).toBe(false)
    })

    it('stops a note at the 1000 characters the function accepts', async () => {
      expect((await open()).getAttribute('maxlength')).toBe('1000')
    })

    it('calls rejectExtra with the document id, the trimmed note and the total it shows, and writes nothing else', async () => {
      const note = await open()
      fireEvent.change(note, { target: { value: '  Use the 200A panel  ' } })
      fireEvent.click(send())
      await waitFor(() => expect(mocks.rejectExtra).toHaveBeenCalledTimes(1))
      expect(mocks.rejectExtra).toHaveBeenCalledWith('x1', 'Use the 200A panel', 4100)
      noOtherWriters()
      expect(mocks.approveExtra).not.toHaveBeenCalled()
    })

    it('sends the total over the amount with a revision request too', async () => {
      mocks.data.extras = [extra({ total: 4200 })]
      await portal.open()
      fireEvent.click(requestRevision())
      fireEvent.change(screen.getByPlaceholderText('What should be revised? (required)'), { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      await waitFor(() => expect(mocks.rejectExtra).toHaveBeenCalledWith('x1', 'Use the 200A panel', 4200))
    })

    it('closes the form once the function has accepted it', async () => {
      const note = await open()
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      await waitFor(() => expect(screen.queryByPlaceholderText('What should be revised? (required)')).toBeNull())
    })

    it('keeps the form and the note, and shows the message, when the function refuses', async () => {
      const refusal = sdkError('failed-precondition', 'This change order has already been decided.')
      const logged = failWith(mocks.rejectExtra, refusal)
      const note = await open()
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      expect(await screen.findByText('This change order has already been decided.')).toBeTruthy()
      expect(screen.getByPlaceholderText('What should be revised? (required)').value).toBe('Use the 200A panel')
      expect(logged).toHaveBeenCalledWith(`${portal.log} Reject failed:`, refusal)
      noOtherWriters()
    })

    it('shows a plain message when no reply came back', async () => {
      const failure = sdkError('internal', 'internal')
      const logged = failWith(mocks.rejectExtra, failure)
      const note = await open()
      fireEvent.change(note, { target: { value: 'Use the 200A panel' } })
      fireEvent.click(send())
      const message = await screen.findByText(/Check your connection and try again\./)
      expect(message.textContent).not.toBe('internal')
      expect(logged).toHaveBeenCalledWith(`${portal.log} Reject failed:`, failure)
    })
  })
})

describe('ClientPortal', () => {
  it('thanks the client with a toast when an approval goes through, as before', async () => {
    mocks.data.extras = [extra()]
    await PORTALS[0].open()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Change order approved', description: 'CO-004 · $4,100' })
  })

  it('tells the client the revision request went through', async () => {
    mocks.data.extras = [extra()]
    await PORTALS[0].open()
    fireEvent.click(requestRevision())
    fireEvent.change(screen.getByPlaceholderText('What should be revised? (required)'), { target: { value: 'Use the 200A panel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send revision request' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'info', title: 'Revision requested', description: 'P2 has been notified about CO-004.' })
  })

  it('does not toast a failed approval', async () => {
    const failure = sdkError('internal', 'internal')
    const logged = failWith(mocks.approveExtra, failure)
    mocks.data.extras = [extra()]
    await PORTALS[0].open()
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }))
    await screen.findByText(/Check your connection/)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledWith('[Client] Approve failed:', failure)
  })

  it('counts a change order as awaiting approval in either casing, and leaves out drafts and decided ones', async () => {
    mocks.data.extras = [
      extra({ _docId: 'a', id: 'CO-001', status: 'Sent to Builder' }),
      extra({ _docId: 'b', id: 'CO-002', status: 'pending' }),
      extra({ _docId: 'c', id: 'CO-003', status: 'Draft' }),
      extra({ _docId: 'd', id: 'CO-005', status: 'Approved' }),
      extra({ _docId: 'e', id: 'CO-006', status: 'rejected' }),
    ]
    await act(async () => {
      render(<ToastContext.Provider value={mocks.toast}><ClientPortal clientName="Lee Homes" userName="Dana Lee" /></ToastContext.Provider>)
    })
    const tile = screen.getByText('Awaiting approval').closest('div').parentElement
    expect(within(tile).getByText('2')).toBeTruthy()
  })
})

describe('QBSBuilderPortal', () => {
  it('lists a change order under its decided state however the status is spelled', async () => {
    mocks.data.extras = [
      extra({ _docId: 'a', id: 'CO-001', desc: 'Pending Title Case', status: 'Sent to Builder' }),
      extra({ _docId: 'b', id: 'CO-002', desc: 'Approved Title Case', status: 'Approved' }),
      extra({ _docId: 'c', id: 'CO-003', desc: 'Approved lower case', status: 'approved' }),
      extra({ _docId: 'd', id: 'CO-005', desc: 'Rejected Title Case', status: 'Rejected' }),
      extra({ _docId: 'e', id: 'CO-006', desc: 'Draft one', status: 'Draft' }),
    ]
    await PORTALS[1].open()
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

  it('counts the filters by state, with no draft in All', async () => {
    mocks.data.extras = [
      extra({ _docId: 'a', id: 'CO-001', status: 'Sent to Builder' }),
      extra({ _docId: 'b', id: 'CO-002', status: 'pending' }),
      extra({ _docId: 'c', id: 'CO-003', status: 'Approved' }),
      extra({ _docId: 'd', id: 'CO-005', status: 'approved' }),
      extra({ _docId: 'e', id: 'CO-006', status: 'Rejected' }),
      extra({ _docId: 'f', id: 'CO-007', status: 'Draft' }),
    ]
    await PORTALS[1].open()
    expect(screen.getByRole('button', { name: /^Pending/ }).textContent).toBe('Pending2')
    expect(screen.getByRole('button', { name: /^Approved/ }).textContent).toBe('Approved2')
    expect(screen.getByRole('button', { name: /^Rejected/ }).textContent).toBe('Rejected1')
    expect(screen.getByRole('button', { name: /^All/ }).textContent).toBe('All5')
  })
})

// Both portals say where a change order stands in the words every screen uses
// (src/lib/status.js), so the office and the builder read the same status. What
// the viewer is asked to do is said elsewhere on the row. A change order that
// waits for the viewer's decision is a warning in the portals, because the next
// step is theirs; a decided one has the tone of the vocabulary.
describe.each(PORTALS)('$name status pill', (portal) => {
  const rgb = (tone) => `rgb(${hexToRgb(TONE_HEX[tone]).join(', ')})`

  it.each([
    ['Sent to Builder', 'Sent to builder', 'warning'],
    ['pending', 'Sent to builder', 'warning'],
    [undefined, 'Sent to builder', 'warning'],
    ['Approved', 'Approved', 'success'],
    ['approved', 'Approved', 'success'],
    ['Rejected', 'Rejected', 'critical'],
    ['rejected', 'Rejected', 'critical'],
  ])('shows status %s as %s in the %s tone', async (status, words, tone) => {
    mocks.data.extras = [extra({ status })]
    await portal.open()
    const all = screen.queryByRole('button', { name: /^All/ })
    if (all) fireEvent.click(all)
    // The pill sits on the line with the change order number.
    const pill = within(screen.getByText('CO-004').parentElement).getByText(words)
    expect(pill.style.color).toBe(rgb(tone))
  })
})
