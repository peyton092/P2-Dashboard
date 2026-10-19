import { useConnectionState } from '@/hooks/useConnectionState'
import { toneHex } from '@/lib/status'
import { Pill } from './badges'

// The words for each state of the connection and the tone each is read in: live is
// good news, syncing is a wait, offline is a fault.
const STATES = {
  online: { word: 'Live', tone: 'success' },
  syncing: { word: 'Syncing', tone: 'warning' },
  offline: { word: 'Offline', tone: 'critical' },
}

// The connection, as a dot and a word. The word is always there, so the state never
// rides on color alone, and the dot is a picture that a screen reader skips. The
// region is polite: a change is read out when the reader is next free, and is not
// read out on first show.
export function ConnectionChip() {
  const { word, tone } = STATES[useConnectionState()]
  return (
    <span role="status" aria-live="polite" className="inline-flex">
      <Pill tone={tone}>
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: toneHex(tone) }} />
        {word}
      </Pill>
    </span>
  )
}
