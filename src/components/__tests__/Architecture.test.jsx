// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within, cleanup } from '@testing-library/react'
import Architecture from '../Architecture'

afterEach(cleanup)

// What this screen used to describe and the code never had: six functions, a rules
// listing with three roles of its own, and collections that were never created.
const NEVER_EXISTED = [
  'onJobStatusChange',
  'onInspectionFail',
  'syncExtraToQBS',
  'subComplianceCheck',
  'billingMilestone',
  'leadNotification',
  'isP2Internal',
  'isP2Admin',
  'isQBS',
  'p2_internal',
  'p2_admin',
  'jobs/{jobId}/extras',
  'jobs/{jobId}/materials',
]

// The names functions/index.js exports, read from its export lines, so the screen
// cannot drift from the code without this test failing.
const index = readFileSync(resolve(import.meta.dirname, '../../../functions/index.js'), 'utf8')
const EXPORTED = [...index.matchAll(/^export \{([^}]*)\} from/gm)]
  .flatMap(([, names]) => names.split(',').map((name) => name.trim()).filter(Boolean))

// The StatCard with this label. Its label is a paragraph; a card title with the same
// words is not.
const statCard = (label) =>
  screen.getAllByText(label).find((el) => el.tagName === 'P').closest('[data-slot="card"]')

// The name that heads a card, which is bold. A chip with the same words (permits is also a
// field of the jobs card) is not.
const nameOf = (title) => screen.getAllByText(title, { selector: 'span' }).find((el) => el.classList.contains('font-bold'))

// The chips of a collection card: the fields it lists, in order. The name sits in a row of its
// own, and the chips are the last thing in the card.
const chipsOf = (collection) => {
  const card = nameOf(collection).parentElement.parentElement
  return [...card.lastElementChild.children].map((chip) => chip.textContent)
}

// The words under the name of a collection, a function or a rule: the paragraph that follows it
// (or follows its row, for a collection).
const textUnder = (title) => {
  const name = nameOf(title)
  return (name.nextElementSibling ?? name.parentElement.nextElementSibling).textContent
}

describe('Architecture', () => {
  it('describes none of what never existed, and says there are four roles', () => {
    const { container } = render(<Architecture />)

    for (const name of NEVER_EXISTED) {
      expect(container.textContent, name).not.toContain(name)
    }
    expect(screen.queryByText('leads')).toBeNull()
    expect(screen.queryByText('inspections')).toBeNull()

    const roles = statCard('Auth Roles')
    expect(within(roles).getByText('4')).toBeTruthy()
    expect(within(roles).getByText('owner, internal, builder, client')).toBeTruthy()
  })

  it('lists every function that functions/index.js exports, once each', () => {
    render(<Architecture />)

    expect(EXPORTED.length).toBeGreaterThan(0)
    for (const name of EXPORTED) {
      expect(screen.queryAllByText(name), name).toHaveLength(1)
    }
    expect(within(statCard('Cloud Functions')).getByText(String(EXPORTED.length))).toBeTruthy()
  })

  // The chips list the fields a document carries. permits shows the author stamp only, and
  // urgent_items adds resolved to createdBy and createdAt (addUrgentItem in useFirestore.js).
  it('lists the fields that permits and urgent_items carry', () => {
    render(<Architecture />)

    expect(chipsOf('permits')).toEqual(['createdBy', 'createdByEmail', 'createdAt'])
    expect(chipsOf('urgent_items')).toEqual(['resolved', 'createdBy', 'createdAt'])
  })

  it('says a client upload can be listed by any signed in account that knows the job id', () => {
    render(<Architecture />)

    const storage = textUnder('Storage')
    expect(storage).toContain('listable by any signed in account that knows the job id')
    expect(storage).not.toContain('read by any signed in user')
    expect(storage).toContain('Every other path is staff only.')
  })

  it('says a draft change order is never stamped and has a scope it carries deleted', () => {
    render(<Architecture />)

    expect(textUnder('extras')).toContain('which are never stamped (a scope one carries is deleted)')
    expect(textUnder('onExtraWritten')).toContain('A draft is not stamped until it is sent, and a scope it carries is deleted.')
    expect(textUnder('onJobWritten')).toContain('A draft change order is left as it is.')
  })
})
