import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { axe } from '@/test/axe'
import { useConnectionState } from '@/hooks/useConnectionState'
import { PageHeader } from '../../components/shared/headers'

// The real hook starts Firestore. Which state the chip shows is the test's to choose.
vi.mock('../../hooks/useConnectionState', () => ({ useConnectionState: vi.fn() }))

// A page header with the connection chip in it, read the way a screen reader reads it.

afterEach(cleanup)

const renderHeader = () =>
  render(
    <PageHeader
      eyebrow="Billing Queue"
      title="Ready to bill"
      subtitle="Jobs ready to invoice, held and aging."
      meta={<span>3 ready</span>}
      actions={<button type="button">Export CSV</button>}
    />,
  )

describe('a page header with the connection chip', () => {
  it.each([
    ['online', 'Live'],
    ['syncing', 'Syncing'],
    ['offline', 'Offline'],
  ])('says the connection is %s in words, in a polite status inside the header', (state, word) => {
    vi.mocked(useConnectionState).mockReturnValue(state)
    renderHeader()

    const header = screen.getByRole('heading', { level: 1, name: 'Ready to bill' }).closest('header')
    const status = within(header).getByRole('status')
    expect(status.textContent).toBe(word)
    expect(status.getAttribute('aria-live')).toBe('polite')
  })

  it('has one heading, the title, and leaves the eyebrow as plain text', () => {
    vi.mocked(useConnectionState).mockReturnValue('online')
    renderHeader()

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Ready to bill'])
  })

  it.each(['online', 'syncing', 'offline'])('has no accessibility violations while the connection is %s', async (state) => {
    vi.mocked(useConnectionState).mockReturnValue(state)
    const { container } = renderHeader()

    expect(await axe(container)).toHaveNoViolations()
  })
})
