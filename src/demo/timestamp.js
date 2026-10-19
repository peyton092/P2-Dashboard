// The demo's Timestamp and server timestamp, the two Firestore values the app reads
// and writes besides plain data. A Timestamp is whole seconds since 1970 and the
// nanoseconds past them, with the methods the screens call on a stored time:
// toDate, toMillis, isEqual, and seconds and nanoseconds read directly. Nothing here
// reads the clock until it is asked for the time.

const NANOS_PER_SECOND = 1e9
const NANOS_PER_MILLI = 1e6

// The earliest second Firestore stores (the start of year 1), used so that valueOf
// gives a string that sorts in time order.
const MIN_SECONDS = -62135596800

export class Timestamp {
  constructor(seconds, nanoseconds) {
    if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= NANOS_PER_SECOND) {
      throw new TypeError(`A Timestamp needs whole seconds and nanoseconds below one second, not ${seconds} and ${nanoseconds}.`)
    }
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }

  static now() {
    return Timestamp.fromMillis(Date.now())
  }

  static fromDate(date) {
    return Timestamp.fromMillis(date.getTime())
  }

  static fromMillis(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000)
    const nanoseconds = Math.floor((milliseconds - seconds * 1000) * NANOS_PER_MILLI)
    return new Timestamp(seconds, nanoseconds)
  }

  toDate() {
    return new Date(this.toMillis())
  }

  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / NANOS_PER_MILLI
  }

  isEqual(other) {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds
  }

  // Negative when this is earlier than other, zero when they are the same moment.
  compareTo(other) {
    return this.seconds - other.seconds || this.nanoseconds - other.nanoseconds
  }

  // A string that sorts in time order, as Firestore's own does, so that two times
  // compared with < or > compare as moments.
  valueOf() {
    const seconds = String(this.seconds - MIN_SECONDS).padStart(12, '0')
    const nanoseconds = String(this.nanoseconds).padStart(9, '0')
    return `${seconds}.${nanoseconds}`
  }

  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds, type: 'firestore/timestamp/1.0' }
  }

  toString() {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`
  }
}

// The value serverTimestamp() gives. A write replaces it with the time of that write.
class ServerTimestampValue {
  constructor() {
    this._methodName = 'serverTimestamp'
  }

  isEqual(other) {
    return other instanceof ServerTimestampValue
  }
}

const SERVER_TIMESTAMP = Object.freeze(new ServerTimestampValue())

export const serverTimestampValue = () => SERVER_TIMESTAMP

export const isServerTimestamp = (value) => value instanceof ServerTimestampValue

// A clock for server timestamps that never gives the same moment twice: a write in the
// same millisecond as the one before it is stamped one microsecond after it, so a list
// ordered by the time things were written keeps the order they were written in.
export function serverClock() {
  let lastSeconds = -Infinity
  let lastNanos = 0
  return function next() {
    const now = Timestamp.now()
    let { seconds, nanoseconds } = now
    if (seconds < lastSeconds || (seconds === lastSeconds && nanoseconds <= lastNanos)) {
      seconds = lastSeconds
      nanoseconds = lastNanos + 1000
      if (nanoseconds >= NANOS_PER_SECOND) {
        seconds += 1
        nanoseconds -= NANOS_PER_SECOND
      }
    }
    lastSeconds = seconds
    lastNanos = nanoseconds
    return new Timestamp(seconds, nanoseconds)
  }
}
