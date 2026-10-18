import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Sending, approving and rejecting change orders, recording inspection results
// and creating jobs are done by Cloud Functions that check the caller's role and
// write the notification and the history entry with the change. If the browser
// writes any of it again, a builder or a client is back to deciding for itself
// what the database says, so none of these may come back.
const srcDir = resolve(import.meta.dirname, '..')

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

const files = sourceFiles(srcDir)
const read = (name) => readFileSync(files.find((f) => f.endsWith(name)), 'utf8')
const offenders = (pattern) => files.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f.slice(srcDir.length + 1))

describe('browser code', () => {
  it('finds the source files it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(20)
    for (const name of ['useFirestore.js', 'ClientPortal.jsx', 'QBSBuilderPortal.jsx', 'ChangeOrders.jsx', 'App.jsx']) {
      expect(files.some((f) => f.endsWith(name)), name).toBe(true)
    }
  })

  it('has no helper named sendExtraToQBS any more', () => {
    expect(offenders(/sendExtraToQBS/)).toEqual([])
  })

  it('writes no approved, rejected or sent status to a change order from anywhere', () => {
    expect(offenders(/status:\s*['"](approved|rejected|Approved|Rejected|Sent to Builder)['"]/)).toEqual([])
  })

  describe('the six callable helpers', () => {
    const start = (text) => text.indexOf('// ── Callable Cloud Functions')
    const section = () => {
      const text = read('useFirestore.js')
      return text.slice(start(text), text.indexOf('export function useDailyReports'))
    }

    it('are found', () => {
      const text = section()
      for (const name of ['sendExtraToBuilder', 'approveExtra', 'rejectExtra', 'passInspection', 'failInspection', 'createJob']) {
        expect(text, name).toContain(`export async function ${name}(`)
      }
    })

    it('leave no browser helper that writes a change order, a notification or an inspection record', () => {
      const text = read('useFirestore.js')
      for (const gone of ['updateExtra', 'addNotification', 'updateInspection']) {
        expect(text, gone).not.toMatch(new RegExp(`\\b${gone}\\b`))
      }
    })

    it('catch nothing and write nothing to Firestore, so a failed call reaches the caller', () => {
      const text = section()
      expect(text).not.toMatch(/\bcatch\b/)
      expect(text).not.toMatch(/\b(addDoc|updateDoc|setDoc|deleteDoc|writeBatch|runTransaction)\b/)
      expect(text).not.toMatch(/serverTimestamp/)
    })
  })

  describe.each(['ClientPortal.jsx', 'QBSBuilderPortal.jsx'])('%s', (name) => {
    it('writes no extras, notifications or history of its own', () => {
      const text = read(name)
      for (const writer of ['updateExtra', 'addNotification', 'addHistory', 'addExtra', 'updateDoc', 'addDoc', 'setDoc']) {
        expect(text, writer).not.toMatch(new RegExp(`\\b${writer}\\b`))
      }
    })

    it('reads a change order through extraState and never compares its status text', () => {
      const text = read(name)
      expect(text).toContain("from '../lib/extraStatus'")
      expect(text).not.toMatch(/\b(e|co|extra)\.status\b/)
    })
  })

  describe('ChangeOrders.jsx', () => {
    it('does not write the qbs flag or the send time, which sendExtraToBuilder sets', () => {
      const text = read('ChangeOrders.jsx')
      expect(text).not.toMatch(/\bqbs:\s/)
      expect(text).not.toMatch(/\bsentAt:\s/)
      expect(text).not.toMatch(/\bqbsSentAt\b/)
    })

    it('sends through the callable helper', () => {
      const text = read('ChangeOrders.jsx')
      expect(text).toMatch(/await sendExtraToBuilder\(/)
    })
  })

  describe('App.jsx', () => {
    it('creates jobs and records inspection results only through the callable helpers', () => {
      const text = read('App.jsx')
      expect(text).toMatch(/await createJob\(/)
      expect(text).toMatch(/record\(passInspection\)/)
      expect(text).toMatch(/record\(failInspection\)/)
      expect(text).not.toMatch(/addDoc\(collection\(db, ['"]jobs['"]/)
    })

    it('does not write passed or failed to a job itself: the status list sends both to the callable helpers', () => {
      const text = read('App.jsx')
      expect(text).not.toMatch(/updateJob\(docId, \{ \[field\]: e\.target\.value \}\)/)
      expect(text).toMatch(/next === 'passed'\) record\(passInspection\)/)
      expect(text).toMatch(/next === 'failed'\) record\(failInspection\)/)
    })
  })
})
