// The time zone of the business, for the days the server writes. The company is in
// Middle Tennessee, which is on Central time, and the calendar a person looks at is the
// one there. The UTC day turns over at 7 pm in summer and 6 pm in winter, so a day cut
// out of an ISO string names tomorrow for part of every evening. Wherever the server
// writes a day for people to read, it asks businessDay. Changing the zone of the
// business means changing this one constant.
//
// Nothing here imports Firebase, so it is unit tested directly.

export const BUSINESS_TIME_ZONE = 'America/Chicago'

// Built once. The parts are read by name, so the answer does not rest on how a locale
// happens to order or separate them, and the zone is given outright, so it does not
// depend on the zone of the machine that runs the function.
const dayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// The day it is in the business time zone at `now`, as YYYY-MM-DD.
export function businessDay(now = new Date()) {
  const parts = Object.fromEntries(dayParts.formatToParts(now).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
