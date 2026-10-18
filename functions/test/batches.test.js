import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BATCH_SIZE, JOB_ID_CHUNK, chunks } from '../lib/batches.js'

describe('chunks', () => {
  it('splits a list into parts of at most the size, in order, with the short part last', () => {
    assert.deepEqual(chunks([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]])
  })

  it('gives parts that all hold exactly the size when the list divides evenly', () => {
    assert.deepEqual(chunks(['a', 'b', 'c', 'd'], 2), [['a', 'b'], ['c', 'd']])
  })

  it('gives one short part when the list is smaller than the size', () => {
    assert.deepEqual(chunks(['a', 'b'], 10), [['a', 'b']])
  })

  it('gives no parts at all for an empty list', () => {
    assert.deepEqual(chunks([], 10), [])
  })

  it('does not change the list it is given, and shares nothing with it', () => {
    const list = [1, 2, 3, 4]
    const parts = chunks(list, 2)
    parts[0].push(99)
    assert.deepEqual(list, [1, 2, 3, 4])
  })

  it('keeps every item exactly once', () => {
    const list = Array.from({ length: 1003 }, (_, i) => i)
    assert.deepEqual(chunks(list, 400).flat(), list)
    assert.deepEqual(chunks(list, 400).map((part) => part.length), [400, 400, 203])
  })
})

describe('the batching constants', () => {
  it('looks job ids up ten at a time', () => {
    assert.equal(JOB_ID_CHUNK, 10)
  })

  it('writes at most 400 documents in a batch, well under the 500 Firestore allows', () => {
    assert.equal(BATCH_SIZE, 400)
    assert.ok(BATCH_SIZE < 500)
  })
})
