import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('cn', () => {
  it('merges classes', () => {
    expect(cn('a', 'b')).toBe('a b')
  })
})
