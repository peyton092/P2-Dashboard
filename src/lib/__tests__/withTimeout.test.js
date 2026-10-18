import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from '../withTimeout'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the value when the inner promise settles before the deadline', async () => {
    const inner = new Promise(resolve => setTimeout(() => resolve('ok'), 100))
    const result = withTimeout(inner, 1000)
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toBe('ok')
  })

  it('rejects with code timeout after the deadline', async () => {
    const inner = new Promise(() => {})
    const result = withTimeout(inner, 1000)
    const assertion = expect(result).rejects.toMatchObject({ message: 'timeout', code: 'timeout' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('ignores a late resolution after the timeout fired', async () => {
    let resolveInner
    const inner = new Promise(resolve => { resolveInner = resolve })
    const onFulfilled = vi.fn()
    const onRejected = vi.fn()
    withTimeout(inner, 1000).then(onFulfilled, onRejected)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onRejected).toHaveBeenCalledTimes(1)
    resolveInner('late')
    await vi.advanceTimersByTimeAsync(0)
    expect(onFulfilled).not.toHaveBeenCalled()
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('ignores a late rejection after the timeout fired', async () => {
    let rejectInner
    const inner = new Promise((_, reject) => { rejectInner = reject })
    const onFulfilled = vi.fn()
    const onRejected = vi.fn()
    withTimeout(inner, 1000).then(onFulfilled, onRejected)
    await vi.advanceTimersByTimeAsync(1000)
    rejectInner(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onFulfilled).not.toHaveBeenCalled()
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(onRejected.mock.calls[0][0].code).toBe('timeout')
  })

  it('propagates an inner rejection that happens before the deadline', async () => {
    const failure = Object.assign(new Error('boom'), { code: 'functions/internal' })
    const inner = new Promise((_, reject) => setTimeout(() => reject(failure), 100))
    const result = withTimeout(inner, 1000)
    const assertion = expect(result).rejects.toBe(failure)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it('clears the timer when the inner promise settles first', async () => {
    const inner = Promise.resolve('ok')
    await withTimeout(inner, 1000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
