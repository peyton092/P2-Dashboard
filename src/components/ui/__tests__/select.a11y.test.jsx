import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'

// The axe matchers and the Chrome vendor that Base UI needs come from
// src/test/setup.js. The axe in src/test/axe.js leaves out the two rules that
// jsdom cannot judge, so what this test can prove about the open list is its
// structure and the theme it lands in.

// The class each screen used to put on its own wrapper.
const SCREEN_SCOPE = 'dark'

// The page the app mounts into. The open list is drawn in a portal on body, so
// the only theme it can get is the one the document root carries, and
// index.html decides that. Load its html attributes the way a browser would.
const shell = new DOMParser().parseFromString(
  readFileSync(resolve(import.meta.dirname, '../../../../index.html'), 'utf8'),
  'text/html',
)

beforeEach(() => {
  for (const { name, value } of shell.documentElement.attributes) {
    document.documentElement.setAttribute(name, value)
  }
})

afterEach(() => {
  cleanup()
  for (const { name } of [...document.documentElement.attributes]) {
    document.documentElement.removeAttribute(name)
  }
})

describe('Select', () => {
  it('opens a list that stays in the dark theme and has no axe violations', async () => {
    // The wrapper stands for a screen that sets its own dark scope. A portal
    // escapes it, so a wrapper alone leaves the list on the light tokens.
    render(
      <div className={SCREEN_SCOPE}>
        <span id="trade-label">Trade</span>
        <Select defaultValue="electrical">
          <SelectTrigger aria-labelledby="trade-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="electrical">Electrical</SelectItem>
            <SelectItem value="hvac">HVAC</SelectItem>
          </SelectContent>
        </Select>
      </div>,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Trade' }))
    const list = await screen.findByRole('listbox')

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Electrical', 'HVAC'])
    expect(list.closest('.dark'), 'the open list sits inside an element with the dark class').not.toBeNull()

    let results
    await act(async () => {
      results = await axe(document.body)
    })
    expect(results).toHaveNoViolations()
  })
})
