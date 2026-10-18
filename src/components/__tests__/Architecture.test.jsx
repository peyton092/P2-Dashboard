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
})
