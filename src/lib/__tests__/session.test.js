import { describe, it, expect } from 'vitest'
import { resolveSession, VALID_ROLES } from '../session'

describe('resolveSession', () => {
  it('returns a null role when neither claims nor document carry one', () => {
    expect(resolveSession({}, null, { displayName: '' }).role).toBeNull()
  })

  it('a users document with no role gives no role', () => {
    const s = resolveSession({}, { displayName: 'Pat Lee', tenantId: 'p2-core', clientJobIds: [] }, { displayName: 'Pat' })
    expect(s.role).toBeNull()
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

  // The rules give a builder the documents of their tenant, so a builder with no
  // tenant can read nothing and is shown the No Access screen instead of a portal.
  it('a builder without a tenant has no access', () => {
    expect(resolveSession({}, { role: 'builder' }, {})).toMatchObject({ role: null, tenantId: null })
    expect(resolveSession({ role: 'builder', tenantId: null, clientJobIds: [] }, null, {}))
      .toMatchObject({ role: null, tenantId: null })
    expect(resolveSession({ role: 'builder' }, { role: 'builder', tenantId: '' }, {}))
      .toMatchObject({ role: null, tenantId: null })
  })

  // A builder belongs to qbs or vision. p2-core is P2's own, and any other value is no
  // tenant at all, so either one leaves the builder with no access.
  it('a builder whose tenant is p2-core or any tenant but qbs and vision has no access', () => {
    expect(resolveSession({ role: 'builder', tenantId: 'p2-core', clientJobIds: [] }, null, {}))
      .toMatchObject({ role: null, tenantId: null })
    expect(resolveSession({}, { role: 'builder', tenantId: 'p2-core' }, {}))
      .toMatchObject({ role: null, tenantId: null })
    expect(resolveSession({}, { role: 'builder', tenantId: 'acme' }, {}))
      .toMatchObject({ role: null, tenantId: null })
  })

  it('a builder keeps a valid tenant from claims or the document', () => {
    expect(resolveSession({ role: 'builder', tenantId: 'vision', clientJobIds: [] }, null, {}))
      .toMatchObject({ role: 'builder', tenantId: 'vision' })
    expect(resolveSession({}, { role: 'builder', tenantId: 'qbs' }, {}))
      .toMatchObject({ role: 'builder', tenantId: 'qbs' })
    expect(resolveSession({ role: 'builder', tenantId: 'vision' }, { tenantId: 'qbs' }, {}).tenantId).toBe('vision')
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

  it('names a client from the Firebase user when claims are complete and no document was read', () => {
    // createUser sets the claims and the Auth display name together, and the app
    // skips the users document when the claims already carry a role and job ids.
    const claims = { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-001'] }
    expect(resolveSession(claims, null, { displayName: 'Lee Homes' }).clientName).toBe('Lee Homes')
  })

  it('still prefers a document name over the Firebase user for clientName', () => {
    const fu = { displayName: 'Auth Name' }
    expect(resolveSession({}, { clientName: 'Doc Co' }, fu).clientName).toBe('Doc Co')
    expect(resolveSession({}, { displayName: 'Doc Name' }, fu).clientName).toBe('Doc Name')
    expect(resolveSession({ clientName: 'Claims Co' }, null, fu).clientName).toBe('Claims Co')
  })

  it('exports the four valid roles', () => {
    expect([...VALID_ROLES].sort()).toEqual(['builder', 'client', 'internal', 'owner'])
  })
})
