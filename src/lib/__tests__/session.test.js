import { describe, it, expect } from 'vitest'
import { resolveSession, VALID_ROLES } from '../session'

describe('resolveSession', () => {
  it('returns a null role when neither claims nor document carry one', () => {
    expect(resolveSession({}, null, { displayName: '' }).role).toBeNull()
  })

  it('takes the role from the users document when claims have none', () => {
    expect(resolveSession({}, { role: 'internal' }, {}).role).toBe('internal')
  })

  it('lets claims win over the users document for role', () => {
    const s = resolveSession({ role: 'client', clientJobIds: ['QBS-001'] }, { role: 'owner' }, {})
    expect(s.role).toBe('client')
  })

  it('treats an unknown role as no role', () => {
    expect(resolveSession({}, { role: 'admin' }, {}).role).toBeNull()
    expect(resolveSession({ role: 'admin' }, null, {}).role).toBeNull()
  })

  it('defaults tenantId to qbs for builders', () => {
    expect(resolveSession({}, { role: 'builder' }, {}).tenantId).toBe('qbs')
  })

  it('defaults tenantId to p2-core for other roles', () => {
    expect(resolveSession({}, { role: 'internal' }, {}).tenantId).toBe('p2-core')
  })

  it('lets a claims clientJobIds array win over the document array', () => {
    const s = resolveSession(
      { role: 'client', clientJobIds: ['A'] },
      { clientJobIds: ['B'] },
      {},
    )
    expect(s.clientJobIds).toEqual(['A'])
  })

  it('falls back to the document clientJobIds, then an empty array', () => {
    expect(resolveSession({ role: 'client' }, { clientJobIds: ['B'] }, {}).clientJobIds).toEqual(['B'])
    expect(resolveSession({ role: 'client' }, null, {}).clientJobIds).toEqual([])
  })

  it('falls back to firebaseUser.displayName when nothing else names the user', () => {
    expect(resolveSession({}, { role: 'owner' }, { displayName: 'Jesse' }).displayName).toBe('Jesse')
    expect(resolveSession({}, { role: 'owner', displayName: 'Doc Name' }, { displayName: 'Jesse' }).displayName).toBe('Doc Name')
    expect(resolveSession({}, null, {}).displayName).toBe('')
  })

  it('falls back clientName to the document clientName, then displayName, then empty', () => {
    expect(resolveSession({ clientName: 'Claims Co' }, { clientName: 'Doc Co' }, {}).clientName).toBe('Claims Co')
    expect(resolveSession({}, { clientName: 'Doc Co', displayName: 'D' }, {}).clientName).toBe('Doc Co')
    expect(resolveSession({}, { displayName: 'D' }, {}).clientName).toBe('D')
    expect(resolveSession({}, null, {}).clientName).toBe('')
  })

  it('exports the four valid roles', () => {
    expect([...VALID_ROLES].sort()).toEqual(['builder', 'client', 'internal', 'owner'])
  })
})
