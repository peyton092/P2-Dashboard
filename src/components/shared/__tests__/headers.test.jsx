import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SectionHeader } from '../headers'

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

// Four screens each kept a copy of this header, with sub and action props of their
// own. They use the shared one, and no screen gets to write another.
describe('the screens that used to keep their own SectionHeader', () => {
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
    '%s imports the shared SectionHeader',
    (file) => {
      const { text } = sources.find(({ name }) => name === file)
      expect(text).toMatch(/import\s*\{[^}]*\bSectionHeader\b[^}]*\}\s*from\s*'\.\/shared'/)
      expect(text, 'the old sub and action props are gone').not.toMatch(/<SectionHeader[^>]*\b(sub|action)=/s)
    },
  )
})
