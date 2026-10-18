import { describe, it, expect } from 'vitest'
import { extraState, statusOnSave } from '../extraStatus'

// The same cases as functions/test/extras.test.js: the server and the browser
// each keep a copy of extraState, and these tests keep the two the same.
describe('extraState', () => {
  it.each([
    ['Draft', 'draft'],
    ['Sent to Builder', 'pending'],
    ['pending', 'pending'],
    ['Approved', 'approved'],
    ['approved', 'approved'],
    ['Rejected', 'rejected'],
    ['rejected', 'rejected'],
    ['', 'pending'],
    ['Cancelled', 'pending'],
    ['draft', 'pending'],
    ['APPROVED', 'pending'],
    ['REJECTED', 'pending'],
    ['Sent To Builder', 'pending'],
  ])('reads status %j as %s', (status, state) => {
    expect(extraState({ status })).toBe(state)
  })

  it('reads a missing, null or non string status as pending', () => {
    expect(extraState({})).toBe('pending')
    expect(extraState({ status: null })).toBe('pending')
    expect(extraState({ status: undefined })).toBe('pending')
    expect(extraState({ status: 7 })).toBe('pending')
    expect(extraState({ status: ['Approved'] })).toBe('pending')
  })

  it('reads a missing extra as pending', () => {
    expect(extraState(null)).toBe('pending')
    expect(extraState(undefined)).toBe('pending')
  })

  it('reads the stored statuses the screens meet today: the demo data, older approvals and the Change Orders screen', () => {
    // demo data and older browser writes
    expect(['pending', 'approved', 'rejected'].map(status => extraState({ status }))).toEqual(['pending', 'approved', 'rejected'])
    // Change Orders screen and the callables
    expect(['Draft', 'Sent to Builder', 'Approved', 'Rejected'].map(status => extraState({ status }))).toEqual(['draft', 'pending', 'approved', 'rejected'])
  })
})

// The Change Orders screen creates and edits change orders. Sending, approving
// and rejecting belong to the Cloud Functions, so a save never moves one on.
describe('statusOnSave', () => {
  it('starts a new change order as a draft', () => {
    expect(statusOnSave(null)).toEqual({ status: 'Draft' })
    expect(statusOnSave(undefined)).toEqual({ status: 'Draft' })
  })

  it('treats something that has not been saved yet as new, whatever status it carries', () => {
    expect(statusOnSave({ status: 'Approved' })).toEqual({ status: 'Draft' })
    expect(statusOnSave({})).toEqual({ status: 'Draft' })
  })

  it('leaves the status of a saved change order alone, so an edit cannot undo a decision made meanwhile', () => {
    for (const status of ['Draft', 'Sent to Builder', 'Approved', 'Rejected', 'pending', 'approved', 'rejected']) {
      expect(statusOnSave({ _docId: 'x1', status })).toEqual({})
    }
  })

  it('makes a saved change order that has no status a draft', () => {
    expect(statusOnSave({ _docId: 'x1' })).toEqual({ status: 'Draft' })
    expect(statusOnSave({ _docId: 'x1', status: '' })).toEqual({ status: 'Draft' })
    expect(statusOnSave({ _docId: 'x1', status: null })).toEqual({ status: 'Draft' })
  })

  it('never offers a status other than Draft', () => {
    for (const saved of [null, {}, { _docId: 'x1' }, { _docId: 'x1', status: 'Sent to Builder' }, { _docId: 'x1', status: 'Approved' }]) {
      const { status } = statusOnSave(saved)
      expect([undefined, 'Draft']).toContain(status)
    }
  })
})
