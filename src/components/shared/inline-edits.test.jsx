import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

// Stub the firestore updateJob hook before importing the component so the
// component picks up our stub. Capture all calls so tests can assert.
const updateJobMock = vi.fn(() => Promise.resolve())
vi.mock('../../hooks/useFirestore', () => ({
  updateJob: updateJobMock,
}))

const { InlineStatusSelect, BillingStatusSelect, MatStatusBadge } = await import('./inline-edits')
const { ToastProvider } = await import('../ui/toast')

function mount(El, props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(ToastProvider, null, createElement(El, props)))
  })
  return {
    container,
    trigger: () => container.querySelector('[role="combobox"]') || container.querySelector('button'),
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('InlineStatusSelect', () => {
  let h
  beforeEach(() => { updateJobMock.mockClear(); h?.unmount?.() })

  it('renders a Select trigger reflecting the current status', () => {
    h = mount(InlineStatusSelect, { job: { _docId: 'j1', status: 'on-track' } })
    const trigger = h.trigger()
    expect(trigger).toBeTruthy()
    // Radix Select renders the raw value before its items mount in jsdom.
    expect(h.container.textContent).toMatch(/on-track/)
  })

  it('falls back gracefully when status is missing', () => {
    h = mount(InlineStatusSelect, { job: { _docId: 'j1' } })
    // No throw means a sensible default was picked.
    expect(h.trigger()).toBeTruthy()
  })

  it('does not call updateJob until the user picks a new value', () => {
    h = mount(InlineStatusSelect, { job: { _docId: 'j1', status: 'on-track' } })
    expect(updateJobMock).not.toHaveBeenCalled()
  })
})

describe('BillingStatusSelect', () => {
  let h
  beforeEach(() => { updateJobMock.mockClear(); h?.unmount?.() })

  it('uses the existing billingStatus when set', () => {
    h = mount(BillingStatusSelect, { job: { _docId: 'j1', billingStatus: 'paid' } })
    expect(h.container.textContent).toMatch(/Paid/i)
  })

  it('falls back to Not Invoiced when billingStatus is missing', () => {
    h = mount(BillingStatusSelect, { job: { _docId: 'j1' } })
    expect(h.container.textContent).toMatch(/Not Invoiced/i)
  })

  it('does not call updateJob on mount', () => {
    h = mount(BillingStatusSelect, { job: { _docId: 'j1', billingStatus: 'paid' } })
    expect(updateJobMock).not.toHaveBeenCalled()
  })
})

describe('MatStatusBadge', () => {
  let h
  let onUpdate
  beforeEach(() => { h?.unmount?.(); onUpdate = vi.fn() })

  it('shows the supplied status', () => {
    h = mount(MatStatusBadge, { status: 'Delivered', docId: 'm1', onUpdate })
    expect(h.container.textContent).toMatch(/Delivered/)
  })

  it('defaults to Ordered when status is missing', () => {
    h = mount(MatStatusBadge, { docId: 'm1', onUpdate })
    expect(h.container.textContent).toMatch(/Ordered/)
  })

  it('does not call onUpdate on mount', () => {
    h = mount(MatStatusBadge, { status: 'Delivered', docId: 'm1', onUpdate })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
