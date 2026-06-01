import { describe, it, expect, vi } from 'vitest'
import { runBulk } from './runBulk'

const mkToast = () => {
  const calls = []
  const fn = (opts) => { calls.push(opts) }
  fn.calls = calls
  return fn
}

describe('runBulk', () => {
  it('toasts success when every op resolves', async () => {
    const toast = mkToast()
    const op = vi.fn(() => Promise.resolve())
    const result = await runBulk([1, 2, 3], op, toast, { successTitle: 'Updated', noun: 'job' })
    expect(result).toEqual({ ok: 3, fail: 0 })
    expect(toast.calls.length).toBe(1)
    expect(toast.calls[0].tone).toBe('success')
    expect(toast.calls[0].title).toBe('Updated 3 jobs')
  })

  it('uses singular form when ok === 1', async () => {
    const toast = mkToast()
    await runBulk([1], () => Promise.resolve(), toast, { noun: 'sub' })
    expect(toast.calls[0].title).toBe('Updated 1 sub')
  })

  it('toasts error when every op rejects', async () => {
    const toast = mkToast()
    const op = () => Promise.reject(new Error('Permission denied'))
    const result = await runBulk([1, 2], op, toast, { failureTitle: 'Bulk failed' })
    expect(result).toEqual({ ok: 0, fail: 2 })
    expect(toast.calls[0].tone).toBe('error')
    expect(toast.calls[0].title).toBe('Bulk failed')
    expect(toast.calls[0].description).toBe('Permission denied')
  })

  it('toasts warning on partial success', async () => {
    const toast = mkToast()
    let i = 0
    const op = () => {
      i++
      return i === 2 ? Promise.reject(new Error('oops')) : Promise.resolve()
    }
    const result = await runBulk([1, 2, 3], op, toast, { noun: 'item' })
    expect(result).toEqual({ ok: 2, fail: 1 })
    expect(toast.calls[0].tone).toBe('warning')
    expect(toast.calls[0].title).toBe('2 items updated, 1 failed')
  })

  it('returns the ok/fail counts for callers that need them', async () => {
    const toast = mkToast()
    let i = 0
    const result = await runBulk(
      [1, 2, 3, 4, 5],
      () => { i++; return i % 2 === 0 ? Promise.reject(new Error('e')) : Promise.resolve() },
      toast,
    )
    expect(result.ok).toBe(3)
    expect(result.fail).toBe(2)
  })

  it('handles empty items list', async () => {
    const toast = mkToast()
    const result = await runBulk([], () => Promise.resolve(), toast)
    expect(result).toEqual({ ok: 0, fail: 0 })
    expect(toast.calls[0].tone).toBe('success')
  })
})
