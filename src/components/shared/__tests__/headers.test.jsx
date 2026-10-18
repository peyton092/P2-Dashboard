import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'
import { PageHeader, SectionHeader } from '../headers'
import Permits from '../../Permits'
import ProjectFolders from '../../ProjectFolders'
import SubmitInbox from '../../SubmitInbox'
import Architecture from '../../Architecture'

// The four legacy screens read their data and reach Firebase through these, and
// this test is about their headers and not about what they do with either.
vi.mock('../../../use-data', () => ({ useData: () => ({ jobs: [], submits: [] }) }))
vi.mock('../../../hooks/useFirestore', () => ({
  updateJob: vi.fn(),
  updatePermit: vi.fn(),
  useJobFiles: () => ({ files: [], loading: false }),
  addJobFile: vi.fn(),
  addSubmit: vi.fn(),
  updateSubmit: vi.fn(),
  useSubmitReplies: () => ({ replies: [] }),
  addSubmitReply: vi.fn(),
}))
vi.mock('../../../firebase', () => ({ storage: {}, auth: { currentUser: null } }))

afterEach(cleanup)

describe('SectionHeader', () => {
  it('is a level two heading, with its description under it', () => {
    render(<SectionHeader title="Permits" description="Permit status across all active jobs and trades" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Permits' })).toBeTruthy()
    expect(screen.getByText('Permit status across all active jobs and trades')).toBeTruthy()
  })

  it('shows a count beside the title and the actions after it', () => {
    render(<SectionHeader title="Submit / Inbox" count={4} actions={<button type="button">New Submit</button>} />)

    const heading = screen.getByRole('heading', { name: 'Submit / Inbox' })
    const action = screen.getByRole('button', { name: 'New Submit' })
    expect(screen.getByText('4')).toBeTruthy()
    expect(heading.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('PageHeader', () => {
  it('is the level one heading of a page, with its subtitle and its actions', () => {
    render(<PageHeader title="Permits" subtitle="Permit status across all jobs" actions={<button type="button">Export</button>} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Permits' })).toBeTruthy()
    expect(screen.getByText('Permit status across all jobs')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })
})

describe('both headers', () => {
  it('have no accessibility violations on a page that uses one of each', async () => {
    const { container } = render(
      <>
        <PageHeader title="Billing" subtitle="Ready to bill, held and aging" actions={<button type="button">Export</button>} />
        <SectionHeader title="Jobs" count={3} description="Open jobs" actions={<button type="button">Add</button>} />
      </>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

// Four screens each kept a copy of a section header for their page title, with sub
// and action props of their own. A page title is a PageHeader, as it is on every
// other screen, and no screen gets to write a header of its own.
describe('the screens that used to keep their own SectionHeader', () => {
  const SCREENS = [
    ['Permits', Permits, 'Permits', 'Permit status across all active jobs and trades'],
    ['ProjectFolders', ProjectFolders, 'Project Folders', 'File management for each job: plans, photos, PDFs and notes'],
    ['SubmitInbox', SubmitInbox, 'Submit / Inbox', '0 open \u00b7 0 total'],
    ['Architecture', Architecture, 'Architecture', 'Firestore blueprint \u00b7 Cloud Functions \u00b7 Security rules'],
  ]

  it.each(SCREENS)('%s has one level one heading, its title, with its subtitle under it', (_name, Screen, title, subtitle) => {
    render(<Screen />)

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings.map((heading) => heading.textContent)).toEqual([title])
    expect(screen.getByText(subtitle)).toBeTruthy()
  })

  it('gives Submit Inbox its New Submit action in the page header', () => {
    render(<SubmitInbox />)

    const header = screen.getByRole('heading', { level: 1, name: 'Submit / Inbox' }).closest('header')
    expect(header.querySelector('button').textContent).toMatch(/New Submit/)
  })

  const components = resolve(import.meta.dirname, '../..')
  const sourcesUnder = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesUnder(path)
      return /\.jsx?$/.test(entry.name) ? [path] : []
    })
  const sources = sourcesUnder(components).map((file) => ({
    name: relative(components, file).split('\\').join('/'),
    text: readFileSync(file, 'utf8'),
  }))

  it('finds the screens it is meant to scan', () => {
    const names = sources.map(({ name }) => name)
    for (const expected of ['Permits.jsx', 'ProjectFolders.jsx', 'SubmitInbox.jsx', 'Architecture.jsx', 'shared/headers.jsx']) {
      expect(names, expected).toContain(expected)
    }
  })

  it('defines SectionHeader in one place only, the shared headers file', () => {
    const definers = sources.filter(({ text }) => /\bfunction SectionHeader\b|\bconst SectionHeader\b/.test(text))
    expect(definers.map(({ name }) => name)).toEqual(['shared/headers.jsx'])
  })

  it.each(['Permits.jsx', 'ProjectFolders.jsx', 'SubmitInbox.jsx', 'Architecture.jsx'])(
    '%s takes its page title from the shared PageHeader and keeps no header of its own',
    (file) => {
      const { text } = sources.find(({ name }) => name === file)
      expect(text).toMatch(/import\s*\{[^}]*\bPageHeader\b[^}]*\}\s*from\s*'\.\/shared'/)
      expect(text).toMatch(/<PageHeader\b/)
      expect(text, 'no local header and no section header for the page title').not.toMatch(/\bSectionHeader\b/)
    },
  )
})
