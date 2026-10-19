import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { pressSpace } from '@/test/keyboard'

// One row of the Job Status list, read the way a screen reader and a keyboard read it. The
// row opens to show the job's subs, permits and invoice. Importing App.jsx pulls in the whole
// app, so everything that would reach Firebase is replaced.
vi.mock('../../firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('../../hooks/useFirestore', async (importOriginal) => ({
  ...(await importOriginal()),
  updateJob: vi.fn(),
}))

import { JobStatusRow } from '../../App'

afterEach(cleanup)

const JOB = {
  _docId: 'job1',
  id: 'QBS-003',
  name: 'Hillsboro Pike',
  client: 'QBS',
  address: '12 Main St',
  pm: 'Tim King',
  status: 'on-track',
  phase: 'Rough in',
  progress: 40,
  type: 'Remodel',
  subs: { electrical: 'Volt Co' },
  permits: { electrical: 'approved' },
  billingStatus: 'not-invoiced',
}

// The row as the list uses it, with whether it is open held in state.
function Row() {
  const [expanded, setExpanded] = useState(false)
  return (
    <ul>
      <li>
        <JobStatusRow
          job={JOB}
          complete={false}
          risk={null}
          stale={0}
          failed={false}
          billRdy={false}
          zone={null}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      </li>
    </ul>
  )
}

const header = (expanded) => screen.getByRole('button', { name: /QBS-003/, expanded })

describe('a Job Status row', () => {
  it('opens and closes from a row header button that says whether it is open and what it opens', () => {
    render(<Row />)

    const button = header(false)
    const controls = button.getAttribute('aria-controls')
    expect(controls).toBeTruthy()

    fireEvent.click(button)

    expect(header(true)).toBe(button)
    const detail = document.getElementById(controls)
    expect(detail).not.toBeNull()
    expect(detail.textContent).toContain('Subcontractors')
    expect(detail.textContent).toContain('Volt Co')

    fireEvent.click(button)
    expect(header(false)).toBe(button)
  })

  it('keeps the status list and the phase list out of the row header button', () => {
    render(<Row />)

    const button = header(false)
    const lists = screen.getAllByRole('combobox')
    expect(lists.length).toBeGreaterThanOrEqual(2)
    for (const list of lists) expect(button.contains(list), list.textContent).toBe(false)
  })

  it('opens from the keyboard with Space on the header', () => {
    render(<Row />)

    const button = header(false)
    act(() => { button.focus() })
    pressSpace()

    expect(header(true)).toBe(button)
  })

  it('has no accessibility violations, closed and open', async () => {
    const { container } = render(<Row />)
    expect(await axe(container)).toHaveNoViolations()

    fireEvent.click(header(false))
    expect(await axe(container)).toHaveNoViolations()
  })
})
