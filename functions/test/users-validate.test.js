import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateNewUser, tenantForRole } from '../lib/users-validate.js'

// Messages are shown to the owner as they are, so they are pinned word for word.
const MSG = {
  email: 'Enter a valid email address.',
  role: 'Choose a role.',
  tenant: 'Choose a builder tenant.',
  noJobs: 'Enter at least one job id like QBS-001.',
  badJob: 'Job ids must look like QBS-001.',
}

const fails = (input, message) => assert.deepEqual(validateNewUser(input), { ok: false, message })

const owner = { email: 'jesse@p2em.com', displayName: 'Jesse', role: 'owner' }

describe('validateNewUser: accepted input', () => {
  it('accepts an owner and puts staff in the p2-core tenant', () => {
    assert.deepEqual(validateNewUser(owner), {
      ok: true,
      value: {
        email: 'jesse@p2em.com',
        displayName: 'Jesse',
        role: 'owner',
        tenantId: 'p2-core',
        clientJobIds: [],
      },
    })
  })

  it('accepts internal staff', () => {
    const result = validateNewUser({ ...owner, role: 'internal' })
    assert.equal(result.ok, true)
    assert.equal(result.value.role, 'internal')
    assert.equal(result.value.tenantId, 'p2-core')
  })

  it('accepts a builder in either builder tenant', () => {
    for (const tenantId of ['qbs', 'vision']) {
      const result = validateNewUser({ ...owner, role: 'builder', tenantId })
      assert.equal(result.ok, true)
      assert.equal(result.value.tenantId, tenantId)
      assert.deepEqual(result.value.clientJobIds, [])
    }
  })

  it('accepts a client with job ids and puts them in the p2-core tenant', () => {
    const result = validateNewUser({ ...owner, role: 'client', clientJobIds: ['QBS-001', 'VIS-014'] })
    assert.deepEqual(result, {
      ok: true,
      value: {
        email: 'jesse@p2em.com',
        displayName: 'Jesse',
        role: 'client',
        tenantId: 'p2-core',
        clientJobIds: ['QBS-001', 'VIS-014'],
      },
    })
  })

  it('ignores a tenant sent with any role other than builder', () => {
    for (const role of ['owner', 'internal']) {
      assert.equal(validateNewUser({ ...owner, role, tenantId: 'vision' }).value.tenantId, 'p2-core')
    }
    const client = validateNewUser({ ...owner, role: 'client', tenantId: 'qbs', clientJobIds: ['QBS-001'] })
    assert.equal(client.value.tenantId, 'p2-core')
  })

  it('ignores job ids sent with any role other than client', () => {
    const result = validateNewUser({ ...owner, role: 'builder', tenantId: 'qbs', clientJobIds: ['QBS-001'] })
    assert.deepEqual(result.value.clientJobIds, [])
  })

  it('trims the email and lower cases it, as Firebase Auth stores it', () => {
    assert.equal(validateNewUser({ ...owner, email: '  Pat.Lee@Example.COM ' }).value.email, 'pat.lee@example.com')
  })

  it('trims the name, and falls back to the email when the name is blank or missing', () => {
    assert.equal(validateNewUser({ ...owner, displayName: '  Pat Lee  ' }).value.displayName, 'Pat Lee')
    assert.equal(validateNewUser({ ...owner, displayName: '   ' }).value.displayName, 'jesse@p2em.com')
    assert.equal(validateNewUser({ email: owner.email, role: 'owner' }).value.displayName, 'jesse@p2em.com')
    assert.equal(validateNewUser({ ...owner, displayName: 42 }).value.displayName, 'jesse@p2em.com')
  })

  it('normalizes job ids by trimming, upper casing and dropping blanks and repeats', () => {
    const result = validateNewUser({
      ...owner,
      role: 'client',
      clientJobIds: [' qbs-001 ', 'QBS-001', '', '   ', 'vis-014'],
    })
    assert.deepEqual(result.value.clientJobIds, ['QBS-001', 'VIS-014'])
  })

  it('does not modify the input', () => {
    const ids = [' qbs-001 ']
    const input = Object.freeze({ ...owner, role: 'client', clientJobIds: Object.freeze(ids) })
    validateNewUser(input)
    assert.deepEqual(ids, [' qbs-001 '])
  })
})

describe('validateNewUser: email', () => {
  it('rejects a missing, blank or non string email', () => {
    for (const email of [undefined, null, '', '   ', 42, {}, ['a@b.co']]) {
      fails({ ...owner, email }, MSG.email)
    }
  })

  it('rejects an email that does not match name@host.tld', () => {
    for (const email of ['plain', 'no-at.example.com', 'a@b', 'a@b.', '@b.co', 'a@.co', 'a b@c.co', 'a@b c.co', 'a@@b.co']) {
      fails({ ...owner, email }, MSG.email)
    }
  })

  it('reports an invalid email before anything else', () => {
    fails({ email: 'nope', role: 'wizard' }, MSG.email)
  })

  it('treats input that is not an object as having no email', () => {
    for (const input of [undefined, null, 'jesse@p2em.com', 42, true]) {
      fails(input, MSG.email)
    }
  })
})

describe('validateNewUser: role', () => {
  it('rejects a missing role or one that is not one of the four', () => {
    for (const role of [undefined, null, '', 'admin', 'Owner', 'OWNER', 'staff', 42, ['owner']]) {
      fails({ ...owner, role }, MSG.role)
    }
  })

  it('reports a bad role before a bad tenant or bad job ids', () => {
    fails({ ...owner, role: 'wizard', tenantId: 'nope', clientJobIds: ['bad'] }, MSG.role)
  })
})

describe('validateNewUser: builder tenant', () => {
  it('requires a tenant for a builder', () => {
    fails({ ...owner, role: 'builder' }, MSG.tenant)
    fails({ ...owner, role: 'builder', tenantId: '' }, MSG.tenant)
    fails({ ...owner, role: 'builder', tenantId: null }, MSG.tenant)
  })

  it('accepts only qbs or vision, spelled exactly', () => {
    for (const tenantId of ['p2-core', 'acme', 'QBS', 'Vision', ' qbs', 'qbs ', 42, ['qbs']]) {
      fails({ ...owner, role: 'builder', tenantId }, MSG.tenant)
    }
  })
})

describe('validateNewUser: client job ids', () => {
  it('requires at least one job id', () => {
    fails({ ...owner, role: 'client' }, MSG.noJobs)
    fails({ ...owner, role: 'client', clientJobIds: [] }, MSG.noJobs)
    fails({ ...owner, role: 'client', clientJobIds: ['', '   '] }, MSG.noJobs)
    fails({ ...owner, role: 'client', clientJobIds: null }, MSG.noJobs)
  })

  it('wants an array, not a string', () => {
    fails({ ...owner, role: 'client', clientJobIds: 'QBS-001' }, MSG.noJobs)
    fails({ ...owner, role: 'client', clientJobIds: 'QBS-001, QBS-002' }, MSG.noJobs)
    fails({ ...owner, role: 'client', clientJobIds: { 0: 'QBS-001' } }, MSG.noJobs)
  })

  it('rejects ids that do not look like QBS-001', () => {
    for (const bad of ['QBS-1', 'QBS-0001', 'QBS001', 'QBS_001', '001-QBS', '-001', 'QBS-', 'QB5-001', 'QBS 001', 'QBS-00A']) {
      fails({ ...owner, role: 'client', clientJobIds: [bad] }, MSG.badJob)
    }
  })

  it('rejects the whole list when any one id is bad', () => {
    fails({ ...owner, role: 'client', clientJobIds: ['QBS-001', 'nope', 'QBS-002'] }, MSG.badJob)
  })

  it('rejects entries that are not strings', () => {
    for (const bad of [1, null, undefined, {}, ['QBS-001']]) {
      fails({ ...owner, role: 'client', clientJobIds: ['QBS-001', bad] }, MSG.badJob)
    }
  })

  it('checks the pattern after trimming and upper casing', () => {
    assert.equal(validateNewUser({ ...owner, role: 'client', clientJobIds: ['  qbs-001'] }).ok, true)
    assert.equal(validateNewUser({ ...owner, role: 'client', clientJobIds: ['Qbs-001'] }).ok, true)
  })
})

describe('tenantForRole', () => {
  it('keeps qbs or vision for a builder', () => {
    assert.equal(tenantForRole('builder', 'qbs'), 'qbs')
    assert.equal(tenantForRole('builder', 'vision'), 'vision')
  })

  it('gives a builder with any other value no tenant, never a default one', () => {
    for (const value of [undefined, null, '', 'p2-core', 'acme', 'QBS', 'Vision', ' qbs', 42, ['qbs'], {}]) {
      assert.equal(tenantForRole('builder', value), null)
    }
  })

  it('puts every other role in p2-core, whatever tenant was given', () => {
    for (const role of ['owner', 'internal', 'client', null, undefined, 'admin']) {
      for (const value of ['qbs', 'vision', 'acme', '', null, undefined, 42]) {
        assert.equal(tenantForRole(role, value), 'p2-core')
      }
    }
  })
})

describe('validateNewUser: result shape', () => {
  it('returns only ok and value on success, and only ok and message on failure', () => {
    assert.deepEqual(Object.keys(validateNewUser(owner)).sort(), ['ok', 'value'])
    assert.deepEqual(Object.keys(validateNewUser({})).sort(), ['message', 'ok'])
  })

  it('has no em or en dashes in any message', () => {
    for (const message of Object.values(MSG)) assert.doesNotMatch(message, /[\u2013\u2014]/)
  })
})
