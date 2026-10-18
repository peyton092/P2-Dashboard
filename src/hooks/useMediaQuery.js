import { useSyncExternalStore } from 'react'

// Whether a media query matches now, and again whenever that changes. Screens ask
// it which layout to render once, instead of rendering both and hiding one with
// CSS: useMediaQuery('(min-width: 768px)') is true on a tablet and wider.
//
// It is false on the server and wherever matchMedia does not exist, which includes
// jsdom, so a test that wants a width stubs window.matchMedia.

const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(query, onChange) {
  if (!supported()) return () => {}
  const list = window.matchMedia(query)
  // Safari before 14 has addListener and removeListener and no addEventListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
  list.addListener(onChange)
  return () => list.removeListener(onChange)
}

export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => (supported() ? window.matchMedia(query).matches : false),
    () => false,
  )
}
