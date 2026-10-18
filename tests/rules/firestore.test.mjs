import { before, after, beforeEach, describe, it } from 'node:test'
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
import { setupEnv } from './helpers.mjs'

describe('firestore rules', () => {
  let t

  before(async () => {
    t = await setupEnv()
    await t.env.clearFirestore()
  })

  after(async () => {
    await t.env.cleanup()
  })

  beforeEach(async () => {
    await t.env.clearFirestore()
    // A staff member who has a users doc but NO custom claim.
    await t.seed((db) => setDoc(doc(db, 'users/staff1'), { role: 'internal' }))
  })

  describe('staff without a custom claim (role from users doc)', () => {
    it('writes config/settings', async () => {
      const db = t.asUserWithDoc('staff1')
      await assertSucceeds(setDoc(doc(db, 'config/settings'), { a: 1 }))
    })

    it('reads qb_config/tokens', async () => {
      await t.seed((db) => setDoc(doc(db, 'qb_config/tokens'), { x: 1 }))
      const db = t.asUserWithDoc('staff1')
      await assertSucceeds(getDoc(doc(db, 'qb_config/tokens')))
    })

    it('a signed in user with no claim and no users doc cannot read qb_config/tokens', async () => {
      const db = t.asUserWithDoc('nobody')
      await assertFails(getDoc(doc(db, 'qb_config/tokens')))
    })

    it('a user whose users doc says client cannot read qb_config/tokens', async () => {
      await t.seed((db) => setDoc(doc(db, 'users/c1'), { role: 'client' }))
      const db = t.asUserWithDoc('c1')
      await assertFails(getDoc(doc(db, 'qb_config/tokens')))
    })
  })

  describe('error_logs', () => {
    it('signed in user creates own error_logs doc', async () => {
      const db = t.env.authenticatedContext('u1', { role: 'client', email: 'u1@example.com' }).firestore()
      await assertSucceeds(setDoc(doc(db, 'error_logs/e1'), { userEmail: 'u1@example.com', message: 'boom' }))
    })

    it('rejects an error_logs doc with a spoofed userEmail', async () => {
      const db = t.env.authenticatedContext('u1', { role: 'client', email: 'u1@example.com' }).firestore()
      await assertFails(setDoc(doc(db, 'error_logs/e2'), { userEmail: 'other@example.com', message: 'boom' }))
    })

    it('anon cannot create error_logs', async () => {
      await assertFails(setDoc(doc(t.asAnon(), 'error_logs/e3'), { userEmail: 'a@example.com' }))
    })

    it('client reads error_logs fails', async () => {
      await t.seed((db) => setDoc(doc(db, 'error_logs/e1'), { userEmail: 'u1@example.com' }))
      await assertFails(getDoc(doc(t.asClient('c1', ['j1']), 'error_logs/e1')))
    })

    it('staff reads error_logs succeeds', async () => {
      await t.seed((db) => setDoc(doc(db, 'error_logs/e1'), { userEmail: 'u1@example.com' }))
      await assertSucceeds(getDoc(doc(t.asStaff('s1'), 'error_logs/e1')))
    })
  })

  describe('crew_scores', () => {
    it('staff writes crew_scores/austin', async () => {
      await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'crew_scores/austin'), { score: 9 }))
    })

    it('client writes crew_scores/austin fails', async () => {
      await assertFails(setDoc(doc(t.asClient('c1', []), 'crew_scores/austin'), { score: 9 }))
    })

    it('client reads crew_scores/austin fails, staff reads it', async () => {
      await t.seed((db) => setDoc(doc(db, 'crew_scores/austin'), { score: 9 }))
      await assertFails(getDoc(doc(t.asClient('c1', []), 'crew_scores/austin')))
      await assertFails(getDoc(doc(t.asBuilder('b1', 'qbs'), 'crew_scores/austin')))
      await assertSucceeds(getDoc(doc(t.asStaff('s1'), 'crew_scores/austin')))
    })
  })

  describe('app_settings', () => {
    it('staff writes app_settings/google_review', async () => {
      await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'app_settings/google_review'), { url: 'x' }))
    })

    it('client writes app_settings/google_review fails', async () => {
      await assertFails(setDoc(doc(t.asClient('c1', []), 'app_settings/google_review'), { url: 'x' }))
    })

    it('client reads app_settings/google_review fails, staff reads it', async () => {
      await t.seed((db) => setDoc(doc(db, 'app_settings/google_review'), { url: 'x' }))
      await assertFails(getDoc(doc(t.asClient('c1', []), 'app_settings/google_review')))
      await assertFails(getDoc(doc(t.asBuilder('b1', 'qbs'), 'app_settings/google_review')))
      await assertSucceeds(getDoc(doc(t.asStaff('s1'), 'app_settings/google_review')))
    })
  })

  describe('fcm_tokens', () => {
    it('client writes fcm_tokens/t1 with uid equal to own uid', async () => {
      await assertSucceeds(setDoc(doc(t.asClient('c1', []), 'fcm_tokens/t1'), { token: 't1', uid: 'c1' }))
    })

    it('client writes fcm_tokens/t2 with uid of another user fails', async () => {
      await assertFails(setDoc(doc(t.asClient('c1', []), 'fcm_tokens/t2'), { token: 't2', uid: 'someone-else' }))
    })

    it('client cannot read fcm_tokens', async () => {
      await t.seed((db) => setDoc(doc(db, 'fcm_tokens/t1'), { token: 't1', uid: 'c1' }))
      await assertFails(getDoc(doc(t.asClient('c1', []), 'fcm_tokens/t1')))
    })
  })

  describe('users', () => {
    it('anon writes users/x fails', async () => {
      await assertFails(setDoc(doc(t.asAnon(), 'users/x'), { role: 'client' }))
    })

    it('internal writes users/x with role owner fails', async () => {
      await assertFails(setDoc(doc(t.asStaff('s1'), 'users/x'), { role: 'owner' }))
    })

    it('internal writes users/x with role client succeeds', async () => {
      await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/x'), { role: 'client' }))
    })

    it('internal writes users/x with role builder succeeds', async () => {
      await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/x'), { role: 'builder', tenantId: 'qbs' }))
    })

    it('owner writes users/x with role owner succeeds', async () => {
      await assertSucceeds(setDoc(doc(t.asOwner('o1'), 'users/x'), { role: 'owner' }))
    })

    it('client cannot write own users doc to escalate role', async () => {
      await assertFails(setDoc(doc(t.asClient('c1', []), 'users/c1'), { role: 'owner' }))
    })

    // Roles reach the app through claims that the onUserWritten function copies
    // from these documents, and createUser (owner only) is the supported way to
    // make one. These pin who may write one directly.
    it('internal writes users/x with role internal fails (only an owner creates staff)', async () => {
      await assertFails(setDoc(doc(t.asStaff('s1'), 'users/x'), { role: 'internal' }))
    })

    it('internal writes users/x with no role fails', async () => {
      await assertFails(setDoc(doc(t.asStaff('s1'), 'users/x'), { displayName: 'No Role' }))
    })

    it('owner writes users/x with role internal succeeds', async () => {
      await assertSucceeds(setDoc(doc(t.asOwner('o1'), 'users/x'), { role: 'internal' }))
    })

    it('builder and client cannot write another users doc, even a client one', async () => {
      await assertFails(setDoc(doc(t.asBuilder('b1', 'qbs'), 'users/x'), { role: 'client' }))
      await assertFails(setDoc(doc(t.asClient('c1', ['QBS-001']), 'users/x'), { role: 'client' }))
    })

    it('owner deletes a users doc succeeds, internal fails', async () => {
      await t.seed((db) => setDoc(doc(db, 'users/x'), { role: 'client' }))
      await assertFails(deleteDoc(doc(t.asStaff('s1'), 'users/x')))
      await assertSucceeds(deleteDoc(doc(t.asOwner('o1'), 'users/x')))
    })

    // Internal staff manage builder and client records. They cannot rewrite the
    // record of an owner or of other staff (onUserWritten would turn that into a
    // demotion and a sign out), and a builder always needs a real builder tenant.
    describe('internal staff and existing records', () => {
      const seedUsers = () =>
        t.seed(async (db) => {
          await setDoc(doc(db, 'users/o1'), { role: 'owner', displayName: 'Jesse' })
          await setDoc(doc(db, 'users/i1'), { role: 'internal', displayName: 'Ian' })
          await setDoc(doc(db, 'users/c1'), { role: 'client', clientJobIds: ['QBS-001'] })
          await setDoc(doc(db, 'users/b1'), { role: 'builder', tenantId: 'qbs' })
        })

      it('internal updates an existing owner doc to client fails, set or merge', async () => {
        await seedUsers()
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/o1'), { role: 'client', clientJobIds: [] }))
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/o1'), { role: 'client' }, { merge: true }))
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/o1'), { role: 'builder', tenantId: 'qbs' }))
      })

      it('internal updates an existing internal doc to client fails, set or merge', async () => {
        await seedUsers()
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/i1'), { role: 'client', clientJobIds: [] }))
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/i1'), { role: 'client' }, { merge: true }))
      })

      it('internal updates an existing client doc (clientJobIds) succeeds', async () => {
        await seedUsers()
        await assertSucceeds(
          setDoc(doc(t.asStaff('s1'), 'users/c1'), { role: 'client', clientJobIds: ['QBS-001', 'QBS-002'] }),
        )
        await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/c1'), { clientJobIds: ['QBS-002'] }, { merge: true }))
      })

      it('internal updates an existing builder doc to the other builder tenant succeeds', async () => {
        await seedUsers()
        await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/b1'), { tenantId: 'vision' }, { merge: true }))
      })

      it('internal creates a builder doc in either builder tenant succeeds', async () => {
        await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/new1'), { role: 'builder', tenantId: 'qbs' }))
        await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/new2'), { role: 'builder', tenantId: 'vision' }))
      })

      it('internal creates a builder with tenantId p2-core fails', async () => {
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/new1'), { role: 'builder', tenantId: 'p2-core' }))
      })

      it('internal creates a builder with another tenant or none fails', async () => {
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/new1'), { role: 'builder', tenantId: 'acme' }))
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/new2'), { role: 'builder' }))
      })

      it('internal moves an existing builder or client doc to a builder in p2-core fails', async () => {
        await seedUsers()
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/b1'), { tenantId: 'p2-core' }, { merge: true }))
        await assertFails(setDoc(doc(t.asStaff('s1'), 'users/c1'), { role: 'builder', tenantId: 'p2-core' }))
      })

      it('owner demotes an internal to client succeeds', async () => {
        await seedUsers()
        await assertSucceeds(setDoc(doc(t.asOwner('o2'), 'users/i1'), { role: 'client', clientJobIds: [] }))
      })

      it('owner rewrites any record, including another owner and a builder tenant', async () => {
        await seedUsers()
        await assertSucceeds(setDoc(doc(t.asOwner('o2'), 'users/o1'), { role: 'internal' }))
        await assertSucceeds(setDoc(doc(t.asOwner('o2'), 'users/b1'), { role: 'builder', tenantId: 'p2-core' }))
      })
    })

    it('user can read own users doc', async () => {
      await t.seed((db) => setDoc(doc(db, 'users/c1'), { role: 'client' }))
      await assertSucceeds(getDoc(doc(t.asClient('c1', []), 'users/c1')))
    })
  })
})
