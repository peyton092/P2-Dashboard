import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'
import { toneText } from '@/lib/status'

// The portals receive only what their queries and the rules allow. With no
// project they say so in a labelled empty state, and a submission they create
// carries the signed in user's own scope, which the rules check on create. The
// builder portal also shows how it marks each inspection result on a job card.
// Everything that would reach Firebase is replaced, and addSubmit records what
// each portal asked to create.
const mocks = vi.hoisted(() => ({
  data: null,
  addSubmit: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ auth: {}, storage: {}, db: {}, functions: {} }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
// Brand looks for logo files over the network when it mounts; these tests are
// about the projects and the submissions, so it gets a stand in that renders nothing.
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
  addSubmitReply: vi.fn(),
  updateSubmit: vi.fn(),
  addJobFile: vi.fn(),
  updateNotification: vi.fn(),
}))

import ClientPortal from '../ClientPortal'
import QBSBuilderPortal from '../QBSBuilderPortal'

const NO_PROJECTS = 'No projects are linked to your account yet. Contact P2 if you expected to see one here.'

const CLIENT = { role: 'client', tenantId: null, uid: 'c1' }
const BUILDER = { role: 'builder', tenantId: 'qbs', uid: 'b1' }

const JOB = {
  id: 'QBS-003',
  _docId: 'job3',
  name: 'Lee Residence',
  client: 'Dana Lee',
  address: '123 Main St',
  status: 'active',
  tenantId: 'qbs',
  qbsPM: 'Taylor Hensley',
  insp: {},
}

// What the data provider gives a portal: the scoped collections and who is signed in.
const portalData = (scope, over = {}) => ({
  jobs: [],
  extras: [],
  submits: [],
  notifs: [],
  loading: false,
  error: null,
  role: scope.role,
  tenantId: scope.tenantId,
  uid: scope.uid,
  scope,
  ...over,
})

const openClientPortal = () => render(
  <ToastContext.Provider value={mocks.toast}>
    <ClientPortal clientName="Lee Homes" userName="Dana Lee" />
  </ToastContext.Provider>,
)

const openBuilderPortal = () => render(
  <ToastContext.Provider value={mocks.toast}>
    <QBSBuilderPortal tenantName="QBS" userName="Taylor Hensley" />
  </ToastContext.Provider>,
)

// A real pointer moves over an option before it clicks, and the option ignores a click until then.
async function choose(trigger, optionName) {
  await act(async () => { fireEvent.mouseDown(trigger) })
  const option = await screen.findByRole('option', { name: optionName })
  await act(async () => { fireEvent.mouseMove(option) })
  await act(async () => { fireEvent.click(option) })
}

beforeEach(() => {
  mocks.addSubmit.mockReset().mockResolvedValue(undefined)
  mocks.toast.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// What Firestore throws when the rules refuse a write, as the browser SDK reports it:
// the code permission-denied with the sentence "Missing or insufficient permissions.",
// which is written for developers. callableMessage gives that code a plain sentence of
// its own, so the toast says what failed and, under it, that sentence.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
const REFUSED_TOAST = {
  tone: 'error',
  title: 'Could not send your message. Try again.',
  description: 'You do not have permission to do that.',
}

describe('a portal with no projects', () => {
  it('the client portal says that none are linked to the account yet', () => {
    mocks.data = portalData(CLIENT)
    openClientPortal()
    expect(screen.getByText('No projects yet')).toBeTruthy()
    expect(screen.getByText(NO_PROJECTS)).toBeTruthy()
  })

  it('the builder portal says the same when it shows all projects', () => {
    mocks.data = portalData(BUILDER)
    openBuilderPortal()
    expect(screen.getByText('No projects yet')).toBeTruthy()
    expect(screen.getByText(NO_PROJECTS)).toBeTruthy()
  })
})

describe('a submission created in the client portal', () => {
  async function sendMessage() {
    openClientPortal()
    fireEvent.click(screen.getAllByRole('button', { name: /Messages/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /New message/ }))
    const project = screen.getAllByRole('combobox').find(el => /Select a project/.test(el.textContent))
    await choose(project, /QBS-003/)
    fireEvent.change(screen.getByPlaceholderText('Brief summary'), { target: { value: 'Gate code' } })
    fireEvent.change(screen.getByPlaceholderText('How can P2 help?'), { target: { value: 'What is the gate code?' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to P2' })) })
    expect(mocks.addSubmit).toHaveBeenCalledTimes(1)
    return mocks.addSubmit.mock.calls[0][0]
  }

  // The rules refuse a tenant on a client's submission; the stamping trigger gives it
  // the tenant of its job.
  it('names the job, lists only the client, and carries no tenant', async () => {
    mocks.data = portalData(CLIENT, { jobs: [JOB] })
    const sent = await sendMessage()
    expect(sent).toMatchObject({ jobId: 'QBS-003', clientUids: ['c1'] })
    expect('tenantId' in sent).toBe(false)
  })

  it('says so when the message is refused, and leaves the form ready to send again', async () => {
    mocks.data = portalData(CLIENT, { jobs: [JOB] })
    mocks.addSubmit.mockRejectedValue(refused())
    await sendMessage()
    expect(mocks.toast).toHaveBeenCalledWith(REFUSED_TOAST)
    expect(screen.getByPlaceholderText('Brief summary').value).toBe('Gate code')
    expect(screen.getByRole('button', { name: 'Send to P2' }).disabled).toBe(false)
  })
})

describe('a submission created in the builder portal', () => {
  async function sendMessage() {
    openBuilderPortal()
    fireEvent.click(screen.getAllByRole('button', { name: /Submit/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /New message/ }))
    fireEvent.change(screen.getByPlaceholderText('Brief summary'), { target: { value: 'Panel location' } })
    fireEvent.change(screen.getByPlaceholderText('Describe in detail…'), { target: { value: 'Where does the panel go?' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to P2' })) })
    expect(mocks.addSubmit).toHaveBeenCalledTimes(1)
    return mocks.addSubmit.mock.calls[0][0]
  }

  it('carries the builder\'s tenant and lists no client', async () => {
    mocks.data = portalData(BUILDER, { jobs: [JOB] })
    expect(await sendMessage()).toMatchObject({ jobId: null, tenantId: 'qbs', clientUids: [] })
  })

  it('says so when the message is refused, and leaves the form ready to send again', async () => {
    mocks.data = portalData(BUILDER, { jobs: [JOB] })
    mocks.addSubmit.mockRejectedValue(refused())
    await sendMessage()
    expect(mocks.toast).toHaveBeenCalledWith(REFUSED_TOAST)
    expect(screen.getByPlaceholderText('Brief summary').value).toBe('Panel location')
    expect(screen.getByRole('button', { name: 'Send to P2' }).disabled).toBe(false)
  })
})

// Each phase of a trade is one mark on the job card. A result that is in gets its
// letter in a circle of the status color, a result not in yet gets a dot in a
// circle, and a phase that does not apply gets plain text in its own status color
// and no circle. What a mark means is always in its letter or its words, never in
// its color alone.
describe('the inspection marks on a job card in the builder portal', () => {
  const rgb = (tone) => `rgb(${hexToRgb(TONE_HEX[tone]).join(', ')})`
  // The letters of a mark are 8 pixels, so they are in the text color of the tone.
  const textRgb = (tone) => `rgb(${hexToRgb(toneText(tone)).join(', ')})`
  const insp = {
    electrical: { roughIn: 'blocked', final: 'n/a' },
    plumbing: { roughIn: 'pending', final: 'passed' },
  }
  const trade = (name) => within(screen.getByText(name, { selector: 'p' }).parentElement)

  it('reads B for a blocked result and plain n/a, with no circle, for a phase that does not apply', () => {
    mocks.data = portalData(BUILDER, { jobs: [{ ...JOB, insp }] })
    openBuilderPortal()

    const blocked = trade('electrical').getByText('B')
    expect(blocked.className).toContain('rounded-full')
    expect(blocked.style.color).toBe(textRgb('info'))

    const notApplicable = trade('electrical').getByText('n/a')
    expect(notApplicable.className).not.toContain('rounded-full')
    expect(notApplicable.style.backgroundColor).toBe('')
    // The color is the one status.js gives n/a, the neutral token, and not the dimmer
    // mute gray that a result not in yet is drawn in.
    expect(notApplicable.style.color).toBe(rgb('neutral'))
    expect(notApplicable.style.color).not.toBe(rgb('mute'))

    // The other trade: a result not in yet is a dot in a circle, a passed one a P.
    const circles = [...screen.getByText('plumbing', { selector: 'p' }).parentElement.querySelectorAll('.rounded-full')]
    expect(circles.map((circle) => circle.textContent)).toEqual(['\u00b7', 'P'])
  })

  // A letter, or a dot for a result not in yet, says little on its own, so each mark is a
  // picture named by the words of its status, which a pointer also shows as a title. The dot
  // and the letters are 8 pixels, so they are in the text color, and a dot not in yet is in
  // the neutral gray and not the dimmer mute.
  it('names each mark by the words of its status, and sets a result not in yet in the neutral gray', () => {
    mocks.data = portalData(BUILDER, { jobs: [{ ...JOB, insp }] })
    openBuilderPortal()

    const plumbing = within(screen.getByText('plumbing', { selector: 'p' }).parentElement)
    const marks = plumbing.getAllByRole('img')
    expect(marks.map((mark) => mark.getAttribute('aria-label'))).toEqual(['Pending', 'Passed'])
    expect(marks.map((mark) => mark.getAttribute('title'))).toEqual(['Pending', 'Passed'])
    expect(marks[0].style.color).toBe(textRgb('neutral'))
    expect(trade('electrical').getByRole('img', { name: 'Blocked' }).textContent).toBe('B')
  })
})
