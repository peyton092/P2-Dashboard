import { act } from '@testing-library/react'
import { configureAxe } from 'vitest-axe'

// The axe every accessibility test in this repo runs:
//
//   expect(await axe(container)).toHaveNoViolations()
//
// Two rules cannot be judged from a component on its own in jsdom, so they are
// off. Region wants the page landmarks that a single control does not have, and
// color contrast needs layout and a canvas, so axe reports it as undecided here.
// What a test can prove about a component is its structure: names, roles, states
// and how they are wired.
const run = configureAxe({
  rules: { region: { enabled: false }, 'color-contrast': { enabled: false } },
})

// Axe takes long enough for Base UI to land the state updates it schedules on
// animation frames, such as a panel finishing its transition. They belong in act,
// or React warns that they were not wrapped in it.
export async function axe(...args) {
  let results
  await act(async () => {
    results = await run(...args)
  })
  return results
}
