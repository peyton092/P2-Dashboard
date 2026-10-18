import { configureAxe } from 'vitest-axe'

// The axe every accessibility test in this repo runs. Two rules cannot be judged
// from a component on its own in jsdom, so they are off. Region wants the page
// landmarks that a single control does not have, and color contrast needs layout
// and a canvas, so axe reports it as undecided here. What a test can prove about a
// component is its structure: names, roles, states and how they are wired.
export const axe = configureAxe({
  rules: { region: { enabled: false }, 'color-contrast': { enabled: false } },
})
