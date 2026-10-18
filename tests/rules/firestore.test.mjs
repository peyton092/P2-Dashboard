import { before, after, beforeEach, describe, it } from 'node:test'
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
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

    it('client reads crew_scores/austin succeeds', async () => {
      await t.seed((db) => setDoc(doc(db, 'crew_scores/austin'), { score: 9 }))
      await assertSucceeds(getDoc(doc(t.asClient('c1', []), 'crew_scores/austin')))
    })
  })

  describe('app_settings', () => {
    it('staff writes app_settings/google_review', async () => {
      await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'app_settings/google_review'), { url: 'x' }))
    })

    it('client writes app_settings/google_review fails', async () => {
      await assertFails(setDoc(doc(t.asClient('c1', []), 'app_settings/google_review'), { url: 'x' }))
    })

    it('client reads app_settings/google_review succeeds', async () => {
      await t.seed((db) => setDoc(doc(db, 'app_settings/google_review'), { url: 'x' }))
      await assertSucceeds(getDoc(doc(t.asClient('c1', []), 'app_settings/google_review')))
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
      await assertSucceeds(setDoc(doc(t.asStaff('s1'), 'users/x'), { role: 'builder' }))
    })

    it('owner writes users/x with role owner succeeds', async () => {
      await assertSucceeds(setDoc(doc(t.asOwner('o1'), 'users/x'), { role: 'owner' }))
    })

    it('client cannot write own users doc to escalate role', async () => {
      await assertFails(setDoc(doc(t.asClient('c1', []), 'users/c1'), { role: 'owner' }))
    })

    it('user can read own users doc', async () => {
      await t.seed((db) => setDoc(doc(db, 'users/c1'), { role: 'client' }))
      await assertSucceeds(getDoc(doc(t.asClient('c1', []), 'users/c1')))
    })
  })
})
