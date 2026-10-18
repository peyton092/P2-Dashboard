// Days as people count them. A day is the one on the calendar where the person is, so
// everything here reads local time: the year, month and day a Date has in the zone of
// the browser. Two habits read UTC instead, and for part of every evening in the
// Americas UTC is already tomorrow: a day cut out of toISOString(), and a bare date
// such as 2026-10-18 handed to the Date constructor, which means midnight UTC. This
// module is the replacement for both.
//
// Nothing here keeps a clock of its own. Each function that needs the time takes it
// as an argument and reads the clock only when it is not given one, at the call and
// never when the file loads. A component asks useNow for the time and passes it on.

const MS_PER_DAY = 86_400_000

const pad = (number, width = 2) => String(number).padStart(width, '0')

// The local day of d as 2026-10-18.
export function toLocalDateStr(d = new Date()) {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The local month of d as 2026-10.
export function monthKey(d = new Date()) {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}`
}

// Midnight at the start of the local day of d, as a new Date.
export function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Local midnight of a day on the calendar, or null when there is no such day
// (February 30 would otherwise roll over into March).
function calendarDay(year, month, day) {
  const d = new Date(year, month - 1, day)
  const exists = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
  return exists ? d : null
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const US_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

// A day written as 2026-03-10 or 03/10/2026, as local midnight of that day. These
// are the two spellings the documents hold. Anything else is null, a date with a
// time on it included: it is a moment, and the Date constructor reads a moment well.
export function parseDateStr(text) {
  if (typeof text !== 'string') return null
  const iso = ISO_DAY.exec(text)
  if (iso) return calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const us = US_DAY.exec(text)
  if (us) return calendarDay(Number(us[3]), Number(us[1]), Number(us[2]))
  return null
}

// A Date from whatever a document or a prop holds: a Date, a Firestore Timestamp,
// milliseconds, a day written either way above, or another string the Date
// constructor reads. A day comes back as local midnight, so a screen that shows or
// compares a saved day reads it here and never through new Date(text). Null when it is
// none of these or the Date is not a real one. Anything falsy is a field that was never
// filled in, zero included.
export function toDate(value) {
  if (!value) return null
  let date = null
  if (value instanceof Date) date = value
  else if (typeof value === 'number') date = new Date(value)
  else if (typeof value === 'string') date = parseDateStr(value) ?? new Date(value)
  else if (typeof value.toDate === 'function') date = value.toDate()
  return date && !Number.isNaN(date.getTime()) ? date : null
}

// The day of d counted from a fixed starting point. Built from the local year, month
// and day, so it moves on at local midnight and is exact, with no hour in it.
const dayNumber = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY

// The calendar days from a to b: 0 for two times on one day, 1 for the next day
// however close the two times are, negative when b is before a. Each is a Date or
// anything toDate reads. Null when either is not a date. Use it for two days on the
// calendar, such as today and a due date.
export function daysBetween(a, b) {
  const from = toDate(a)
  const to = toDate(b)
  return from && to ? dayNumber(to) - dayNumber(from) : null
}

// The whole days that have passed since dateLike, 0 for the first 24 hours. Use it
// for the age of something, such as the days since a job last changed. A day written
// without a time counts from the start of that local day. The hour that daylight
// saving adds or takes away is not counted as time passing, so a day is 24 hours on
// the wall clock in every week of the year. Null when dateLike is not a date.
export function daysSince(dateLike, now = new Date()) {
  const from = toDate(dateLike)
  if (!from) return null
  const wallClock = now.getTime() - from.getTime() + (from.getTimezoneOffset() - now.getTimezoneOffset()) * 60_000
  return Math.floor(wallClock / MS_PER_DAY)
}

// Sunday, October 18, 2026
export function fmtLongDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}
