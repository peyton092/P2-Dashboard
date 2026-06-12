import { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { logError } from '../lib/errorLogger'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldIcon, FileTextIcon, CheckIcon } from 'lucide-react'

const O = '#F47920'

export default function TermsGate({ tenantId, tenantName, onAccept }) {
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const version = 'v2026.04.16'

  const handleAccept = async () => {
    if (!checked) return
    const u = auth.currentUser
    setSaving(true)
    try {
      if (u) {
        await setDoc(
          doc(db, 'users', u.uid, 'termsAcceptances', version),
          {
            acceptedAt: new Date().toISOString(),
            version,
            tenantId,
            email: u.email || null,
          },
          { merge: true },
        )
      }
    } catch (err) {
      // Don't block portal entry if logging fails — but record it.
      logError('termsGate.persistAcceptance', err)
    } finally {
      setSaving(false)
      onAccept()
    }
  }

  return (
    <div className="dark min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: O }}>
          <ShieldIcon size={20} color="#fff" />
        </div>
        <div>
          <p className="font-bold text-lg leading-none">P2 Field Control</p>
          <p className="text-xs text-muted-foreground">{tenantName} · Builder Portal</p>
        </div>
      </div>

      <Card className="w-full max-w-lg border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileTextIcon size={16} style={{ color: O }} /> Terms of Access · {version}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-3 p-4 rounded-xl bg-white/5 max-h-64 overflow-y-auto">
            <p className="font-semibold text-foreground">P2 Field Control — Builder Portal Access Agreement</p>
            <p>By accessing this portal, you agree to the following terms:</p>
            <p><strong>1. Authorized Use.</strong> This portal is provided exclusively for authorized contractors and coordinators. Access credentials must not be shared.</p>
            <p><strong>2. Data Confidentiality.</strong> All project data, financial information, and documents accessed through this portal are confidential to P2 Field Services and its clients.</p>
            <p><strong>3. Scope of Access.</strong> You may only access data pertaining to your assigned projects and workspace ({tenantName}).</p>
            <p><strong>4. Change Order Approval.</strong> Change orders approved through this portal are legally binding and constitute authorization to proceed.</p>
            <p><strong>5. Audit Logging.</strong> All actions taken in this portal are logged with timestamp and user identity.</p>
            <p className="text-xs">Version {version} · P2 Field Services LLC · Middle Tennessee</p>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl border border-white/10 cursor-pointer" onClick={() => setChecked(c => !c)}>
            <div className="w-5 h-5 rounded border flex items-center justify-center shrink-0"
              style={{ borderColor: checked ? O : '#6b7280', backgroundColor: checked ? O : 'transparent' }}>
              {checked && <CheckIcon size={12} color="#fff" />}
            </div>
            <span className="text-sm">I have read and agree to the P2 Field Control Terms of Access ({version})</span>
          </div>

          <Button
            className="w-full text-white"
            style={{ backgroundColor: checked ? O : '#374151' }}
            disabled={!checked || saving}
            onClick={handleAccept}>
            {saving ? 'Recording acceptance…' : 'Accept & Enter Portal'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
