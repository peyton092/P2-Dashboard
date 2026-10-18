// Non secret configuration shared by more than one function module. Values used
// by a single module stay in that module.

import { CC_CLIENT_ID, CC_CLIENT_SECRET } from './secrets.js'

// Every function deploys to this region.
export const region = 'us-central1'

// OAuth `state` tokens are valid for 10 minutes (QuickBooks and CompanyCam).
export const STATE_TTL_MS = 10 * 60 * 1000

// The CompanyCam token endpoint is used by the OAuth code exchange
// (oauth-companycam.js) and by the access token refresh (companycam-sync.js).
export const CC_TOKEN_URL = 'https://app.companycam.com/oauth/token'

// Options for the callables that need the CompanyCam secrets, shared by
// oauth-companycam.js and companycam-sync.js.
export const ccCallableOpts = {
  region,
  cors: true,
  secrets: [CC_CLIENT_ID, CC_CLIENT_SECRET],
}
