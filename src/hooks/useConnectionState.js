import { useCallback, useSyncExternalStore } from 'react'
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
//            browser says it is online but no server answers. It is also how it reads
//            with nobody signed in, because there is nothing to ask the server about.
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
//                                    reports it after each snapshot it reports, the
//                                    answer to a refusal included.
//
// With no uid there is nobody to ask about, so the probe registers nothing, reports
// nothing, and the state stays syncing.
export function probeConnection(database, uid, onChange) {
  if (!uid) return () => {}
  const stops = [
    onSnapshot(
      doc(database, 'users', uid),
      { includeMetadataChanges: true },
      (snapshot) => onChange({ type: 'snapshot', fromCache: snapshot.metadata.fromCache }),
      // A refusal came from the server, so the server answered. The SDK drops the listener
      // and raises no in sync event after it, so the probe reports that one itself.
      () => {
        onChange({ type: 'snapshot', fromCache: false })
        onChange({ type: 'sync' })
      },
    ),
    onSnapshotsInSync(database, () => onChange({ type: 'sync' })),
  ]
  return () => stops.forEach((stop) => stop())
}

// What the probe has said for one user. caughtUp is true from a sync until the next
// change, and confirmed is true while the last snapshot came from the server.
const fresh = () => ({ caughtUp: false, confirmed: false })

const isSettled = (facts) => facts.caughtUp && facts.confirmed

function reduce(facts, event) {
  if (event.type === 'sync') return { ...facts, caughtUp: true }
  // The server sending a snapshot to a probe that is already settled changes nothing the
  // person needs to see. The SDK follows a snapshot with the in sync event in a task of
  // its own, so resetting here would commit Syncing in between and the status region
  // would read it out. A snapshot from the cache is a change the server has not
  // confirmed, and it reads Syncing at once.
  if (!event.fromCache && isSettled(facts)) return facts
  return { caughtUp: false, confirmed: !event.fromCache }
}

// One probe for each user, shared by every component that asks for the state. Each
// page header has a chip and each screen is a new component, so a probe of a chip's
// own would start from nothing on every navigation: the cached copy of the document
// comes first and the server's answer a moment later, and the chip would flash
// Syncing each time the person changed screens. Shared, a chip that mounts reads what
// the others already know.
//
// The first component to ask starts the probe and the last to leave stops it. A
// screen that replaces another unmounts and mounts in the same commit, so the probe
// is stopped only if nobody has asked for it again by the end of that task.
const probes = new Map()

function retain(uid, onChange) {
  let held = probes.get(uid)
  if (!held) {
    const started = { facts: fresh(), watchers: new Set(), holds: 0, stop: () => {} }
    started.stop = probeConnection(db, uid, (event) => {
      started.facts = reduce(started.facts, event)
      started.watchers.forEach((watcher) => watcher())
    })
    probes.set(uid, started)
    held = started
  }
  held.holds += 1
  held.watchers.add(onChange)
  return () => {
    held.watchers.delete(onChange)
    held.holds -= 1
    queueMicrotask(() => {
      if (held.holds === 0 && probes.get(uid) === held) {
        probes.delete(uid)
        held.stop()
      }
    })
  }
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
// is signed in; ConnectionChip is that component. The dashboard calls it once itself
// and ignores the answer, to keep the probe running on the screens that show no chip.
export function useConnectionState() {
  const uid = useData()?.uid ?? null
  const online = useSyncExternalStore(subscribeToBrowser, browserIsOnline, () => true)
  const subscribe = useCallback((onChange) => retain(uid, onChange), [uid])
  const getSnapshot = useCallback(() => isSettled(probes.get(uid)?.facts ?? fresh()), [uid])
  const settled = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (!online) return 'offline'
  return settled ? 'online' : 'syncing'
}
