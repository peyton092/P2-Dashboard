import { runCallable } from '../callables'

// firebase/functions for the demo build. A callable is answered on this device by
// ../callables.js, as the signed in demo account, against the demo store: it resolves
// { data } with what the function returns, or rejects with the code and the sentence
// the function would. Nothing is sent anywhere, and the options a call is given, such
// as a timeout, change nothing.

export function getFunctions(app, region = 'us-central1') {
  return { app, region }
}

export function httpsCallable(functions, name) {
  return async (data) => {
    const { app } = functions
    const user = app.demoSession().user()
    const result = await runCallable(name, data, { store: app.demoStore(), user })
    return { data: result }
  }
}
