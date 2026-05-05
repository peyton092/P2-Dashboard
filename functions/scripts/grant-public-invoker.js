// Grant `allUsers` Cloud Run invoker on the three QB Cloud Functions.
// Run AFTER you've loosened the iam.allowedPolicyMemberDomains org policy
// at the project level. Otherwise this returns 400 FAILED_PRECONDITION.
//
// Usage (from project root):
//   node functions/scripts/grant-public-invoker.js
//
// Auth: uses the Firebase CLI's cached access token (~/.config/configstore/firebase-tools.json).
// Run `npx firebase login` if it complains about a missing/expired token.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT  = 'p2-dashboard'
const REGION   = 'us-central1'
const SERVICES = ['qbauth', 'qbcallback', 'qbdisconnect']

function readFirebaseToken() {
  const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`No Firebase CLI config at ${cfgPath}. Run \`npx firebase login\` first.`)
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const tok = cfg?.tokens?.access_token
  if (!tok) throw new Error('No access_token in Firebase CLI config. Run `npx firebase login --reauth`.')
  return tok
}

async function setInvoker(svc, token) {
  const url = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${svc}:setIamPolicy`
  const body = {
    policy: {
      bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }],
    },
  }
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const txt = await r.text()
  if (r.ok) {
    console.log(`✓ ${svc} — allUsers invoker granted`)
  } else {
    console.log(`✗ ${svc} — ${r.status}`)
    console.log('  ' + txt.replace(/\n/g, '\n  ').slice(0, 600))
  }
}

;(async () => {
  const token = readFirebaseToken()
  for (const s of SERVICES) await setInvoker(s, token)
})().catch(e => {
  console.error(e.message)
  process.exit(1)
})
