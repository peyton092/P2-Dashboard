import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'

// The portals receive only what their queries and the rules allow. With no
// project they say so in a labelled empty state, and a submission they create
// carries the signed in user's own scope, which the rules check on create.
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

// What Firestore throws when the rules refuse a write, as the browser SDK reports it
// with no sentence of its own.
const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' })
const REFUSED_TOAST = { tone: 'error', title: 'Could not send your message. Try again.' }

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
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.data = portalData(BUILDER, { jobs: [JOB] })
    mocks.addSubmit.mockRejectedValue(refused())
    await sendMessage()
    expect(mocks.toast).toHaveBeenCalledWith(REFUSED_TOAST)
    expect(screen.getByPlaceholderText('Brief summary').value).toBe('Panel location')
    expect(screen.getByRole('button', { name: 'Send to P2' }).disabled).toBe(false)
  })
})
