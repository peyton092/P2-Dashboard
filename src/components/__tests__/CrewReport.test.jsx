import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { axe } from '@/test/axe'
import { pressSpace } from '@/test/keyboard'

// The daily report a crew member files from the field, read the way a screen reader and a
// keyboard read it: every box and list named by its label, the work done as real checkboxes,
// and each yes or no question as a pair of buttons that say which one is pressed.
const mocks = vi.hoisted(() => ({
  data: { jobs: [{ id: 'QBS-003', name: 'Hillsboro Pike', status: 'active' }], dailyReports: [] },
  addDailyReport: vi.fn(),
}))

vi.mock('../../firebase', () => ({ storage: {}, auth: { currentUser: null } }))
vi.mock('../../use-data', () => ({ useData: () => mocks.data }))
vi.mock('../../hooks/useFirestore', () => ({ addDailyReport: mocks.addDailyReport }))
// The chip in the page header asks this hook for the connection; the real one starts Firestore.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: () => 'online' }))

import CrewReport from '../CrewReport'

beforeEach(() => {
  mocks.addDailyReport.mockReset().mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('the daily report form', () => {
  it('names every box and list by its label', () => {
    render(<CrewReport />)

    for (const name of ['Reporter', 'Job', 'Phase', 'Blocker']) {
      expect(screen.getByRole('combobox', { name }), name).toBeTruthy()
    }
    for (const name of ['Materials used', 'Materials needed for next visit']) {
      expect(screen.getByRole('textbox', { name }).tagName, name).toBe('TEXTAREA')
    }
    expect(screen.getByRole('textbox', { name: 'Next step' }).tagName).toBe('INPUT')
  })

  it('lists the work done as real checkboxes, in a group named for it', () => {
    render(<CrewReport />)

    const group = screen.getByRole('group', { name: 'Work completed today' })
    const boxes = within(group).getAllByRole('checkbox')
    expect(boxes.map((box) => box.tagName)).toEqual(boxes.map(() => 'INPUT'))
    expect(within(group).getByRole('checkbox', { name: 'Panel landed' }).checked).toBe(false)
  })

  it('checks a work item with Space, and counts it', () => {
    render(<CrewReport />)

    const box = screen.getByRole('checkbox', { name: 'Circuits run' })
    act(() => { box.focus() })
    pressSpace()

    expect(box.checked).toBe(true)
    expect(screen.getByText('1 item marked')).toBeTruthy()
  })

  it.each(['Safety issue', 'Change order needed', 'Inspection ready'])(
    'asks %s as a group of two buttons that say which is pressed',
    (question) => {
      render(<CrewReport />)

      const group = screen.getByRole('group', { name: question })
      const yes = within(group).getByRole('button', { name: 'Yes' })
      const no = within(group).getByRole('button', { name: 'No' })
      expect([yes.getAttribute('aria-pressed'), no.getAttribute('aria-pressed')]).toEqual(['false', 'false'])

      fireEvent.click(yes)
      expect([yes.getAttribute('aria-pressed'), no.getAttribute('aria-pressed')]).toEqual(['true', 'false'])
      fireEvent.click(no)
      expect([yes.getAttribute('aria-pressed'), no.getAttribute('aria-pressed')]).toEqual(['false', 'true'])
    },
  )

  it('has no accessibility violations, with work checked and questions answered', async () => {
    const { container } = render(<CrewReport />)
    expect(await axe(container)).toHaveNoViolations()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Boxes set' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Inspection ready' })).getByRole('button', { name: 'Yes' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
