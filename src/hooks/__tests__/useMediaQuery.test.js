import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from '../useMediaQuery'

const TABLET = '(min-width: 768px)'
const DESKTOP = '(min-width: 1024px)'

// jsdom has no matchMedia. This stands one in whose answers a test can change, and
// that tells the listeners of a query when its answer changes, and only those, as a
// browser does when the window resizes. The answers start as given, and a query
// nobody mentioned does not match.
function stubMatchMedia(answers, { legacy = false } = {}) {
  const matches = { ...answers }
  const listeners = new Map()
  const subscriptions = new Map()
  const of = (query) => {
    if (!listeners.has(query)) listeners.set(query, new Set())
    return listeners.get(query)
  }
  const add = (query, fn) => {
    of(query).add(fn)
    subscriptions.set(query, (subscriptions.get(query) ?? 0) + 1)
  }
  window.matchMedia = (query) => ({
    media: query,
    get matches() { return matches[query] ?? false },
    ...(legacy
      ? {
          addListener: (fn) => add(query, fn),
          removeListener: (fn) => of(query).delete(fn),
        }
      : {
          addEventListener: (type, fn) => { if (type === 'change') add(query, fn) },
          removeEventListener: (type, fn) => { if (type === 'change') of(query).delete(fn) },
        }),
  })
  return {
    listening: (query) => of(query).size,
    subscribedTo: (query) => subscriptions.get(query) ?? 0,
    set(query, value) {
      matches[query] = value
      of(query).forEach((fn) => fn({ matches: value }))
    },
  }
}

afterEach(() => {
  delete window.matchMedia
})

describe('useMediaQuery', () => {
  it('returns true when the query matches now', () => {
    stubMatchMedia({ [TABLET]: true })
    const { result } = renderHook(() => useMediaQuery(TABLET))
    expect(result.current).toBe(true)
  })

  it('returns false when the query does not match', () => {
    stubMatchMedia({ [TABLET]: false })
    const { result } = renderHook(() => useMediaQuery(TABLET))
    expect(result.current).toBe(false)
  })

  it('updates when the match changes, both ways', () => {
    const media = stubMatchMedia({ [TABLET]: false })
    const { result } = renderHook(() => useMediaQuery(TABLET))
    expect(result.current).toBe(false)

    act(() => media.set(TABLET, true))
    expect(result.current).toBe(true)

    act(() => media.set(TABLET, false))
    expect(result.current).toBe(false)
  })

  it('listens to its own query and to no other', () => {
    const media = stubMatchMedia({ [TABLET]: false, [DESKTOP]: false })
    const { result } = renderHook(() => useMediaQuery(TABLET))
    expect(media.listening(TABLET)).toBe(1)
    expect(media.listening(DESKTOP)).toBe(0)

    act(() => media.set(DESKTOP, true))

    expect(result.current).toBe(false)
  })

  it('subscribes once, and not again each time the component renders', () => {
    const media = stubMatchMedia({ [TABLET]: false })
    const { rerender } = renderHook(() => useMediaQuery(TABLET))

    rerender()
    rerender()
    rerender()

    expect(media.subscribedTo(TABLET)).toBe(1)
  })

  it('stops listening when the component unmounts', () => {
    const media = stubMatchMedia({ [TABLET]: false })
    const { unmount } = renderHook(() => useMediaQuery(TABLET))
    expect(media.listening(TABLET)).toBe(1)

    unmount()

    expect(media.listening(TABLET)).toBe(0)
  })

  it('moves to the new query when the query changes', () => {
    const media = stubMatchMedia({ [TABLET]: true, [DESKTOP]: false })
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: TABLET },
    })
    expect(result.current).toBe(true)

    rerender({ query: DESKTOP })

    expect(result.current).toBe(false)
    expect(media.listening(TABLET)).toBe(0)
    expect(media.listening(DESKTOP)).toBe(1)

    act(() => media.set(DESKTOP, true))
    expect(result.current).toBe(true)
  })

  it('works with a browser that only has addListener and removeListener', () => {
    const media = stubMatchMedia({ [TABLET]: false }, { legacy: true })
    const { result, unmount } = renderHook(() => useMediaQuery(TABLET))

    act(() => media.set(TABLET, true))
    expect(result.current).toBe(true)

    unmount()
    expect(media.listening(TABLET)).toBe(0)
  })

  it('is false when matchMedia is absent', () => {
    expect(window.matchMedia).toBeUndefined()
    const { result } = renderHook(() => useMediaQuery(TABLET))
    expect(result.current).toBe(false)
  })

  it('is false on the server, even where the query would match', () => {
    stubMatchMedia({ [TABLET]: true })
    const Probe = () => createElement('span', null, String(useMediaQuery(TABLET)))
    expect(renderToString(createElement(Probe))).toContain('false')
  })
})
