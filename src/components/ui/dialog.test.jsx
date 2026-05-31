import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { DialogProvider, useDialog } from './dialog'

// Manual mount harness — avoids @testing-library/react. Renders inside the
// DialogProvider so the consumer hook can resolve the context.
function mount(use) {
  const ref = { current: null }
  function Probe() {
    const v = use()
    useEffect(() => { ref.current = v }, [v])
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(DialogProvider, null, createElement(Probe)))
  })
  return {
    get current() { return ref.current },
    container,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

function getDialog() {
  return document.querySelector('[role="dialog"]')
}
function getButton(label) {
  const buttons = Array.from(document.querySelectorAll('button'))
  return buttons.find(b => b.textContent.trim() === label)
}

describe('useDialog().confirm', () => {
  let h
  beforeEach(() => { h?.unmount?.(); h = mount(useDialog) })

  it('resolves true when confirm clicked', async () => {
    let p
    act(() => { p = h.current.confirm({ title: 'Sure?' }) })
    expect(getDialog()).toBeTruthy()
    expect(getDialog().textContent).toMatch(/Sure\?/)
    act(() => { getButton('Confirm').click() })
    expect(await p).toBe(true)
    expect(getDialog()).toBeFalsy()
  })

  it('resolves false when cancel clicked', async () => {
    let p
    act(() => { p = h.current.confirm({ title: 'Sure?' }) })
    act(() => { getButton('Cancel').click() })
    expect(await p).toBe(false)
  })

  it('respects custom confirmLabel + cancelLabel', async () => {
    let p
    act(() => { p = h.current.confirm({ title: 'X', confirmLabel: 'Yep', cancelLabel: 'Nope' }) })
    expect(getButton('Yep')).toBeTruthy()
    expect(getButton('Nope')).toBeTruthy()
    act(() => { getButton('Yep').click() })
    expect(await p).toBe(true)
  })

  it('renders description when provided', async () => {
    let p
    act(() => { p = h.current.confirm({ title: 'T', description: 'Body copy here' }) })
    expect(getDialog().textContent).toMatch(/Body copy here/)
    act(() => { getButton('Cancel').click() })
    await p
  })

  it('accepts a plain string as the title shorthand', async () => {
    let p
    act(() => { p = h.current.confirm('Just a title?') })
    expect(getDialog().textContent).toMatch(/Just a title\?/)
    act(() => { getButton('Cancel').click() })
    await p
  })
})

describe('useDialog().prompt', () => {
  let h
  beforeEach(() => { h?.unmount?.(); h = mount(useDialog) })

  it('resolves the typed value when saved', async () => {
    let p
    act(() => { p = h.current.prompt({ title: 'Name', confirmLabel: 'Save' }) })
    const input = document.querySelector('input[type="text"]')
    expect(input).toBeTruthy()
    // React 19 tracks the prototype setter to detect external value writes —
    // call it so onChange fires with the new value.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => {
      setter.call(input, 'My View')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { getButton('Save').click() })
    expect(await p).toBe('My View')
  })

  it('resolves null when cancelled', async () => {
    let p
    act(() => { p = h.current.prompt({ title: 'Name' }) })
    act(() => { getButton('Cancel').click() })
    expect(await p).toBeNull()
  })

  it('honors defaultValue', async () => {
    let p
    act(() => { p = h.current.prompt({ title: 'Name', defaultValue: 'preset' }) })
    const input = document.querySelector('input[type="text"]')
    expect(input.value).toBe('preset')
    act(() => { getButton('Save').click() })
    expect(await p).toBe('preset')
  })
})

describe('Escape key cancels', () => {
  let h
  beforeEach(() => { h?.unmount?.(); h = mount(useDialog) })

  it('confirm → false on Escape', async () => {
    let p
    act(() => { p = h.current.confirm({ title: 'X' }) })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(await p).toBe(false)
  })

  it('prompt → null on Escape', async () => {
    let p
    act(() => { p = h.current.prompt({ title: 'Y' }) })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(await p).toBeNull()
  })
})

describe('useDialog outside provider', () => {
  it('throws a clear error', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    function Bad() { useDialog(); return null }
    const onerr = (e) => { e.preventDefault?.() }
    window.addEventListener('error', onerr)
    expect(() => {
      act(() => { root.render(createElement(Bad)) })
    }).toThrow(/DialogProvider/)
    window.removeEventListener('error', onerr)
    act(() => { root.unmount() })
    container.remove()
  })
})
