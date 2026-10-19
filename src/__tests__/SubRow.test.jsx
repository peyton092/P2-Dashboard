import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { axe } from '@/test/axe'
import { pressSpace } from '@/test/keyboard'

// One row of the Subs list, read the way a screen reader and a keyboard read it. The row
// opens to show the sub's job assignments. Its header is a button that says whether the row
// is open and what it opens; the phone link sits beside it, because a link cannot be inside
// a button. Importing App.jsx pulls in the whole app, so everything that would reach
// Firebase is replaced.
vi.mock('../firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
  storage: {},
  getMessagingIfSupported: async () => null,
}))
vi.mock('../hooks/useFirestore', async (importOriginal) => ({
  ...(await importOriginal()),
  updateJob: vi.fn(),
}))

import { SubRow } from '../App'

afterEach(cleanup)

const SUB = { id: 's1', name: 'Volt Co', trade: 'Electrical', co: 'Volt Company LLC', lic: 'EL-1234', phone: '615-555-0100', w9: true, score: 92 }
const ITEM = {
  s: SUB,
  verdict: { label: 'Approved for work', tone: 'success' },
  insState: 'valid',
  licState: 'valid',
  insDays: 200,
  licDays: 300,
  lastUpdateDays: 1,
  subJobs: [{ id: 'QBS-003', _docId: 'job3', name: 'Hillsboro Pike', status: 'active', trade: 'electrical', subsStatus: { electrical: 'active' } }],
  activeJobCount: 1,
}

// The row as the list uses it, with whether it is open held in state.
function Row() {
  const [expanded, setExpanded] = useState(false)
  return (
    <ul>
      <li>
        <SubRow item={ITEM} expanded={expanded} onToggle={() => setExpanded((open) => !open)} />
      </li>
    </ul>
  )
}

const header = (expanded) => screen.getByRole('button', { name: /Volt Co/, expanded })

describe('a Subs row', () => {
  it('opens and closes from a row header button that says whether it is open and what it opens', () => {
    render(<Row />)

    const button = header(false)
    const controls = button.getAttribute('aria-controls')
    expect(controls).toBeTruthy()

    fireEvent.click(button)

    expect(header(true)).toBe(button)
    expect(document.getElementById(controls).textContent).toContain('Hillsboro Pike')
  })

  it('keeps the phone link beside the header button and not inside it', () => {
    render(<Row />)

    const link = screen.getByRole('link', { name: /615-555-0100/ })
    expect(header(false).contains(link)).toBe(false)
  })

  it('opens from the keyboard with Space on the header', () => {
    render(<Row />)

    const button = header(false)
    act(() => { button.focus() })
    pressSpace()

    expect(header(true)).toBe(button)
  })

  it('opens from a click anywhere on the row, but not from the phone link', () => {
    render(<Row />)

    fireEvent.click(screen.getByText('Volt Company LLC'))
    expect(header(true)).toBeTruthy()

    // jsdom cannot follow a tel: link, and says so, so the click goes no further than the page.
    // The listener runs first, as the event comes down to the link.
    const stay = (event) => event.preventDefault()
    document.addEventListener('click', stay, true)
    try {
      fireEvent.click(screen.getByRole('link', { name: /615-555-0100/ }))
    } finally {
      document.removeEventListener('click', stay, true)
    }
    expect(header(true)).toBeTruthy()
  })

  it('has no accessibility violations, closed and open', async () => {
    const { container } = render(<Row />)
    expect(await axe(container)).toHaveNoViolations()

    fireEvent.click(header(false))
    expect(await axe(container)).toHaveNoViolations()
    expect(within(container).getAllByRole('combobox').length).toBeGreaterThan(0)
  })
})
