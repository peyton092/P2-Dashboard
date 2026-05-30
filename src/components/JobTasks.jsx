import { useState } from 'react'
import { useJobTasks, addJobTask, toggleJobTask, deleteJobTask } from '../hooks/useFirestore'
import { DataPanel, EmptyState } from './shared'
import { useToast } from '@/components/ui/toast'
import { CheckSquareIcon, PlusIcon, Trash2Icon, SquareIcon } from 'lucide-react'

const O = '#F47920'

// Per-job punch list. Subscribes to job_tasks where jobId === this.jobId.
// Pending items render first (checkable), completed roll up below collapsed.
export default function JobTasks({ jobId }) {
  const { tasks } = useJobTasks(jobId)
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const pending = tasks.filter(t => !t.done)
  const done    = tasks.filter(t => t.done)

  async function submit(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await addJobTask(jobId, text)
      setDraft('')
    } catch (err) {
      toast({ tone: 'error', title: 'Could not add task', description: err.message || 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(task) {
    const snapshot = { text: task.text, done: !!task.done }
    try {
      await deleteJobTask(task._docId)
      toast({
        tone: 'info',
        title: 'Task deleted',
        description: snapshot.text.slice(0, 60),
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const ref = await addJobTask(jobId, snapshot.text)
            if (snapshot.done) await toggleJobTask(ref.id, true)
          },
        },
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Delete failed', description: err.message || 'Unknown error' })
    }
  }

  return (
    <DataPanel
      title="Tasks"
      description={tasks.length === 0
        ? 'No tasks yet — add what needs doing on this job.'
        : `${pending.length} open · ${done.length} done`}
      Icon={CheckSquareIcon}
      padding="none"
    >
      <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a task and press Enter…"
          className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none focus:border-white/25"
          aria-label="New task"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: O }}
        >
          <PlusIcon size={13} /> Add
        </button>
      </form>

      {tasks.length === 0 ? (
        <div className="p-5">
          <EmptyState
            Icon={CheckSquareIcon}
            title="No tasks"
            description="Track action items, follow-ups, or punch-list items here."
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-white/5">
            {pending.map(t => <TaskRow key={t._docId} task={t} onDelete={handleDelete} />)}
          </ul>

          {done.length > 0 && (
            <div className="border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowDone(v => !v)}
                className="w-full text-left px-4 py-2 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {showDone ? 'Hide' : 'Show'} {done.length} completed
              </button>
              {showDone && (
                <ul className="divide-y divide-white/5">
                  {done.map(t => <TaskRow key={t._docId} task={t} onDelete={handleDelete} />)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </DataPanel>
  )
}

function TaskRow({ task, onDelete }) {
  const done = !!task.done
  return (
    <li className="flex items-center gap-2.5 px-4 py-2.5">
      <button
        type="button"
        onClick={() => toggleJobTask(task._docId, !done)}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className="shrink-0 p-1 rounded hover:bg-white/5 transition-colors"
        style={{ color: done ? '#22c55e' : '#9ca3af' }}
      >
        {done ? <CheckSquareIcon size={16} /> : <SquareIcon size={16} />}
      </button>
      <p className={`flex-1 text-sm min-w-0 truncate ${done ? 'line-through text-zinc-400' : 'text-zinc-100'}`}>
        {task.text}
      </p>
      <button
        type="button"
        onClick={() => onDelete(task)}
        aria-label="Delete task"
        title="Delete task"
        className="shrink-0 p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-white/5 transition-colors"
      >
        <Trash2Icon size={14} />
      </button>
    </li>
  )
}
