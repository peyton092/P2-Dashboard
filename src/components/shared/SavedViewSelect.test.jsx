import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SavedViewSelect } from './SavedViewSelect'
import { DialogProvider } from '../ui/dialog'
import { saveView, getSavedViews } from '../../lib/savedViews'

function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(DialogProvider, null, createElement(SavedViewSelect, props)),
    )
  })
  return {
    select: container.querySelector('select'),
    container,
    root,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

describe('SavedViewSelect', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('lists saved views for the scope', () => {
    saveView('test-scope', 'My View', { filter: 'critical' })
    saveView('test-scope', 'Another', { filter: 'all' })
    const h = mount({ scope: 'test-scope', currentPayload: { filter: 'all' }, onApply: () => {} })
    const opts = Array.from(h.select.options).map(o => o.textContent)
    expect(opts).toContain('My View')
    expect(opts).toContain('Another')
    h.unmount()
  })

  it('marks the matching view as active', () => {
    saveView('test-scope', 'Match', { filter: 'X' })
    const h = mount({ scope: 'test-scope', currentPayload: { filter: 'X' }, onApply: () => {} })
    expect(h.select.value).toBe('Match')
    h.unmount()
  })

  it('calls onApply with the saved payload when a view is selected', () => {
    saveView('test-scope', 'Saved', { filter: 'Y', extra: 1 })
    let applied = null
    const h = mount({
      scope: 'test-scope',
      currentPayload: { filter: 'all' },
      onApply: (p) => { applied = p },
    })
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    act(() => {
      setter.call(h.select, 'Saved')
      h.select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(applied).toEqual({ filter: 'Y', extra: 1 })
    h.unmount()
  })

  it('always includes the "Save current as" sentinel', () => {
    const h = mount({ scope: 'test-scope', currentPayload: {}, onApply: () => {} })
    const opts = Array.from(h.select.options)
    expect(opts.find(o => o.value === '__save__')).toBeTruthy()
    h.unmount()
  })

  it('shows nothing when the scope has no views besides the sentinel + placeholder', () => {
    const h = mount({ scope: 'empty-scope', currentPayload: {}, onApply: () => {} })
    // placeholder + save sentinel only
    expect(h.select.options.length).toBe(2)
    expect(getSavedViews('empty-scope')).toEqual({})
    h.unmount()
  })

  it('marks the loaded view "(modified)" when the user drifts', () => {
    saveView('test-scope', 'Saved', { filter: 'X' })
    // Initial render with currentPayload === Saved view's payload.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let currentPayload = { filter: 'X' }
    const onApply = (p) => { currentPayload = p }
    function render() {
      act(() => {
        root.render(
          createElement(DialogProvider, null,
            createElement(SavedViewSelect, { scope: 'test-scope', currentPayload, onApply }),
          ),
        )
      })
    }
    render()
    let select = container.querySelector('select')
    // Simulate applying the saved view (sets loadedName under the hood).
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    act(() => {
      setter.call(select, 'Saved')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // Drift the current payload — re-render.
    currentPayload = { filter: 'DRIFTED' }
    render()
    // The option text now includes "(modified)" and the Update-view button is rendered.
    const text = container.textContent
    expect(text).toMatch(/Saved \(modified\)/)
    expect(text).toMatch(/Update view/)
    act(() => { root.unmount() }); container.remove()
  })
})
