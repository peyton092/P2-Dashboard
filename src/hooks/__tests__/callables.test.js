import { describe, it, expect, vi, beforeEach } from 'vitest'

// Approvals, inspection results and new jobs are decided by Cloud Functions that
// check the caller's role. The browser helpers only call them: if the call
// fails the error reaches the caller, and nothing is written to Firestore
// instead (the old helpers fell back to doing the write from the browser).
const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  call: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  functions: { name: 'the-functions' },
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path: path.join('/') }),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: mocks.addDoc,
  updateDoc: mocks.updateDoc,
  setDoc: mocks.setDoc,
  serverTimestamp: vi.fn(),
  onSnapshot: vi.fn(),
}))
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }))
vi.mock('../../firebase', () => ({ db: {}, functions: mocks.functions, auth: { currentUser: { uid: 'u1', email: 'a@b.co' } } }))

import * as store from '../useFirestore'

beforeEach(() => {
  mocks.httpsCallable.mockReset().mockReturnValue(mocks.call)
  mocks.call.mockReset().mockResolvedValue({ data: { ok: true } })
  mocks.addDoc.mockReset()
  mocks.updateDoc.mockReset()
  mocks.setDoc.mockReset()
})

const JOB = { id: 'QBS-045', address: '123 Main St', client: 'Dana Lee', tenantId: 'qbs', subs: { electrical: null } }

// [helper, arguments, the callable it calls, what it sends]
const HELPERS = [
  ['sendExtraToBuilder', ['x1'], 'sendExtraToBuilder', { extraId: 'x1' }],
  ['approveExtra', ['x1'], 'approveExtra', { extraId: 'x1' }],
  ['approveExtra', ['x1', 4100], 'approveExtra', { extraId: 'x1', expectedTotal: 4100 }],
  ['approveExtra', ['x1', 0], 'approveExtra', { extraId: 'x1', expectedTotal: 0 }],
  ['rejectExtra', ['x1', 'Use the 200A panel'], 'rejectExtra', { extraId: 'x1', note: 'Use the 200A panel' }],
  ['rejectExtra', ['x1', 'Use the 200A panel', 4100], 'rejectExtra', { extraId: 'x1', note: 'Use the 200A panel', expectedTotal: 4100 }],
  ['passInspection', ['job1', 'electrical', 'roughIn'], 'passInspection', { jobDocId: 'job1', trade: 'electrical', phase: 'roughIn' }],
  ['failInspection', ['job1', 'hvac', 'final'], 'failInspection', { jobDocId: 'job1', trade: 'hvac', phase: 'final' }],
  ['createJob', [JOB], 'createJob', JOB],
]

describe.each(HELPERS)('%s(%j)', (helper, args, callable, payload) => {
  it(`calls ${callable} on the app's functions with the right payload`, async () => {
    await store[helper](...args)
    expect(mocks.httpsCallable).toHaveBeenCalledTimes(1)
    expect(mocks.httpsCallable).toHaveBeenCalledWith(mocks.functions, callable)
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith(payload)
  })

  it('returns what the function answered', async () => {
    mocks.call.mockResolvedValue({ data: { ok: true, docId: 'new1' } })
    await expect(store[helper](...args)).resolves.toEqual({ ok: true, docId: 'new1' })
  })

  it('rethrows the error of the function and writes nothing to Firestore itself', async () => {
    const failure = Object.assign(new Error('You can only act on change orders for your own projects.'), { code: 'functions/permission-denied' })
    mocks.call.mockRejectedValue(failure)
    await expect(store[helper](...args)).rejects.toBe(failure)
    expect(mocks.addDoc).not.toHaveBeenCalled()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.setDoc).not.toHaveBeenCalled()
  })

  it('does not fall back when the function cannot be reached either', async () => {
    mocks.call.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }))
    await expect(store[helper](...args)).rejects.toThrow('internal')
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.addDoc).not.toHaveBeenCalled()
  })
})

describe('the helpers keep their shape', () => {
  it('sends a plain approval with nothing but the id, and no expectedTotal key when none is given', async () => {
    await store.approveExtra('x1')
    expect(Object.keys(mocks.call.mock.calls[0][0])).toEqual(['extraId'])
    await store.rejectExtra('x1', 'Use the 200A panel')
    expect(Object.keys(mocks.call.mock.calls[1][0])).toEqual(['extraId', 'note'])
  })

  it('names the job by its document id, under jobDocId, not jobId', async () => {
    await store.passInspection('job1', 'plumbing', 'final')
    const payload = mocks.call.mock.calls[0][0]
    expect(payload.jobDocId).toBe('job1')
    expect('jobId' in payload).toBe(false)
  })

  it('has the name sendExtraToBuilder, and no sendExtraToQBS', () => {
    expect(typeof store.sendExtraToBuilder).toBe('function')
    expect(store.sendExtraToQBS).toBeUndefined()
  })

  it('does not decide anything itself when called with nothing', async () => {
    mocks.call.mockRejectedValue(new Error('Choose a change order.'))
    await expect(store.approveExtra()).rejects.toThrow('Choose a change order.')
    expect(mocks.updateDoc).not.toHaveBeenCalled()
  })
})
