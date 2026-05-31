import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn (clsx + tailwind-merge wrapper)', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })

  it('drops falsy entries', () => {
    expect(cn('a', null, undefined, false, '', 'b')).toBe('a b')
  })

  it('flattens arrays', () => {
    expect(cn('a', ['b', 'c'], 'd')).toBe('a b c d')
  })

  it('respects clsx object syntax for conditional classes', () => {
    expect(cn('a', { b: true, c: false, d: true })).toBe('a b d')
  })

  it('uses tailwind-merge to deduplicate conflicting utilities (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm', 'text-base')).toBe('text-base')
  })

  it('preserves non-conflicting utilities', () => {
    expect(cn('px-4', 'py-2', 'rounded-md')).toBe('px-4 py-2 rounded-md')
  })
})
