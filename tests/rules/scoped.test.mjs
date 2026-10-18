import { before, after, beforeEach, describe, it } from 'node:test'
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { setupEnv } from './helpers.mjs'

// Builders and clients read only the documents in their scope. Each scoped document
// carries tenantId and clientUids; a builder reads what carries their tenant and a
// client what lists their uid. Firestore checks a list query against the rules
// before running it, so the portals' queries must carry the same filter.

// The list queries the portals run, as queryFor in src/hooks/useFirestore.js builds
// them: the scope filter, then the order and the cap each list has always had.
const ORDER = { jobs: ['id'], extras: ['date'], notifications: ['createdAt', 'desc'], submits: ['createdAt', 'desc'] }
const CAP = { jobs: 200, extras: 500, notifications: 100, submits: 100 }
const list = (db, name, ...filters) =>
  getDocs(query(collection(db, name), ...filters, orderBy(...ORDER[name]), limit(CAP[name])))
const ofTenant = (tenantId) => where('tenantId', '==', tenantId)
const listing = (uid) => where('clientUids', 'array-contains', uid)

const at = (day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`

// Two QBS jobs (the first has client c1), a Vision job (client c2), and a job that
// was never stamped with a scope. Each stamped job has a change order, a
// notification and a submission carrying its scope, as the triggers leave them.
async function seedScoped(t) {
  await t.seed(async (db) => {
    const put = (path, data) => setDoc(doc(db, path), data)
    await put('jobs/qbs1', { id: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], address: '12 Oak St' })
    await put('jobs/qbs2', { id: 'QBS-002', tenantId: 'qbs', clientUids: [], address: '14 Oak St' })
    await put('jobs/vis1', { id: 'VIS-001', tenantId: 'vision', clientUids: ['c2'], address: '9 Elm St' })
    await put('jobs/bare', { id: 'QBS-009', address: '1 Old Rd' })

    await put('extras/x1', { job: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], date: at(1), desc: 'Extra outlet', amount: 250, status: 'Sent to Builder' })
    await put('extras/x2', { job: 'VIS-001', tenantId: 'vision', clientUids: ['c2'], date: at(2), desc: 'Gas line', amount: 900, status: 'Sent to Builder' })

    await put('notifications/n1', { type: 'success', msg: 'Rough in passed on QBS-001', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], read: false, createdAt: at(3) })
    await put('notifications/n2', { type: 'warn', msg: 'Final failed on VIS-001', jobId: 'VIS-001', tenantId: 'vision', clientUids: ['c2'], read: false, createdAt: at(4) })

    await put('submits/s1', { subject: 'Gate code', body: 'What is the gate code?', portal: 'Client', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], status: 'Open', createdBy: 'c1', createdAt: at(5) })
    await put('submits/s2', { subject: 'Meter', body: 'When is the meter set?', portal: 'Client', jobId: 'VIS-001', tenantId: 'vision', clientUids: ['c2'], status: 'Open', createdBy: 'c2', createdAt: at(6) })
    await put('submits/s1/replies/r1', { body: 'Code is 4411', author: 'P2 Team', authorRole: 'internal', createdBy: 's1', createdAt: at(7) })
    await put('submits/s2/replies/r2', { body: 'Next Tuesday', author: 'P2 Team', authorRole: 'internal', createdBy: 's1', createdAt: at(8) })

    await put('jobs/qbs1/files/f1', { name: 'panel.jpg', source: 'companycam', createdAt: at(9) })
    await put('jobs/vis1/files/f2', { name: 'permit.pdf', source: 'staff', createdAt: at(10) })

    // People whose role is only in their users document (no custom claims yet).
    await put('users/b9', { role: 'builder', tenantId: 'qbs' })
    await put('users/c9', { role: 'client', clientJobIds: ['QBS-001'] })
    await put('users/s9', { role: 'internal' })
  })
}

// A submission as the portals create it, with withAuthor's fields.
const newSubmit = (uid, over) => ({
  subject: 'Inspection date',
  category: 'Question',
  priority: 'Medium',
  body: 'When is the final?',
  status: 'Open',
  createdBy: uid,
  createdByEmail: `${uid}@p2.test`,
  createdAt: serverTimestamp(),
  ...over,
})

const newReply = (uid, over) => ({
  body: 'Thanks',
  author: 'Lee Homes',
  authorRole: 'client',
  createdBy: uid,
  createdByEmail: `${uid}@p2.test`,
  createdAt: serverTimestamp(),
  ...over,
})

// The record ClientPortal writes after a client uploads a file to their job.
const clientUpload = (uid, over) => ({
  name: 'plan.pdf',
  url: 'https://firebasestorage.googleapis.com/v0/b/p2-dashboard/o/plan.pdf',
  type: 'application/pdf',
  size: 1024,
  source: 'client-upload',
  uploadedBy: uid,
  uploadedByName: 'Lee Homes',
  createdBy: uid,
  createdByEmail: `${uid}@p2.test`,
  createdAt: serverTimestamp(),
  ...over,
})

describe('scoped reads and writes', () => {
  let t

  before(async () => {
    t = await setupEnv()
  })

  after(async () => {
    await t.env.cleanup()
  })

  beforeEach(async () => {
    await t.env.clearFirestore()
    await seedScoped(t)
  })

  const builderQbs = () => t.asBuilder('b1', 'qbs')
  const builderVision = () => t.asBuilder('b2', 'vision')
  const clientOne = () => t.asClient('c1', ['QBS-001'])
  const clientTwo = () => t.asClient('c2', ['VIS-001'])

  describe('jobs', () => {
    it('a qbs builder reads a qbs job', async () => {
      await assertSucceeds(getDoc(doc(builderQbs(), 'jobs/qbs1')))
    })

    it('a qbs builder cannot read a vision job', async () => {
      await assertFails(getDoc(doc(builderQbs(), 'jobs/vis1')))
    })

    it('a qbs builder cannot list the vision jobs', async () => {
      await assertFails(list(builderQbs(), 'jobs', ofTenant('vision')))
    })

    it('a qbs builder lists the qbs jobs', async () => {
      const snap = await assertSucceeds(list(builderQbs(), 'jobs', ofTenant('qbs')))
      if (snap.size !== 2) throw new Error(`expected the two qbs jobs, got ${snap.size}`)
    })

    it('a builder cannot list the jobs unscoped', async () => {
      await assertFails(list(builderQbs(), 'jobs'))
    })

    it('a vision builder reads the vision job and not a qbs one', async () => {
      await assertSucceeds(getDoc(doc(builderVision(), 'jobs/vis1')))
      await assertFails(getDoc(doc(builderVision(), 'jobs/qbs1')))
    })

    it('a builder whose tenant is only in their users document reads a qbs job', async () => {
      await assertSucceeds(getDoc(doc(t.asUserWithDoc('b9'), 'jobs/qbs1')))
      await assertSucceeds(list(t.asUserWithDoc('b9'), 'jobs', ofTenant('qbs')))
      await assertFails(getDoc(doc(t.asUserWithDoc('b9'), 'jobs/vis1')))
    })

    it('a builder with no tenant reads nothing, not even a job without a tenant', async () => {
      // A missing tenant must not match a tenant that is set to nothing either.
      await t.seed((db) => setDoc(doc(db, 'jobs/nulled'), { id: 'QBS-010', tenantId: null, clientUids: [] }))
      for (const db of [t.asBuilder('b3', null), t.asBuilder('b4')]) {
        await assertFails(getDoc(doc(db, 'jobs/qbs1')))
        await assertFails(getDoc(doc(db, 'jobs/bare')))
        await assertFails(getDoc(doc(db, 'jobs/nulled')))
      }
    })

    it('a client reads a job that lists their uid', async () => {
      await assertSucceeds(getDoc(doc(clientOne(), 'jobs/qbs1')))
    })

    it('a client cannot read a job that does not list their uid', async () => {
      await assertFails(getDoc(doc(clientOne(), 'jobs/qbs2')))
      await assertFails(getDoc(doc(clientOne(), 'jobs/vis1')))
    })

    it('a client cannot read a job that has no clientUids at all', async () => {
      await assertFails(getDoc(doc(clientOne(), 'jobs/bare')))
    })

    it('a client lists the jobs that list their uid', async () => {
      const snap = await assertSucceeds(list(clientOne(), 'jobs', listing('c1')))
      if (snap.size !== 1) throw new Error(`expected one job, got ${snap.size}`)
    })

    // Before the backfill has stamped a client's job, no job lists them. Their
    // queries must still be allowed and come back empty, so the portal shows its
    // empty state rather than a refused listener.
    it('a client whose job is not stamped yet lists nothing, and is not refused', async () => {
      const db = t.asClient('c5', ['QBS-009'])
      for (const name of ['jobs', 'extras', 'notifications', 'submits']) {
        const snap = await assertSucceeds(list(db, name, listing('c5')))
        if (snap.size !== 0) throw new Error(`expected no ${name}, got ${snap.size}`)
      }
      await assertFails(getDoc(doc(db, 'jobs/bare')))
    })

    it('a client cannot list the jobs unscoped, or the jobs of another client', async () => {
      await assertFails(list(clientOne(), 'jobs'))
      await assertFails(list(clientOne(), 'jobs', listing('c2')))
    })

    it('builders and clients cannot write a job', async () => {
      for (const db of [builderQbs(), clientOne()]) {
        await assertFails(updateDoc(doc(db, 'jobs/qbs1'), { status: 'complete' }))
        await assertFails(setDoc(doc(db, 'jobs/new1'), { id: 'QBS-050', tenantId: 'qbs', clientUids: [] }))
        await assertFails(deleteDoc(doc(db, 'jobs/qbs1')))
      }
    })
  })

  describe('change orders', () => {
    it('a qbs builder lists the qbs change orders and cannot read a vision one', async () => {
      await assertSucceeds(list(builderQbs(), 'extras', ofTenant('qbs')))
      await assertFails(getDoc(doc(builderQbs(), 'extras/x2')))
    })

    it('a client cannot list the change orders unscoped', async () => {
      await assertFails(list(clientOne(), 'extras'))
    })

    it('a client lists the change orders that list their uid', async () => {
      const snap = await assertSucceeds(list(clientOne(), 'extras', listing('c1')))
      if (snap.size !== 1) throw new Error(`expected one change order, got ${snap.size}`)
      await assertFails(getDoc(doc(clientOne(), 'extras/x2')))
    })

    it('builders and clients cannot write a change order, staff can', async () => {
      const draft = { job: 'QBS-001', desc: 'Dedicated circuit', amount: 400, status: 'Draft', date: at(11), createdBy: 'x', createdByEmail: 'x@p2.test' }
      for (const db of [builderQbs(), clientOne()]) {
        await assertFails(updateDoc(doc(db, 'extras/x1'), { status: 'Approved' }))
        await assertFails(addDoc(collection(db, 'extras'), draft))
      }
      // The Change Orders screen writes extras directly.
      await assertSucceeds(addDoc(collection(t.asStaff('s1'), 'extras'), { ...draft, createdBy: 's1', createdByEmail: 's1@p2.test' }))
      await assertSucceeds(updateDoc(doc(t.asStaff('s1'), 'extras/x1'), { amount: 300 }))
    })
  })

  describe('notifications', () => {
    it('a client marks a notification about their job as read', async () => {
      await assertSucceeds(updateDoc(doc(clientOne(), 'notifications/n1'), { read: true }))
    })

    it('a client cannot change what a notification says', async () => {
      await assertFails(updateDoc(doc(clientOne(), 'notifications/n1'), { msg: 'Rough in failed on QBS-001' }))
      await assertFails(updateDoc(doc(clientOne(), 'notifications/n1'), { read: true, msg: 'Rough in failed on QBS-001' }))
    })

    it('a builder marks a notification of their tenant as read, and not one of another tenant', async () => {
      await assertSucceeds(updateDoc(doc(builderQbs(), 'notifications/n1'), { read: true }))
      await assertFails(updateDoc(doc(builderQbs(), 'notifications/n2'), { read: true }))
    })

    it('builders and clients list only their own notifications', async () => {
      await assertSucceeds(list(builderQbs(), 'notifications', ofTenant('qbs')))
      await assertSucceeds(list(clientOne(), 'notifications', listing('c1')))
      await assertFails(list(builderQbs(), 'notifications'))
      await assertFails(list(clientOne(), 'notifications'))
      await assertFails(getDoc(doc(clientOne(), 'notifications/n2')))
    })

    it('only staff create or delete a notification', async () => {
      const alert = { type: 'info', msg: 'Job created', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], read: false, createdAt: serverTimestamp() }
      for (const db of [builderQbs(), clientOne()]) {
        await assertFails(addDoc(collection(db, 'notifications'), alert))
        await assertFails(deleteDoc(doc(db, 'notifications/n1')))
      }
      await assertSucceeds(addDoc(collection(t.asStaff('s1'), 'notifications'), alert))
      await assertSucceeds(deleteDoc(doc(t.asStaff('s1'), 'notifications/n1')))
    })

    it('staff dismiss a notification', async () => {
      await assertSucceeds(updateDoc(doc(t.asStaff('s1'), 'notifications/n2'), { dismissed: true, read: true }))
    })
  })

  describe('submissions', () => {
    it('a client creates a submission for their own job, stamped with their uid', async () => {
      await assertSucceeds(addDoc(collection(clientOne(), 'submits'), newSubmit('c1', {
        portal: 'Client', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'],
      })))
    })

    it('a client cannot create a submission for a job that is not theirs', async () => {
      await assertFails(addDoc(collection(clientOne(), 'submits'), newSubmit('c1', {
        portal: 'Client', jobId: 'VIS-001', tenantId: 'vision', clientUids: ['c1'],
      })))
    })

    it('a client cannot create a submission with no job', async () => {
      await assertFails(addDoc(collection(clientOne(), 'submits'), newSubmit('c1', { portal: 'Client', clientUids: ['c1'] })))
    })

    it('a client submission lists exactly its author in clientUids', async () => {
      for (const clientUids of [['c1', 'c2'], ['c2'], []]) {
        await assertFails(addDoc(collection(clientOne(), 'submits'), newSubmit('c1', { portal: 'Client', jobId: 'QBS-001', clientUids })))
      }
      await assertFails(addDoc(collection(clientOne(), 'submits'), newSubmit('c1', { portal: 'Client', jobId: 'QBS-001' })))
    })

    it('a submission is created as the person signed in', async () => {
      await assertFails(addDoc(collection(clientOne(), 'submits'), newSubmit('c2', {
        portal: 'Client', jobId: 'QBS-001', clientUids: ['c1'],
      })))
      await assertFails(addDoc(collection(builderQbs(), 'submits'), newSubmit('b2', { portal: 'Builder', tenantId: 'qbs', clientUids: [] })))
      await assertFails(addDoc(collection(t.asStaff('s1'), 'submits'), newSubmit('someone', { portal: 'P2' })))
    })

    it('a client whose job ids are only in their users document creates a submission for that job', async () => {
      await assertSucceeds(addDoc(collection(t.asUserWithDoc('c9'), 'submits'), newSubmit('c9', {
        portal: 'Client', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c9'],
      })))
    })

    it('a builder creates a submission stamped with their own tenant, with or without a job', async () => {
      await assertSucceeds(addDoc(collection(builderQbs(), 'submits'), newSubmit('b1', {
        portal: 'Builder', jobId: 'QBS-001', tenantId: 'qbs', clientUids: [],
      })))
      await assertSucceeds(addDoc(collection(builderQbs(), 'submits'), newSubmit('b1', {
        portal: 'Builder', jobId: null, tenantId: 'qbs', clientUids: [],
      })))
    })

    it('a builder cannot create a submission for another tenant, or one that a client can read', async () => {
      await assertFails(addDoc(collection(builderQbs(), 'submits'), newSubmit('b1', {
        portal: 'Builder', jobId: 'VIS-001', tenantId: 'vision', clientUids: [],
      })))
      await assertFails(addDoc(collection(builderQbs(), 'submits'), newSubmit('b1', {
        portal: 'Builder', jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c2'],
      })))
    })

    it('a builder with no tenant cannot create a submission', async () => {
      await assertFails(addDoc(collection(t.asBuilder('b3', null), 'submits'), newSubmit('b3', {
        portal: 'Builder', jobId: null, tenantId: null, clientUids: [],
      })))
    })

    it('staff create a submission as themselves', async () => {
      await assertSucceeds(addDoc(collection(t.asStaff('s1'), 'submits'), newSubmit('s1', { portal: 'P2' })))
    })

    it('builders and clients list only their own submissions', async () => {
      const mine = await assertSucceeds(list(clientOne(), 'submits', listing('c1')))
      if (mine.size !== 1) throw new Error(`expected one submission, got ${mine.size}`)
      await assertSucceeds(list(builderQbs(), 'submits', ofTenant('qbs')))
      await assertFails(list(clientOne(), 'submits'))
      await assertFails(list(builderQbs(), 'submits'))
      await assertFails(getDoc(doc(clientOne(), 'submits/s2')))
      await assertFails(getDoc(doc(builderQbs(), 'submits/s2')))
    })

    it('a builder moves a submission of their tenant to Resolved', async () => {
      await assertSucceeds(updateDoc(doc(builderQbs(), 'submits/s1'), { status: 'Resolved' }))
    })

    it('a client moves their own submission to In Progress when they reply', async () => {
      await assertSucceeds(updateDoc(doc(clientOne(), 'submits/s1'), { status: 'In Progress' }))
    })

    it('a builder cannot change the subject (the title) of a submission', async () => {
      await assertFails(updateDoc(doc(builderQbs(), 'submits/s1'), { subject: 'Changed' }))
      await assertFails(updateDoc(doc(builderQbs(), 'submits/s1'), { status: 'Resolved', subject: 'Changed' }))
    })

    it('a status the portals do not use is refused', async () => {
      await assertFails(updateDoc(doc(builderQbs(), 'submits/s1'), { status: 'Closed' }))
    })

    it('nobody changes the status of a submission they cannot read', async () => {
      await assertFails(updateDoc(doc(builderQbs(), 'submits/s2'), { status: 'Resolved' }))
      await assertFails(updateDoc(doc(clientOne(), 'submits/s2'), { status: 'Resolved' }))
    })

    it('only staff delete a submission or edit the rest of it', async () => {
      await assertFails(deleteDoc(doc(clientOne(), 'submits/s1')))
      await assertFails(deleteDoc(doc(builderQbs(), 'submits/s1')))
      await assertSucceeds(updateDoc(doc(t.asStaff('s1'), 'submits/s1'), { priority: 'High' }))
      await assertSucceeds(deleteDoc(doc(t.asStaff('s1'), 'submits/s1')))
    })
  })

  describe('replies', () => {
    it('a client replies to a submission they can read', async () => {
      await assertSucceeds(addDoc(collection(clientOne(), 'submits/s1/replies'), newReply('c1')))
    })

    it('a client cannot reply to another client\'s submission', async () => {
      await assertFails(addDoc(collection(clientOne(), 'submits/s2/replies'), newReply('c1')))
    })

    it('a reply is written as the person signed in', async () => {
      await assertFails(addDoc(collection(clientOne(), 'submits/s1/replies'), newReply('c2')))
    })

    it('a builder replies to a submission of their tenant', async () => {
      await assertSucceeds(addDoc(collection(builderQbs(), 'submits/s1/replies'), newReply('b1', { authorRole: 'builder' })))
      await assertFails(addDoc(collection(builderQbs(), 'submits/s2/replies'), newReply('b1', { authorRole: 'builder' })))
    })

    it('replies are read by whoever can read the submission', async () => {
      const thread = (db, id) => getDocs(query(collection(db, `submits/${id}/replies`), orderBy('createdAt', 'asc')))
      await assertSucceeds(thread(clientOne(), 's1'))
      await assertSucceeds(thread(builderQbs(), 's1'))
      await assertFails(thread(clientOne(), 's2'))
      await assertFails(thread(builderQbs(), 's2'))
      await assertFails(getDoc(doc(clientTwo(), 'submits/s1/replies/r1')))
    })

    it('only staff edit or delete a reply', async () => {
      await assertFails(updateDoc(doc(clientOne(), 'submits/s1/replies/r1'), { body: 'Changed' }))
      await assertFails(deleteDoc(doc(clientOne(), 'submits/s1/replies/r1')))
      await assertSucceeds(updateDoc(doc(t.asStaff('s1'), 'submits/s1/replies/r1'), { body: 'Code is 4412' }))
    })
  })

  describe('job files', () => {
    it('a client records an upload of their own on their job', async () => {
      await assertSucceeds(addDoc(collection(clientOne(), 'jobs/qbs1/files'), clientUpload('c1')))
    })

    it('a client cannot record an upload as someone else', async () => {
      await assertFails(addDoc(collection(clientOne(), 'jobs/qbs1/files'), clientUpload('c1', { uploadedBy: 'c2' })))
      await assertFails(addDoc(collection(clientOne(), 'jobs/qbs1/files'), clientUpload('c1', { createdBy: 'c2' })))
    })

    it('a client cannot record a file that is not a client upload', async () => {
      await assertFails(addDoc(collection(clientOne(), 'jobs/qbs1/files'), clientUpload('c1', { source: 'companycam' })))
      const { source: _source, ...unsourced } = clientUpload('c1')
      await assertFails(addDoc(collection(clientOne(), 'jobs/qbs1/files'), unsourced))
    })

    it('a client cannot record an upload on a job that does not list them', async () => {
      await assertFails(addDoc(collection(clientOne(), 'jobs/vis1/files'), clientUpload('c1')))
      await assertFails(addDoc(collection(clientOne(), 'jobs/qbs2/files'), clientUpload('c1')))
    })

    it('a client cannot edit or delete a file record', async () => {
      await assertFails(updateDoc(doc(clientOne(), 'jobs/qbs1/files/f1'), { name: 'renamed.jpg' }))
      await assertFails(deleteDoc(doc(clientOne(), 'jobs/qbs1/files/f1')))
    })

    it('a builder cannot record a file', async () => {
      await assertFails(addDoc(collection(builderQbs(), 'jobs/qbs1/files'), clientUpload('b1')))
    })

    it('the files of a job are read by whoever can read the job', async () => {
      const files = (db, id) => getDocs(query(collection(db, `jobs/${id}/files`), orderBy('createdAt', 'desc')))
      await assertSucceeds(files(clientOne(), 'qbs1'))
      await assertSucceeds(files(builderQbs(), 'qbs1'))
      await assertFails(files(clientOne(), 'vis1'))
      await assertFails(files(builderQbs(), 'vis1'))
    })

    it('staff record, edit and delete files on any job', async () => {
      const staff = t.asStaff('s1')
      await assertSucceeds(addDoc(collection(staff, 'jobs/vis1/files'), { name: 'final.pdf', uploadedBy: 's1', createdBy: 's1', createdByEmail: 's1@p2.test' }))
      await assertSucceeds(updateDoc(doc(staff, 'jobs/qbs1/files/f1'), { name: 'panel-2.jpg' }))
      await assertSucceeds(deleteDoc(doc(staff, 'jobs/vis1/files/f2')))
    })
  })

  describe('staff', () => {
    const SCOPED_DOCS = [
      'jobs/qbs1', 'jobs/vis1', 'jobs/bare', 'extras/x1', 'extras/x2',
      'notifications/n1', 'notifications/n2', 'submits/s1', 'submits/s2',
      'submits/s1/replies/r1', 'submits/s2/replies/r2', 'jobs/qbs1/files/f1', 'jobs/vis1/files/f2',
    ]

    it('owners and internal staff read every scoped document and list every collection unscoped', async () => {
      for (const db of [t.asStaff('s1'), t.asOwner('o1')]) {
        for (const path of SCOPED_DOCS) await assertSucceeds(getDoc(doc(db, path)))
        for (const name of ['jobs', 'extras', 'notifications', 'submits']) await assertSucceeds(list(db, name))
      }
    })

    it('staff whose role is only in their users document read the same', async () => {
      const db = t.asUserWithDoc('s9')
      for (const path of SCOPED_DOCS) await assertSucceeds(getDoc(doc(db, path)))
      for (const name of ['jobs', 'extras', 'notifications', 'submits']) await assertSucceeds(list(db, name))
    })
  })

  describe('staff only collections', () => {
    const STAFF_ONLY = ['materials', 'subs', 'permits', 'daily_reports', 'urgent_items', 'history', 'supplier_invoices']

    for (const name of STAFF_ONLY) {
      it(`builders and clients can neither read nor write ${name}`, async () => {
        await t.seed((db) => setDoc(doc(db, `${name}/d1`), { jobId: 'QBS-001', tenantId: 'qbs', clientUids: ['c1'], createdAt: at(12) }))
        for (const db of [builderQbs(), clientOne(), t.asUserWithDoc('b9')]) {
          await assertFails(getDoc(doc(db, `${name}/d1`)))
          await assertFails(getDocs(collection(db, name)))
          await assertFails(setDoc(doc(db, `${name}/d2`), { jobId: 'QBS-001', createdBy: 'b1', createdByEmail: 'b1@p2.test' }))
          await assertFails(updateDoc(doc(db, `${name}/d1`), { jobId: 'QBS-002' }))
        }
      })

      it(`staff read and write ${name}`, async () => {
        await t.seed((db) => setDoc(doc(db, `${name}/d1`), { jobId: 'QBS-001', createdAt: at(12) }))
        for (const db of [t.asStaff('s1'), t.asUserWithDoc('s9')]) {
          await assertSucceeds(getDoc(doc(db, `${name}/d1`)))
          await assertSucceeds(getDocs(collection(db, name)))
          await assertSucceeds(addDoc(collection(db, name), { jobId: 'QBS-002', createdBy: 's1', createdByEmail: 's1@p2.test' }))
          await assertSucceeds(updateDoc(doc(db, `${name}/d1`), { jobId: 'QBS-002' }))
        }
      })
    }
  })

  describe('signed out', () => {
    it('nothing scoped can be read or written', async () => {
      const anon = t.asAnon()
      await assertFails(getDoc(doc(anon, 'jobs/qbs1')))
      await assertFails(list(anon, 'jobs', ofTenant('qbs')))
      await assertFails(list(anon, 'notifications', listing('c1')))
      await assertFails(updateDoc(doc(anon, 'notifications/n1'), { read: true }))
      await assertFails(addDoc(collection(anon, 'submits'), newSubmit('c1', { jobId: 'QBS-001', clientUids: ['c1'] })))
    })
  })
})
