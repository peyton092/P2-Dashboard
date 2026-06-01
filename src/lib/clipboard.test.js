import { describe, it, expect, beforeEach } from 'vitest'
import { copyText } from './clipboard'

describe('copyText', () => {
  let originalClipboard
  beforeEach(() => {
    originalClipboard = navigator.clipboard
  })

  it('resolves true and writes when clipboard is available', async () => {
    let wrote = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { wrote = t; return Promise.resolve() } },
    })
    const ok = await copyText('hello')
    expect(ok).toBe(true)
    expect(wrote).toBe('hello')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  })

  it('resolves false when clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    expect(await copyText('hello')).toBe(false)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  })

  it('resolves false when writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })
    expect(await copyText('hello')).toBe(false)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  })

  it('stringifies non-string input', async () => {
    let wrote = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { wrote = t; return Promise.resolve() } },
    })
    await copyText(42)
    expect(wrote).toBe('42')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  })

  it('handles null without throwing', async () => {
    let wrote = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { wrote = t; return Promise.resolve() } },
    })
    const ok = await copyText(null)
    expect(ok).toBe(true)
    expect(wrote).toBe('')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  })
})
