import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDownIcon, ChevronUpIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useConfirm } from '@/hooks/useConfirm'
import { useMutation } from '@/hooks/useMutation'
import { cn } from '@/lib/utils'
import { currentDemoRole, onDemoRoleChange, switchDemoRole } from './demoSession'
import { DEMO_SAVE_FAILED_EVENT } from './device'
import { resetDemoState } from './firebase'
import './demo.css'

// The bar above the demo build: what this is, whom it is viewed as, and a way back to
// the sample data it opened with. It is in the page above the app, not over it, so it
// covers no sidebar, bottom bar, page header or dialog, and demo.css takes its height
// off the shell, which fills the rest of the screen.
//
// It is one row of 44 pixel controls, so on a phone it takes as little of the screen as
// it can. There the row starts with a short label, Demo with sample data, which opens
// the whole sentence in a row below it; closed, that sentence is still there for a
// screen reader, only not on the screen. From 640 pixels the row shows the whole
// sentence instead of the label.
//
// The role buttons are a set of toggles, each pressed when it is the account the demo
// shows. Reset sample data is an icon on a phone, named for what it does, and has its
// words beside the icon from 640 pixels. Brand orange is left to the focus ring: the
// pressed role is shown in the neutral surface tones.

const ROLES = [
  { role: 'owner', label: 'Owner' },
  { role: 'builder', label: 'Builder' },
  { role: 'client', label: 'Client' },
]

const SHORT = 'Demo with sample data'
const SENTENCE = "Demo preview with sample data. Nothing here is saved to P2's systems."
const SIGNED_OUT = 'There is no signing out of the demo, so it shows the owner again.'
const OUT_OF_ROOM = 'This device is out of room. Changes will not be kept after you close the demo. Use Reset to start clean.'

const subscribe = (onChange) => onDemoRoleChange(() => onChange())

export default function DemoBanner() {
  const role = useSyncExternalStore(subscribe, currentDemoRole, () => 'owner')
  const { ask, dialog } = useConfirm()
  const { run } = useMutation()
  const toast = useToast()
  const bar = useRef(null)
  const aboutId = useId()
  const [aboutOpen, setAboutOpen] = useState(false)

  // Tells the page the banner is there and how tall it is, which wraps differently at
  // each width, so that demo.css can take that height off the shell. The observer
  // measures it again whenever its size changes, a turned phone included.
  //
  // Tailwind reads every word of the source, this file's too, for class names, and the
  // production build is built from the same CSS. So this file names no event or value
  // that is also a utility class, which would add a rule to the production stylesheet.
  useLayoutEffect(() => {
    const element = bar.current
    const root = document.documentElement
    const measure = () => root.style.setProperty('--demo-banner-height', `${element.getBoundingClientRect().height}px`)
    root.setAttribute('data-demo-banner', '')
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.removeAttribute('data-demo-banner')
      root.style.removeProperty('--demo-banner-height')
    }
  }, [])

  // Signing out in the demo signs the owner back in, which would look like nothing
  // happened, so it is said.
  useEffect(() => onDemoRoleChange(({ reason }) => {
    if (reason === 'sign-out') toast({ tone: 'info', title: SIGNED_OUT })
  }), [toast])

  // When what the demo saves no longer fits on the device, it is said once, and the
  // toast stays until it is dismissed, since nothing else will say it again.
  const warnedOutOfRoom = useRef(false)
  useEffect(() => {
    const onSaveFailed = () => {
      if (warnedOutOfRoom.current) return
      warnedOutOfRoom.current = true
      toast({ tone: 'error', title: OUT_OF_ROOM, duration: 0 })
    }
    window.addEventListener(DEMO_SAVE_FAILED_EVENT, onSaveFailed)
    return () => window.removeEventListener(DEMO_SAVE_FAILED_EVENT, onSaveFailed)
  }, [toast])

  const askToReset = () => ask({
    title: 'Reset the sample data?',
    body: 'Everything changed in this demo on this device goes back to how it was when it opened.',
    confirmLabel: 'Reset',
    tone: 'critical',
    onConfirm: () => run(() => resetDemoState(), {
      success: 'The sample data is back to how it started.',
      error: 'Could not reset the sample data. Try again.',
    }),
  })

  return (
    <div
      ref={bar}
      role="region"
      aria-label="Demo controls"
      className="px-4 sm:px-6 lg:px-8 border-b border-white/10 bg-white/[0.04] text-foreground"
    >
      <div className="flex items-center gap-1.5 py-1 sm:gap-4">
        <button
          type="button"
          aria-expanded={aboutOpen}
          aria-controls={aboutId}
          onClick={() => setAboutOpen((open) => !open)}
          className="sm:hidden flex flex-1 min-w-0 min-h-11 items-center gap-1 rounded-md text-left text-xs leading-tight text-zinc-200 hover:text-white"
        >
          <span className="min-w-0">{SHORT}</span>
          {aboutOpen
            ? <ChevronUpIcon className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
            : <ChevronDownIcon className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />}
        </button>
        <p className="hidden sm:flex items-center min-w-0 text-sm leading-snug text-zinc-200">{SENTENCE}</p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div role="group" aria-label="View the demo as" className="inline-flex rounded-lg border border-white/15">
            {ROLES.map(({ role: value, label }) => {
              const pressed = role === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => switchDemoRole(value)}
                  className={cn(
                    'min-h-11 px-2 rounded-lg text-[13px] font-medium transition-colors',
                    pressed ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <Button variant="outline" aria-label="Reset sample data" onClick={askToReset} className="min-h-11 min-w-11 gap-1.5 px-2.5 text-zinc-200">
            <RotateCcwIcon aria-hidden="true" />
            <span className="hidden sm:inline">Reset sample data</span>
          </Button>
        </div>
      </div>
      <p id={aboutId} className={aboutOpen ? 'sm:hidden pb-2 text-sm leading-snug text-zinc-200' : 'sm:hidden sr-only'}>{SENTENCE}</p>
      {dialog}
    </div>
  )
}
