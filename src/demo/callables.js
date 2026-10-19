import { refuse } from './functions/shared'
import { extrasCallables } from './functions/extras'
import { inspectionCallables } from './functions/inspections'
import { jobCallables } from './functions/jobs'
import { userCallables } from './functions/users'

// The Cloud Functions the app calls, answered on this device from the demo store.
// Each is a port of the function in functions/ of the same name, and applies the same
// transition, writes the same notification and history line, and refuses what the
// function refuses, with the same code and the same sentence, because the screens show
// that sentence (callableMessage). The pure rules are copied from functions/lib so the
// demo bundle carries no server code; the tests compare the copies with the originals
// (callables.test.js for jobs.js, inspections.js and users-validate.js, and
// changeOrderParity.test.js for scope.js, doc-id.js, extras.js and activity.js).
//
//   sendExtraToBuilder, approveExtra, rejectExtra   functions/extras.js and lib/extras.js
//   passInspection, failInspection                  functions/inspections.js and lib/inspections.js
//   createJob                                       functions/jobs.js and lib/jobs.js
//   createUser                                      functions/users.js and lib/users-validate.js
//
// The copies are in src/demo/functions, one file for each of those four (extras.js,
// inspections.js, jobs.js, users.js), and shared.js for what they share from
// functions/lib. This file answers the calls.
//
// Two things differ, by design. The day an inspection is dated is the local day of
// the device (toLocalDateStr), not the server's business day. And createUser writes the
// users document only: there is no Auth account to make, and the demo signs in only as
// its own four accounts. Every other name, the QuickBooks and CompanyCam functions and
// the backfill among them, is refused with DEMO_MESSAGE.

export const DEMO_MESSAGE = 'This is a demo. Connections to other systems are turned off.'

export { DemoFunctionsError, canActOnExtra, cleanDocId, historyDoc, notificationDoc, scopeForJob, tenantForRole } from './functions/shared'
export {
  EXTRA_GONE, JOB_GONE, NOTE_MAX, NOTE_REQUIRED, NOT_YOURS, TOTAL_CHANGED,
  cleanRevisionNote, extraActivity, extraTransition, totalChanged,
} from './functions/extras'
export { TRADE_PHASES, inspectionActivity, inspectionPatch, validateInspection } from './functions/inspections'
export { jobActivity, validateNewJob } from './functions/jobs'
export { validateNewUser } from './functions/users'

const CALLABLES = { ...extrasCallables, ...inspectionCallables, ...jobCallables, ...userCallables }

// Answers a call to the function called name with data, as the account user ({ uid,
// email, displayName, claims }) on store. Resolves with what the function returns.
export async function runCallable(name, data, { store, user }) {
  if (!Object.hasOwn(CALLABLES, name)) throw refuse('failed-precondition', DEMO_MESSAGE)
  return CALLABLES[name]({ data, store, user })
}
