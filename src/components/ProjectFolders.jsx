import { useState, useRef } from 'react'
import { useData } from '../DataContext'
import { useJobFiles, addJobFile } from '../hooks/useFirestore'
import { storage } from '../firebase'
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  FolderIcon, FileTextIcon, ClipboardIcon, DownloadIcon, UploadCloudIcon, ImageIcon,
} from 'lucide-react'

const O = '#F47920'

function SectionHeader({ title, sub }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function ProjectFolders() {
  const { jobs } = useData()
  const [selectedJobId, setSelectedJobId] = useState('')
  const [fileType, setFileType] = useState('Plans')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef(null)

  const selectedJob = jobs.find(j => j.id === selectedJobId)
  const { files, loading: filesLoading } = useJobFiles(selectedJob?._docId)

  const FILE_TYPES = ['Plans', 'Photos', 'PDFs', 'Notes']
  const typeColor = { Plans: '#3b82f6', Photos: '#22c55e', PDFs: '#ef4444', Notes: '#eab308' }
  const typeIconMap = { Plans: FileTextIcon, Photos: ImageIcon, PDFs: FileTextIcon, Notes: ClipboardIcon }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedJob?._docId) return
    setUploading(true)
    setUploadProgress(0)
    setUploadError('')
    try {
      const path = `jobs/${selectedJob.id}/files/${Date.now()}_${file.name}`
      const storageRef = ref(storage, path)
      await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file)
        task.on('state_changed',
          snap => setUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
          reject,
          resolve
        )
      })
      const url = await getDownloadURL(storageRef)
      await addJobFile(selectedJob._docId, {
        name: file.name,
        type: fileType,
        url,
        uploadedBy: 'P2 Team',
        size: file.size,
        storagePath: path,
      })
    } catch {
      setUploadError('Upload failed — check storage permissions')
    } finally {
      setUploading(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const fmtSize = (b) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`

  return (
    <div className="space-y-6">
      <SectionHeader title="Project Folders" sub="Per-job file management — plans, photos, PDFs, notes" />

      <Card className="border-white/10">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-muted-foreground mb-1 block">Select Job</label>
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger className="bg-white/5 border-white/20">
                  <SelectValue placeholder="Choose a job…" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map(j => (
                    <SelectItem key={j.id} value={j.id}>{j.id} — {j.client || j.address}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedJob && (
              <>
                <div className="min-w-32">
                  <label className="text-xs text-muted-foreground mb-1 block">File Type</label>
                  <Select value={fileType} onValueChange={setFileType}>
                    <SelectTrigger className="bg-white/5 border-white/20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FILE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
                  <Button
                    style={{ backgroundColor: O }}
                    className="text-white gap-2"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}>
                    <UploadCloudIcon size={14} />
                    {uploading ? `Uploading ${uploadProgress}%` : 'Upload File'}
                  </Button>
                </div>
              </>
            )}
          </div>
          {uploading && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Uploading…</span><span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${uploadProgress}%`, backgroundColor: O }}
                />
              </div>
            </div>
          )}
          {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
        </CardContent>
      </Card>

      {selectedJob ? (
        <Card className="border-white/10">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FolderIcon size={16} style={{ color: O }} />
              <span className="font-mono" style={{ color: O }}>{selectedJob.id}</span>
              <span className="text-muted-foreground font-normal">— {selectedJob.client || selectedJob.address}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {files.length} file{files.length !== 1 ? 's' : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filesLoading ? (
              <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>
            ) : files.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FolderIcon size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No files yet — upload one above</p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map(f => {
                  const TIcon = typeIconMap[f.type] || FileTextIcon
                  const tc = typeColor[f.type] || '#6b7280'
                  return (
                    <div
                      key={f._docId}
                      className="flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-colors">
                      <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: tc + '22' }}>
                        <TIcon size={14} style={{ color: tc }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: tc + '22', color: tc }}>
                            {f.type}
                          </span>
                          <span className="text-xs text-muted-foreground">by {f.uploadedBy}</span>
                          <span className="text-xs text-muted-foreground">
                            {f.createdAt?.toDate?.()?.toLocaleDateString?.() || ''}
                          </span>
                          {f.size && (
                            <span className="text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                          )}
                        </div>
                      </div>
                      <a href={f.url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm" className="gap-1 h-8 px-2 text-xs hover:bg-white/10">
                          <DownloadIcon size={12} /> Download
                        </Button>
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <FolderIcon size={48} className="mx-auto mb-4 opacity-20" />
          <p>Select a job above to view and manage files</p>
        </div>
      )}
    </div>
  )
}
