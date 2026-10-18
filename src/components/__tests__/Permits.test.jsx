import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { ToastContext } from '@/components/ui/use-toast'
import { TONE_HEX, hexToRgb } from '@/lib/tokens'

// A permit has its own statuses (pending, applied, approved, finaled, denied),
// which used to be read through the inspection table and so came out grey. They
// are in src/lib/status.js now.
const mocks = vi.hoisted(() => ({
  data: { jobs: [] },
  updatePermit: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({ updatePermit: mocks.updatePermit }))
// The chip in every page header asks this hook for the connection. What it says is
// not what this file is about, and the real one would start Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import Permits from '../Permits'

const rgb = (tone) => `rgb(${hexToRgb(TONE_HEX[tone]).join(', ')})`
const job = (over) => ({
  id: 'QBS-003', _docId: 'job3', address: '123 Main St', status: 'on-track',
  permits: { electrical: 'approved', plumbing: 'pending', hvac: 'denied' }, ...over,
})

beforeEach(() => {
  mocks.updatePermit.mockReset()
  mocks.toast.mockReset()
})
afterEach(cleanup)

const withToast = (ui) => <ToastContext.Provider value={mocks.toast}>{ui}</ToastContext.Provider>

describe('Permits', () => {
  it('offers the five permit statuses in words, and reads the stored one as selected', () => {
    mocks.data = { jobs: [job()] }
    render(<Permits />)
    const lists = screen.getAllByRole('combobox')
    expect(lists).toHaveLength(3)
    expect(within(lists[0]).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Pending', 'Applied', 'Approved', 'Finaled', 'Denied'])
    expect(lists.map((list) => list.value)).toEqual(['approved', 'pending', 'denied'])
  })

  it.each([
    [0, 'success'],
    [1, 'mute'],
    [2, 'critical'],
  ])('colors the list of trade %i in the %s tone', (index, tone) => {
    mocks.data = { jobs: [job()] }
    render(<Permits />)
    expect(screen.getAllByRole('combobox')[index].style.color).toBe(rgb(tone))
  })

  it('stores the key of the status that was chosen', async () => {
    mocks.data = { jobs: [job()] }
    render(<Permits />)
    await act(async () => { fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'applied' } }) })
    expect(mocks.updatePermit).toHaveBeenCalledWith('job3', 'plumbing', 'applied')
  })

  it('says which permit was set to which status, in words', async () => {
    mocks.data = { jobs: [job()] }
    render(withToast(<Permits />))
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'applied' } })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Plumbing permit set to applied.' })
  })

  it('says it could not change the permit, with the reason, when the write is refused', async () => {
    mocks.updatePermit.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
    mocks.data = { jobs: [job()] }
    render(withToast(<Permits />))
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'finaled' } })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1))
    expect(mocks.toast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Could not change the permit status. Try again.',
      description: 'You do not have permission to do that.',
    })
  })

  it('shows the status of a job with no document as a badge in the same words', () => {
    mocks.data = { jobs: [job({ _docId: undefined, permits: { electrical: 'finaled' } })] }
    render(<Permits />)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getByText('Finaled').style.color).toBe(rgb('success'))
  })

  it('shows the status of the job beside its address as words', () => {
    mocks.data = { jobs: [job({ status: 'at-risk' })] }
    render(<Permits />)
    expect(screen.getByText('At risk').style.color).toBe(rgb('warning'))
  })
})
