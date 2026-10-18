import { useEffect, useState } from 'react'

// The time now, as a Date that moves on by itself. A screen that shows today, or
// counts the days since something, asks for it here and passes it to what it calls.
// Reading the clock when a file loads is the mistake this replaces: it is the moment
// the tab was opened, so a tab left open overnight keeps showing the day before.
//
// The Date is new every interval (a minute unless asked otherwise), and the moment a
// tab becomes visible again, because a browser slows its timers in a tab nobody is
// looking at and stops them while a laptop sleeps. A component that depends on the
// day more than on the minute can depend on toLocalDateStr(now) instead, which is the
// same string until midnight.
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const refresh = () => setNow(new Date())
    const timer = setInterval(refresh, intervalMs)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs])

  return now
}
