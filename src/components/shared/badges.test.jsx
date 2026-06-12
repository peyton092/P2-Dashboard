import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Pill, StatusBadge, BillingBadge, InspectionBadge, PriorityBadge,
  STATUS_COLORS, STATUS_TONES,
} from './badges'

function mount(El, props = {}, children) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(El, props, children)) })
  return {
    container,
    text: () => container.textContent,
    el: () => container.firstChild,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('STATUS_COLORS / STATUS_TONES', () => {
  it('exposes the canonical palette', () => {
    expect(STATUS_COLORS.brand).toMatch(/^#/)
    expect(STATUS_COLORS.success).toMatch(/^#/)
    expect(STATUS_COLORS.warning).toMatch(/^#/)
    expect(STATUS_COLORS.critical).toMatch(/^#/)
  })
  it('exposes matching tone variants', () => {
    expect(STATUS_TONES.success.fg).toBe('#22c55e')
    expect(STATUS_TONES.critical.fg).toBe('#ef4444')
    expect(STATUS_TONES.warning.bg).toMatch(/22$/)
  })
})

describe('Pill', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders children', () => {
    h = mount(Pill, {}, 'Hello')
    expect(h.text()).toBe('Hello')
  })

  it('applies tone colors via style', () => {
    h = mount(Pill, { tone: 'success' }, 'OK')
    const el = h.el()
    expect(el.style.color).toBe('rgb(34, 197, 94)') // #22c55e
  })

  it('falls back to neutral for unknown tone', () => {
    h = mount(Pill, { tone: 'unknown' }, 'Hmm')
    const el = h.el()
    expect(el.style.color).toBe('rgb(156, 163, 175)') // neutral #9ca3af
  })
})

describe('StatusBadge', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('maps known statuses to human labels', () => {
    h = mount(StatusBadge, { status: 'on-track' })
    expect(h.text()).toBe('On Track')
    h.unmount()
    h = mount(StatusBadge, { status: 'needs-action' })
    expect(h.text()).toBe('Needs Action')
    h.unmount()
    h = mount(StatusBadge, { status: 'hold' })
    expect(h.text()).toBe('On Hold')
  })

  it('uppercases unknown statuses as a fallback', () => {
    h = mount(StatusBadge, { status: 'cancelled' })
    expect(h.text()).toBe('CANCELLED')
  })

  it('renders an em-dash for nullish status', () => {
    h = mount(StatusBadge, { status: undefined })
    expect(h.text()).toBe('—')
  })
})

describe('BillingBadge', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders a label for a billing status', () => {
    h = mount(BillingBadge, { status: 'paid' })
    expect(h.text().length).toBeGreaterThan(0)
  })
})

describe('InspectionBadge', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders a label for an inspection status', () => {
    h = mount(InspectionBadge, { status: 'passed' })
    expect(h.text().length).toBeGreaterThan(0)
  })
})

describe('PriorityBadge', () => {
  let h
  beforeEach(() => { h?.unmount?.() })

  it('renders the priority label', () => {
    h = mount(PriorityBadge, { priority: 'HIGH' })
    expect(h.text().length).toBeGreaterThan(0)
  })
})
