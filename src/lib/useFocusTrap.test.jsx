import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useFocusTrap } from './useFocusTrap'

function mountTrap({ active = true, html = '<button>One</button><button>Two</button><button>Three</button>' } = {}) {
  const ref = { container: null, root: null }
  function Probe() {
    const r = useRef(null)
    useFocusTrap(r, active)
    return createElement('div', { ref: r, 'data-trap': true, dangerouslySetInnerHTML: { __html: html } })
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(Probe)) })
  ref.container = container
  ref.root = root
  return ref
}

function focusables() {
  return Array.from(document.querySelector('[data-trap]')?.querySelectorAll('button, input, [tabindex]') || [])
}

async function nextTick() {
  return new Promise(r => setTimeout(r, 0))
}

describe('useFocusTrap', () => {
  let triggerBtn
  beforeEach(() => {
    // Simulate the element that had focus before the trap opened.
    triggerBtn = document.createElement('button')
    triggerBtn.textContent = 'Outside trigger'
    document.body.appendChild(triggerBtn)
    triggerBtn.focus()
  })
  afterEach(() => {
    document.querySelectorAll('[data-trap], div').forEach(el => el.remove())
    triggerBtn?.remove()
  })

  it('moves focus to the first focusable on open', async () => {
    mountTrap()
    await nextTick()
    expect(document.activeElement).toBe(focusables()[0])
  })

  it('cycles forward from last to first with Tab', async () => {
    mountTrap()
    await nextTick()
    const all = focusables()
    act(() => { all[all.length - 1].focus() })
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    act(() => { document.querySelector('[data-trap]').dispatchEvent(ev) })
    expect(document.activeElement).toBe(all[0])
  })

  it('cycles backward from first to last with Shift+Tab', async () => {
    mountTrap()
    await nextTick()
    const all = focusables()
    act(() => { all[0].focus() })
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    act(() => { document.querySelector('[data-trap]').dispatchEvent(ev) })
    expect(document.activeElement).toBe(all[all.length - 1])
  })

  it('does not steal focus when active=false', async () => {
    mountTrap({ active: false })
    await nextTick()
    expect(document.activeElement).toBe(triggerBtn)
  })

  it('makes the container focusable as fallback when no focusable children', async () => {
    mountTrap({ html: '<p>Just text</p>' })
    await nextTick()
    const trap = document.querySelector('[data-trap]')
    expect(trap.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(trap)
  })

  it('restores focus to the previously focused element on unmount', async () => {
    const t = mountTrap()
    await nextTick()
    expect(document.activeElement).not.toBe(triggerBtn)
    act(() => { t.root.unmount() })
    expect(document.activeElement).toBe(triggerBtn)
  })
})
