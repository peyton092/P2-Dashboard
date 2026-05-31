import { useMemo } from 'react'
import { useSavedViews, saveView, deleteView } from '../../lib/savedViews'
import { useDialog } from '../ui/dialog'

// Drop-in saved-view picker for a filter/sort/search combo. Pages just hand
// it their current payload + an apply callback — the component handles the
// list, the "save current as…" sentinel, and the inline delete button.
//
// Props:
//   scope         — string namespace (e.g. 'jobs', 'billing', 'materials')
//   currentPayload— object reflecting the current filters (used to detect
//                   whether the active selection matches a saved view)
//   onApply       — (payload) => void, called when the user picks a saved view
//   savePrompt    — optional window.prompt copy
//   selectAriaLabel — optional aria-label for the select
export function SavedViewSelect({
  scope,
  currentPayload,
  onApply,
  savePrompt = 'Name this view',
  selectAriaLabel = 'Saved view',
}) {
  const savedViews = useSavedViews(scope)
  const { confirm, prompt } = useDialog()
  const viewNames  = useMemo(() => Object.keys(savedViews).sort(), [savedViews])
  const currentSig = JSON.stringify(currentPayload || {})
  const activeName = viewNames.find(n => JSON.stringify(savedViews[n]?.payload || {}) === currentSig) || ''

  const handleSave = async () => {
    const name = await prompt({ title: 'Save view', description: savePrompt, placeholder: 'View name', confirmLabel: 'Save' })
    if (!name?.trim()) return
    saveView(scope, name.trim(), currentPayload)
  }
  const handleDelete = async () => {
    if (!activeName) return
    const ok = await confirm({
      title: `Delete "${activeName}"?`,
      description: 'This removes the saved view. Your current filters stay as they are.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    })
    if (ok) deleteView(scope, activeName)
  }
  const handleChange = (e) => {
    const v = e.target.value
    if (v === '__save__') handleSave()
    else if (v) {
      const payload = savedViews[v]?.payload
      if (payload) onApply(payload)
    }
  }

  return (
    <>
      <select
        value={activeName}
        onChange={handleChange}
        className="bg-white/[0.04] border border-white/10 rounded-lg text-xs px-2.5 py-2 text-zinc-200 focus:outline-none focus:border-white/30 max-w-[180px]"
        aria-label={selectAriaLabel}
      >
        <option value="">Saved view…</option>
        {viewNames.map(n => <option key={n} value={n}>{n}</option>)}
        <option value="__save__">＋ Save current as…</option>
      </select>
      {activeName && (
        <button
          type="button"
          onClick={handleDelete}
          className="text-[11px] font-semibold px-2.5 py-2 rounded-lg border border-white/10 text-zinc-400 hover:text-red-300 hover:border-red-400/40"
          title={`Delete saved view "${activeName}"`}
        >
          Delete view
        </button>
      )}
    </>
  )
}
