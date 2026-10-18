// Firebase secrets, defined once so the QuickBooks module and both CompanyCam
// modules bind the same instances. Set them with
// `firebase functions:secrets:set <NAME>`.

import { defineSecret } from 'firebase-functions/params'

export const QB_CLIENT_ID     = defineSecret('QB_CLIENT_ID')
export const QB_CLIENT_SECRET = defineSecret('QB_CLIENT_SECRET')
export const CC_CLIENT_ID     = defineSecret('CC_CLIENT_ID')
export const CC_CLIENT_SECRET = defineSecret('CC_CLIENT_SECRET')
