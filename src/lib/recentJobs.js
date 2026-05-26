// Lightweight "recently viewed jobs" memory backed by localStorage. Tracks
// the last N job ids the user opened so the command palette can offer a
// one-keystroke jump back.

const KEY = 'p2_recent_jobs'
const LIMIT = 6

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter(s => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function getRecentJobs() {
  return read()
}

export function pushRecentJob(id) {
  if (!id) return
  try {
    const next = [id, ...read().filter(x => x !== id)].slice(0, LIMIT)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* storage unavailable */ }
}
