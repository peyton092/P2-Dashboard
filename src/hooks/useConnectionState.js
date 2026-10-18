import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { doc, onSnapshot, onSnapshotsInSync } from 'firebase/firestore'
import { db } from '../firebase'
import { useData } from '../use-data'

// What the app can honestly say about its connection, in three words:
//
//   offline  The browser says it has no network.
//   syncing  The browser has a network, but Firestore has not confirmed that it is
//            caught up: its listeners have not settled since the last change, or the
//            signed in user's own document has not been confirmed by the server and
//            is still the copy in the cache. That is how it reads at start up, after
//            the network comes back, while a write waits to be sent, and when the
//            browser says it is online but no server answers.
//   online   Everything else.
//
// The first word comes from the browser. The other two come from a probe, which is
// the only thing here that knows about Firestore: probeConnection below. It listens
// to the signed in user's own document, users/{uid}, with metadata changes, because
// every signed in account may read that one (a builder or a client may not read the
// settings), and a document that does not exist still gets snapshots with metadata.
// It also listens for the snapshots in sync event, which the SDK raises after the
// listeners have seen each change.

// The probe. It reports to onChange, and returns the function that stops it. The demo
// build will swap this function for a probe of its local store, and nothing else in
// the app talks to Firestore about the connection, so what it reports is a contract:
//
//   { type: 'snapshot', fromCache }  The user's document changed. fromCache is false
//                                    once the server has answered for it. A probe
//                                    with no server reports false.
//   { type: 'sync' }                 Every listener has seen the change so far. A probe
//                                    reports it at least once, after its snapshot.
//
// With no uid there is no document to probe, and only the second is reported.
export function probeConnection(database, uid, onChange) {
  const stops = []
  if (uid) {
    stops.push(onSnapshot(
      doc(database, 'users', uid),
      { includeMetadataChanges: true },
      (snapshot) => onChange({ type: 'snapshot', fromCache: snapshot.metadata.fromCache }),
      // A refusal came from the server, so the server answered.
      () => onChange({ type: 'snapshot', fromCache: false }),
    ))
  }
  stops.push(onSnapshotsInSync(database, () => onChange({ type: 'sync' })))
  return () => stops.forEach((stop) => stop())
}

// What the probe has said for one user. caughtUp is true from a sync until the next
// snapshot, which is a change, and confirmed is true while the last snapshot came
// from the server. With no uid there is nothing to confirm.
const fresh = (uid) => ({ uid, caughtUp: false, confirmed: uid == null })

// Each event carries the uid it was heard for. The first event for a new user starts
// that user's state from scratch, so nothing heard for the user before carries over.
function reduce(state, event) {
  const current = state.uid === event.uid ? state : fresh(event.uid)
  if (event.type === 'sync') return { ...current, caughtUp: true }
  return { ...current, caughtUp: false, confirmed: !event.fromCache }
}

function subscribeToBrowser(onChange) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}
const browserIsOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

// 'online', 'syncing' or 'offline'. Call it in a component that is shown while a user
// is signed in; ConnectionChip is that component.
export function useConnectionState() {
  const uid = useData()?.uid ?? null
  const online = useSyncExternalStore(subscribeToBrowser, browserIsOnline, () => true)
  const [heard, dispatch] = useReducer(reduce, uid, fresh)

  useEffect(
    () => probeConnection(db, uid, (event) => dispatch({ ...event, uid })),
    [uid],
  )

  if (!online) return 'offline'
  // What was heard for another user counts for nothing.
  const probe = heard.uid === uid ? heard : fresh(uid)
  return probe.caughtUp && probe.confirmed ? 'online' : 'syncing'
}
