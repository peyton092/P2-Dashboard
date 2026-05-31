import { describe, it, expect, beforeEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { captureInstallPrompt, useInstallPrompt } from './installPrompt'

// Mount the hook in a probe component so we can read its current value off
// a ref and drive install() from test code.
function mount() {
  const ref = { current: null }
  function Probe() {
    ref.current = useInstallPrompt()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(Probe)) })
  return {
    get current() { return ref.current },
    container,
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

function fireInstallPrompt(userChoice = { outcome: 'accepted' }) {
  // The real event has prompt() + userChoice. jsdom doesn't provide it, so
  // synthesize one.
  const e = new Event('beforeinstallprompt')
  let promptCalls = 0
  e.prompt = () => { promptCalls++ }
  e.userChoice = Promise.resolve(userChoice)
  e._stats = () => promptCalls
  act(() => { e.preventDefault = () => {}; window.dispatchEvent(e) })
  return e
}

describe('captureInstallPrompt + useInstallPrompt', () => {
  let h
  beforeEach(() => {
    h?.unmount?.()
    // Module-scope state from prior tests leaks; re-run capture to confirm
    // the listener is wired and reset the stored event by firing appinstalled.
    captureInstallPrompt()
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
  })

  it('starts unavailable when no event fired', () => {
    h = mount()
    expect(h.current.available).toBe(false)
  })

  it('becomes available after beforeinstallprompt fires', () => {
    h = mount()
    fireInstallPrompt()
    expect(h.current.available).toBe(true)
  })

  it('resolves with the user choice outcome on install', async () => {
    h = mount()
    fireInstallPrompt({ outcome: 'accepted' })
    let outcome
    await act(async () => { outcome = await h.current.install() })
    expect(outcome).toBe('accepted')
    expect(h.current.available).toBe(false)
  })

  it('returns "unavailable" when install called without a captured event', async () => {
    h = mount()
    const outcome = await h.current.install()
    expect(outcome).toBe('unavailable')
  })

  it('resets to unavailable after appinstalled fires', () => {
    h = mount()
    fireInstallPrompt()
    expect(h.current.available).toBe(true)
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(h.current.available).toBe(false)
  })
})
