// The four accounts of the demo, one for each role. Their names and addresses are
// invented, and the addresses are at example.com, which belongs to nobody. The claims
// are the ones the createUser function and the claims sync give an account of that
// role ({ role, tenantId, clientJobIds }), so App.jsx resolves them to the session it
// would for a real account and never needs the users document. The seed writes a users
// document for each of them as well, as the functions would.
//
// The builder works for the qbs tenant, so the builder portal shows exactly the QBS
// jobs. The client's jobs are the ones listed here: the seed puts this client's uid in
// the clientUids of those jobs and of what hangs off them.

const account = (uid, email, displayName, claims) => Object.freeze({
  uid,
  email,
  displayName,
  claims: Object.freeze({ ...claims, clientJobIds: Object.freeze([...claims.clientJobIds]) }),
})

export const DEMO_USERS = Object.freeze({
  owner: account('demo-owner', 'owner@example.com', 'Dana Whitlock', { role: 'owner', tenantId: 'p2-core', clientJobIds: [] }),
  internal: account('demo-office', 'office@example.com', 'Riley Ashford', { role: 'internal', tenantId: 'p2-core', clientJobIds: [] }),
  builder: account('demo-builder', 'builder@example.com', 'Casey Morrow', { role: 'builder', tenantId: 'qbs', clientJobIds: [] }),
  client: account('demo-client', 'client@example.com', 'Larkspur Homes', { role: 'client', tenantId: 'p2-core', clientJobIds: ['QBS-003', 'QBS-024', 'QBS-033'] }),
})
