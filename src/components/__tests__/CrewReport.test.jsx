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

const submitButton = () => screen.getByRole('button', { name: /Submit daily report/ })

// A real pointer moves over an option before it clicks, and the option ignores a click until then.
async function choose(trigger, optionName) {
  await act(async () => { fireEvent.mouseDown(trigger) })
  const option = await screen.findByRole('option', { name: optionName })
  await act(async () => { fireEvent.mouseMove(option) })
  await act(async () => { fireEvent.click(option) })
}

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

  it('marks the reporter, the job and the phase as required', () => {
    render(<CrewReport />)

    for (const name of ['Reporter', 'Job', 'Phase']) {
      expect(screen.getByRole('combobox', { name }).getAttribute('aria-required'), name).toBe('true')
    }
    expect(screen.getByRole('combobox', { name: 'Blocker' }).hasAttribute('aria-required')).toBe(false)
  })

  // A report that is missing its reporter, job or phase is refused before anything is
  // written. Each missing list says why, in an alert it is described by, is marked invalid,
  // and focus goes to the first of them, where the person picks it.
  it('says what each missing list needs, marks it invalid, and moves focus to the first', async () => {
    render(<CrewReport />)

    await act(async () => { fireEvent.click(submitButton()) })

    const words = {
      Reporter: 'Pick your name to continue.',
      Job: 'Pick a job to continue.',
      Phase: 'Pick a phase to continue.',
    }
    for (const [name, message] of Object.entries(words)) {
      const list = screen.getByRole('combobox', { name })
      expect(list.getAttribute('aria-invalid'), name).toBe('true')
      const described = list.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id))
      expect(described.map((el) => [el.getAttribute('role'), el.textContent]), name).toContainEqual(['alert', message])
    }
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Reporter' }))
    expect(mocks.addDailyReport).not.toHaveBeenCalled()
  })

  it('takes the mark off a list once it is picked, and moves focus to the next one missing', async () => {
    render(<CrewReport />)
    await choose(screen.getByRole('combobox', { name: 'Reporter' }), 'Austin')

    await act(async () => { fireEvent.click(submitButton()) })

    expect(screen.getByRole('combobox', { name: 'Reporter' }).hasAttribute('aria-invalid')).toBe(false)
    expect(screen.getByRole('combobox', { name: 'Job' }).getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Job' }))
  })

  // A write the server refuses is said in words a person can act on, never in the
  // developer text of the error, and as an alert.
  it('reads a refused report out as an alert, in plain words', async () => {
    mocks.addDailyReport.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
    render(<CrewReport />)
    await choose(screen.getByRole('combobox', { name: 'Reporter' }), 'Austin')
    await choose(screen.getByRole('combobox', { name: 'Job' }), /QBS-003/)
    await choose(screen.getByRole('combobox', { name: 'Phase' }), 'Trim')

    await act(async () => { fireEvent.click(submitButton()) })

    expect(mocks.addDailyReport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toBe('Could not submit the report. You do not have permission to do that.')
    expect(screen.queryByText(/Missing or insufficient/)).toBeNull()
  })

  it('has no accessibility violations, with work checked and questions answered', async () => {
    const { container } = render(<CrewReport />)
    expect(await axe(container)).toHaveNoViolations()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Boxes set' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Inspection ready' })).getByRole('button', { name: 'Yes' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
