import { useState } from 'react'
import { useData } from '../DataContext'
import { addSubmit, updateSubmit, useSubmitReplies, addSubmitReply } from '../hooks/useFirestore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ChevronLeftIcon, ChevronRightIcon, PlusIcon, SendIcon, MessageSquareIcon,
} from 'lucide-react'

const O = '#F47920'

function SectionHeader({ title, sub, action }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export default function SubmitInbox() {
  const { submits } = useData()
  const [view, setView] = useState('inbox')
  const [selectedSubmitId, setSelectedSubmitId] = useState(null)
  const [form, setForm] = useState({ subject: '', category: 'RFI', priority: 'Medium', body: '', portal: 'P2' })
  const [submitting, setSubmitting] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)

  const selectedSubmit = submits.find(s => s._docId === selectedSubmitId) || null
  const { replies } = useSubmitReplies(selectedSubmit?._docId)

  const CATEGORIES = ['RFI', 'Issue', 'Question', 'Change Order', 'Approval', 'Other']
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
  const priorityColor = { Low: '#22c55e', Medium: '#eab308', High: O, Critical: '#ef4444' }
  const statusColor = { Open: '#ef4444', 'In Progress': O, Resolved: '#22c55e' }

  const handleNewSubmit = async () => {
    if (!form.subject || !form.body) return
    setSubmitting(true)
    await addSubmit({
      subject: form.subject,
      category: form.category,
      priority: form.priority,
      body: form.body,
      portal: form.portal,
      status: 'Open',
    })
    setForm({ subject: '', category: 'RFI', priority: 'Medium', body: '', portal: 'P2' })
    setSubmitting(false)
    setView('inbox')
  }

  const handleReply = async () => {
    if (!replyText.trim() || !selectedSubmit?._docId) return
    setReplying(true)
    await addSubmitReply(selectedSubmit._docId, {
      body: replyText,
      author: 'P2 Team',
      authorRole: 'internal',
    })
    if (selectedSubmit.status === 'Open') {
      await updateSubmit(selectedSubmit._docId, { status: 'In Progress' })
    }
    setReplyText('')
    setReplying(false)
  }

  if (view === 'thread' && selectedSubmit) {
    const sc = statusColor[selectedSubmit.status || 'Open'] || '#6b7280'
    const pc = priorityColor[selectedSubmit.priority] || '#6b7280'
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <Button
            variant="outline"
            className="border-white/20 gap-2 shrink-0"
            onClick={() => { setView('inbox'); setSelectedSubmitId(null) }}>
            <ChevronLeftIcon size={14} /> Back
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{selectedSubmit.subject}</h2>
            <p className="text-sm text-muted-foreground">
              {selectedSubmit.category} · {selectedSubmit.portal} · {selectedSubmit.createdAt?.toDate?.()?.toLocaleDateString?.() || ''}
            </p>
          </div>
          <Select
            value={selectedSubmit.status || 'Open'}
            onValueChange={v => selectedSubmit._docId && updateSubmit(selectedSubmit._docId, { status: v })}>
            <SelectTrigger
              className="h-auto py-1 px-3 text-xs font-bold border rounded-full w-auto gap-1 shrink-0"
              style={{ backgroundColor: sc + '22', color: sc, borderColor: sc + '55' }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-white/10">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: O + '33', color: O }}>
                {(selectedSubmit.portal || 'P2').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-semibold">{selectedSubmit.portal || 'P2'}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedSubmit.createdAt?.toDate?.()?.toLocaleString?.() || ''}
                  </span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full ml-auto"
                    style={{ backgroundColor: pc + '22', color: pc }}>
                    {selectedSubmit.priority}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedSubmit.body}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {replies.map(r => (
          <Card key={r._docId} className="border-white/10 ml-8">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    backgroundColor: r.authorRole === 'internal' ? '#3b82f622' : '#22c55e22',
                    color: r.authorRole === 'internal' ? '#3b82f6' : '#22c55e',
                  }}>
                  {(r.author || 'P2').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{r.author}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.createdAt?.toDate?.()?.toLocaleString?.() || ''}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{r.body}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card className="border-white/10">
          <CardContent className="p-4 space-y-3">
            <Textarea
              className="bg-white/5 border-white/20 min-h-24"
              placeholder="Write a reply…"
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
            />
            <Button
              style={{ backgroundColor: O }}
              className="text-white gap-2"
              onClick={handleReply}
              disabled={replying || !replyText.trim()}>
              <SendIcon size={14} /> {replying ? 'Sending…' : 'Send Reply'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (view === 'new') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" className="border-white/20 gap-2" onClick={() => setView('inbox')}>
            <ChevronLeftIcon size={14} /> Back
          </Button>
          <h2 className="text-xl font-bold">New Submit</h2>
        </div>
        <Card className="border-white/10 max-w-2xl" style={{ borderColor: O + '33' }}>
          <CardContent className="p-6 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Subject *</label>
              <Input
                className="bg-white/5 border-white/20"
                placeholder="Brief summary of the issue or request"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Portal</label>
                <Select value={form.portal} onValueChange={v => setForm(f => ({ ...f, portal: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="P2">P2</SelectItem>
                    <SelectItem value="Builder">Builder</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Message *</label>
              <Textarea
                className="bg-white/5 border-white/20 min-h-32"
                placeholder="Describe the issue or request in detail…"
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              />
            </div>
            <Button
              className="w-full text-white"
              style={{ backgroundColor: O }}
              onClick={handleNewSubmit}
              disabled={submitting || !form.subject || !form.body}>
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const openCount = submits.filter(s => s.status === 'Open' || !s.status).length

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Submit / Inbox"
        sub={`${openCount} open · ${submits.length} total`}
        action={
          <Button style={{ backgroundColor: O }} className="text-white gap-2" onClick={() => setView('new')}>
            <PlusIcon size={14} /> New Submit
          </Button>
        }
      />

      {submits.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <MessageSquareIcon size={48} className="mx-auto mb-4 opacity-20" />
          <p className="mb-4">No submits yet</p>
          <Button className="text-white" style={{ backgroundColor: O }} onClick={() => setView('new')}>
            Create First Submit
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {submits.map(s => {
            const pc = priorityColor[s.priority] || '#6b7280'
            const sc = statusColor[s.status || 'Open'] || '#6b7280'
            return (
              <div
                key={s._docId}
                className="flex items-start gap-4 p-4 rounded-xl border border-white/10 hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => { setSelectedSubmitId(s._docId); setView('thread') }}>
                <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: O + '22' }}>
                  <MessageSquareIcon size={14} style={{ color: O }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-sm">{s.subject}</span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: pc + '22', color: pc }}>
                      {s.priority}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>{s.category}</span>
                    <span>·</span>
                    <span>{s.portal}</span>
                    <span>·</span>
                    <span>{s.createdAt?.toDate?.()?.toLocaleDateString?.() || ''}</span>
                  </div>
                  {s.body && <p className="text-xs text-muted-foreground mt-1 truncate">{s.body}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-xs font-bold px-2 py-1 rounded-full"
                    style={{ backgroundColor: sc + '22', color: sc }}>
                    {s.status || 'Open'}
                  </span>
                  <ChevronRightIcon size={14} className="text-muted-foreground" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
