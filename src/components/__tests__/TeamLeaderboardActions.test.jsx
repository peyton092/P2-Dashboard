import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { logError } from '@/lib/errorLogger'

// The leaderboard logs a referral, awards a bonus and saves the Google review link. Each
// of those tells the person how it ended, and its panel closes only when its write went
// through. Everything that would reach Firebase is replaced: the six crew documents are
// there from the start, so the screen does not create them, and the writes are spies.
const mocks = vi.hoisted(() => ({
  scores: {},
  missing: new Set(),
  // What each crew member's listener can be made to hear again, as { id, hear }.
  listeners: [],
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDoc: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  onSnapshot: (ref, next) => {
    const id = ref.path.split('/')[1]
    const hear = () => next({ exists: () => !mocks.missing.has(id), data: () => mocks.scores[id] })
    mocks.listeners.push({ id, hear })
    hear()
    return () => {}
  },
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
  getDoc: mocks.getDoc,
  serverTimestamp: () => 'SERVER_TIME',
}))
vi.mock('../../hooks/useFirestore', () => ({ useDailyReports: () => ({ dailyReports: [], loading: false }) }))
vi.mock('../../use-data', () => ({ useData: () => ({ scope: { role: 'owner' } }) }))
// The chip in the header asks this hook for the connection. What it says is not what this
// file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import TeamLeaderboard from '../TeamLeaderboard'

// What Firestore throws when the rules refuse a write.
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

const crew = (name, over) => ({ name, id: name.toLowerCase(), googleReviews: 0, referrals: 0, bonusPoints: 0, bonusNote: '', ...over })

beforeEach(() => {
  for (const mock of [mocks.setDoc, mocks.updateDoc, mocks.getDoc, mocks.toast]) mock.mockReset()
  vi.mocked(logError).mockClear()
  mocks.missing = new Set()
  mocks.listeners = []
  mocks.scores = Object.fromEntries(['Austin', 'Tony', 'Marvin', 'Trent', 'Ty', 'Trevor'].map((name) => [name.toLowerCase(), crew(name)]))
  // Austin is ahead, so his card is the first.
  mocks.scores.austin = crew('Austin', { referrals: 2, bonusPoints: 10, bonusNote: 'Safety lead' })
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ url: 'https://g.page/r/old/review' }) })
})

afterEach(cleanup)

const open = async () => {
  await act(async () => { render(<ToastContext.Provider value={mocks.toast}><TeamLeaderboard /></ToastContext.Provider>) })
}
const toastCalls = () => mocks.toast.mock.calls.map(([opts]) => opts)
const press = (el) => act(async () => { fireEvent.click(el) })

// Opening the board creates the crew score of a person who has none. Nobody pressed anything,
// so a refusal is not a toast: it goes to the error log, and the board opens without waiting
// for it. It used to be a rejection nobody handled, which left the board on its spinner.
describe('a crew score that is not there yet', () => {
  it('creates it with nothing counted, and says nothing', async () => {
    mocks.missing = new Set(['trevor'])
    await open()

    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    const [ref, data] = mocks.setDoc.mock.calls[0]
    expect(ref.path).toBe('crew_scores/trevor')
    expect(data).toMatchObject({ name: 'Trevor', id: 'trevor', role: expect.any(String), googleReviews: 0, referrals: 0, bonusPoints: 0, bonusNote: '' })
    expect(toastCalls()).toEqual([])
    expect(logError).not.toHaveBeenCalled()
  })

  it('puts a refusal in the error log, shows no toast, and still opens the board', async () => {
    mocks.missing = new Set(['trevor'])
    const failure = refused()
    mocks.setDoc.mockRejectedValue(failure)
    await open()

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(failure, 'crew score seed')
    expect(toastCalls()).toEqual([])
    expect(screen.getAllByTitle('+Referral').length).toBeGreaterThan(0)
  })
})

// A write is applied to the local cache at once and rolled back when the rules refuse it, so
// the listener hears that the document is missing again. Writing it again for that would be
// refused, rolled back, heard and written again, once for every round trip to the server, and
// every refusal puts a line in the error log.
describe('a crew score that the listener hears missing again', () => {
  const hearAgain = (id) => act(async () => { mocks.listeners.filter((l) => l.id === id).forEach((l) => l.hear()) })

  it('is written once when the rules refuse it, and the refusal is logged once', async () => {
    mocks.missing = new Set(['trevor'])
    const failure = refused()
    mocks.setDoc.mockRejectedValue(failure)
    await open()
    expect(mocks.setDoc).toHaveBeenCalledTimes(1)

    await hearAgain('trevor')
    await hearAgain('trevor')

    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(failure, 'crew score seed')
    expect(toastCalls()).toEqual([])
    expect(screen.getAllByTitle('+Referral').length).toBeGreaterThan(0)
  })

  it('is written once for each crew member that is missing', async () => {
    mocks.missing = new Set(['trevor', 'ty'])
    mocks.setDoc.mockRejectedValue(refused())
    await open()

    await act(async () => { mocks.listeners.forEach((l) => l.hear()) })

    expect(mocks.setDoc.mock.calls.map(([ref]) => ref.path).sort()).toEqual(['crew_scores/trevor', 'crew_scores/ty'])
    expect(logError).toHaveBeenCalledTimes(2)
  })

  it('is written once when the first write went through', async () => {
    mocks.missing = new Set(['trevor'])
    await open()

    await hearAgain('trevor')

    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it('is tried again by a board that is opened afresh', async () => {
    mocks.missing = new Set(['trevor'])
    mocks.setDoc.mockRejectedValue(refused())
    await open()
    cleanup()

    await open()

    expect(mocks.setDoc).toHaveBeenCalledTimes(2)
  })
})

describe('logging a referral', () => {
  const start = async () => {
    await open()
    fireEvent.click(screen.getAllByTitle('+Referral')[0])
  }

  it('writes one more referral for the person, says so, and closes the panel', async () => {
    await start()
    await press(screen.getByRole('button', { name: 'Confirm' }))

    expect(mocks.updateDoc).toHaveBeenCalledTimes(1)
    const [ref, patch] = mocks.updateDoc.mock.calls[0]
    expect(ref.path).toBe('crew_scores/austin')
    expect(patch).toEqual({ referrals: 3, updatedAt: 'SERVER_TIME' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Referral logged for Austin.' }])
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })

  it('keeps the panel open, and says why, when the write is refused', async () => {
    mocks.updateDoc.mockRejectedValue(refused())
    await start()
    await press(screen.getByRole('button', { name: 'Confirm' }))

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not log the referral for Austin. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
  })
})

describe('awarding a bonus', () => {
  const start = async (points = '25', reason = 'Stayed late') => {
    await open()
    fireEvent.click(screen.getAllByTitle('+Bonus')[0])
    fireEvent.change(screen.getByPlaceholderText('pts'), { target: { value: points } })
    fireEvent.change(screen.getByPlaceholderText('Reason (optional)'), { target: { value: reason } })
  }

  it('adds the points and the reason, says how many, and closes the panel', async () => {
    await start()
    await press(screen.getByRole('button', { name: 'Award Bonus' }))

    const [ref, patch] = mocks.updateDoc.mock.calls[0]
    expect(ref.path).toBe('crew_scores/austin')
    expect(patch).toEqual({ bonusPoints: 35, bonusNote: 'Stayed late', updatedAt: 'SERVER_TIME' })
    expect(toastCalls()).toEqual([{ tone: 'success', title: '25 bonus points awarded to Austin.' }])
    expect(screen.queryByRole('button', { name: 'Award Bonus' })).toBeNull()
  })

  it('says one point in the singular', async () => {
    await start('1', '')
    await press(screen.getByRole('button', { name: 'Award Bonus' }))
    expect(toastCalls()).toEqual([{ tone: 'success', title: '1 bonus point awarded to Austin.' }])
    expect('bonusNote' in mocks.updateDoc.mock.calls[0][1]).toBe(false)
  })

  it('says points taken away when the number is negative, with no minus sign in the words', async () => {
    await start('-10', 'Wrong job')
    await press(screen.getByRole('button', { name: 'Award Bonus' }))

    expect(mocks.updateDoc.mock.calls[0][1]).toMatchObject({ bonusPoints: 0 })
    expect(toastCalls()).toEqual([{ tone: 'success', title: '10 bonus points taken from Austin.' }])
  })

  it('does nothing with no points', async () => {
    await start('', 'Nothing')
    await press(screen.getByRole('button', { name: 'Award Bonus' }))

    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Award Bonus' })).toBeTruthy()
  })

  it('keeps the panel and what was typed, and says why, when the write is refused', async () => {
    mocks.updateDoc.mockRejectedValue(refused())
    await start()
    await press(screen.getByRole('button', { name: 'Award Bonus' }))

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not award the bonus to Austin. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(screen.getByPlaceholderText('pts').value).toBe('25')
    expect(screen.getByPlaceholderText('Reason (optional)').value).toBe('Stayed late')
  })
})

describe('saving the Google review link', () => {
  const link = () => screen.getByPlaceholderText('https://g.page/r/YOUR_PLACE_ID/review')
  const start = async () => {
    await open()
    fireEvent.click(screen.getByTitle('Configure Google Review URL'))
    fireEvent.change(link(), { target: { value: '  https://g.page/r/new/review  ' } })
  }
  const save = () => screen.getByRole('button', { name: /^(Save|Saving…)$/ })

  it('saves the trimmed link, says so, and closes the panel', async () => {
    await start()
    await press(save())

    const [ref, data, options] = mocks.setDoc.mock.calls[0]
    expect(ref.path).toBe('app_settings/google_review')
    expect(data).toEqual({ url: 'https://g.page/r/new/review', updatedAt: 'SERVER_TIME' })
    expect(options).toEqual({ merge: true })
    expect(toastCalls()).toEqual([{ tone: 'success', title: 'Review link saved.' }])
    expect(screen.queryByPlaceholderText('https://g.page/r/YOUR_PLACE_ID/review')).toBeNull()
  })

  it('reads Saving and takes no second press while the write is out', async () => {
    let finish
    mocks.setDoc.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    await start()
    await press(save())

    expect(save().textContent).toBe('Saving…')
    expect(save().disabled).toBe(true)
    expect(mocks.setDoc).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
  })

  it('keeps the panel and what was typed, and says why, when the write is refused', async () => {
    mocks.setDoc.mockRejectedValue(refused())
    await start()
    await press(save())

    expect(toastCalls()).toEqual([{
      tone: 'error',
      title: 'Could not save the review link. Try again.',
      description: 'You do not have permission to do that.',
    }])
    expect(link().value).toBe('  https://g.page/r/new/review  ')
    expect(save().disabled).toBe(false)
  })
})
