import {
  DatabaseIcon, ServerIcon, ShieldIcon, CloudIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from './shared'

// Phase 20 — extracted from src/App.jsx. Behavior preserved exactly. The
// local SectionHeader is intentionally inlined here (it differs from the
// modern shared/headers SectionHeader and is only used by legacy tabs).

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

export default function Architecture() {
  const collections = [
    { name: 'jobs', desc: 'Top-level job records', fields: ['id', 'address', 'client', 'status', 'progress', 'pm', 'billing', 'permits', 'inspections'] },
    { name: 'jobs/{jobId}/extras', desc: 'Change orders per job', fields: ['id', 'desc', 'amount', 'status', 'qbsSync', 'createdAt', 'approvedBy'] },
    { name: 'jobs/{jobId}/materials', desc: 'Material orders per job', fields: ['item', 'qty', 'cost', 'status', 'vendor', 'eta', 'orderedAt'] },
    { name: 'subs', desc: 'Subcontractor master list', fields: ['name', 'company', 'trade', 'license', 'licenseExp', 'insurance', 'w9', 'score'] },
    { name: 'inspections', desc: 'Inspection records with photos', fields: ['jobId', 'trade', 'phase', 'status', 'inspector', 'date', 'notes', 'photos'] },
    { name: 'notifications', desc: 'System alerts + user notifications', fields: ['type', 'msg', 'jobId', 'userId', 'read', 'createdAt'] },
    { name: 'leads', desc: 'Incoming lead intake', fields: ['name', 'phone', 'email', 'address', 'type', 'budget', 'status', 'assignedPm'] },
  ]

  const functions = [
    { name: 'onJobStatusChange', trigger: 'Firestore write — jobs/{jobId}', desc: 'Push notifications to PM when job status changes' },
    { name: 'onInspectionFail', trigger: 'Firestore write — inspections/', desc: 'Block next phase, alert PM + sub, log to Slack' },
    { name: 'syncExtraToQBS', trigger: 'Firestore write — extras/', desc: 'Mirror approved COs to QuickBooks via API' },
    { name: 'subComplianceCheck', trigger: 'Scheduled — daily 06:00 CT', desc: 'Check license/insurance expiry, create alerts' },
    { name: 'billingMilestone', trigger: 'Firestore write — jobs/{jobId}/billing', desc: 'Trigger invoice generation at 70%/100% thresholds' },
    { name: 'leadNotification', trigger: 'Firestore write — leads/', desc: 'Email PM assignment + create morning briefing entry' },
  ]

  const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Jobs — P2 internal only
    match /jobs/{jobId} {
      allow read:  if isP2Internal() || isQBS();
      allow write: if isP2Internal();

      match /extras/{coId} {
        allow read:  if isP2Internal() || isQBS();
        allow create: if isP2Internal();
        allow update: if isP2Internal() || (isQBS() && onlyUpdates(['status','approvedBy','approvedAt']));
      }
      match /materials/{matId} {
        allow read, write: if isP2Internal();
      }
    }

    // Subs — P2 internal admin only
    match /subs/{subId} {
      allow read:  if isP2Internal();
      allow write: if isP2Admin();
    }

    // Inspections
    match /inspections/{inspId} {
      allow read:  if isP2Internal() || isQBS();
      allow write: if isP2Internal();
    }

    // Leads — internal only
    match /leads/{leadId} {
      allow create: if true;  // public form
      allow read, update: if isP2Internal();
    }

    function isP2Internal() {
      return request.auth != null
          && request.auth.token.role == 'p2_internal';
    }
    function isP2Admin() {
      return request.auth != null
          && request.auth.token.role == 'p2_admin';
    }
    function isQBS() {
      return request.auth != null
          && request.auth.token.role == 'qbs_coordinator';
    }
    function onlyUpdates(fields) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(fields);
    }
  }
}`

  return (
    <div className="space-y-6">
      <SectionHeader title="Architecture" sub="Firestore blueprint · Cloud Functions · Security rules" />

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <StatCard label="Collections"    value={collections.length}  Icon={DatabaseIcon} />
        <StatCard label="Cloud Functions" value={functions.length}   Icon={ServerIcon} />
        <StatCard label="Auth Roles"      value="3"                  sub="p2_internal · qbs · p2_admin" Icon={ShieldIcon} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-white/10">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DatabaseIcon size={16} style={{ color: O }} /> Firestore Collections
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {collections.map(c => (
              <div key={c.name} className="p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold" style={{ color: O }}>{c.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{c.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {c.fields.map(f => (
                    <span key={f} className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">{f}</span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ServerIcon size={16} style={{ color: O }} /> Cloud Functions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {functions.map(f => (
                <div key={f.name} className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="text-sm font-bold" style={{ color: O }}>{f.name}</span>
                  <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CloudIcon size={10} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{f.trigger}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldIcon size={16} style={{ color: O }} /> Firestore Security Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs text-muted-foreground overflow-x-auto p-4 rounded-xl bg-black/40 border border-white/5 whitespace-pre leading-relaxed">
            {rules}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
