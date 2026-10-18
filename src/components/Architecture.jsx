import {
  DatabaseIcon, ServerIcon, ShieldIcon, CloudIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from './shared'

// Extracted from src/App.jsx in Phase 20. The local SectionHeader is inlined on
// purpose: it differs from the modern shared/headers SectionHeader and only legacy
// tabs use it.
//
// The collections, functions and rules below describe firestore.rules,
// storage.rules and functions/index.js as deployed. __tests__/Architecture.test.jsx
// reads index.js and fails when the list here and the exports there disagree, so a
// function added there has to be listed here too. Copy has no dashes.

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
  // Roles are exactly these four, and staff means owner or internal.
  const roles = ['owner', 'internal', 'builder', 'client']

  // Chips list the fields a document carries. For config, qb_config and cc_config
  // they are the documents themselves, app_settings lists the fields of its
  // google_review document, permits shows the author stamp only (createdBy,
  // createdByEmail and createdAt), and urgent_items shows resolved, createdBy and
  // createdAt.
  const collections = [
    { name: 'jobs', desc: 'Job records. Staff write. A builder reads the jobs of their tenant and a client the jobs that list them.', fields: ['id', 'tenantId', 'clientUids', 'address', 'client', 'status', 'pm', 'billingStatus', 'permits', 'insp'] },
    { name: 'jobs/{jobId}/files', desc: 'Photo and document records, read with their job. Staff write, and a client listed on the job may add their own upload.', fields: ['name', 'url', 'type', 'source', 'uploadedBy', 'createdBy', 'createdAt'] },
    { name: 'extras', desc: 'Change orders. Staff write drafts, which are never stamped (a scope one carries is deleted), and sending, approving and rejecting go through callables. Read by staff, and once sent by the builders of the tenant and the clients of the job.', fields: ['coNumber', 'job', 'date', 'status', 'total', 'tenantId', 'clientUids', 'approvedBy', 'rejectedBy', 'rejectNotes'] },
    { name: 'notifications', desc: 'Alerts written by the Cloud Functions and by staff. Anyone who may read one may mark it read.', fields: ['type', 'msg', 'jobId', 'tenantId', 'clientUids', 'read', 'createdBy', 'createdAt'] },
    { name: 'submits', desc: 'Questions, RFIs and issues. Each is created as the person signed in, and anyone who may read one may move its status.', fields: ['subject', 'category', 'priority', 'body', 'jobId', 'status', 'tenantId', 'clientUids', 'createdBy'] },
    { name: 'submits/{submitId}/replies', desc: 'The thread under a submission. Each reply is written as the person signed in, under their own role.', fields: ['body', 'author', 'authorRole', 'createdBy', 'createdAt'] },
    { name: 'subs', desc: 'Subcontractor master list. Staff only.', fields: ['name', 'co', 'trade', 'licExp', 'insExp', 'w9'] },
    { name: 'materials', desc: 'Material orders. Staff only.', fields: ['name', 'qty', 'unit', 'jobId', 'status', 'vendor', 'dateOrdered', 'dateNeeded', 'cost'] },
    { name: 'permits', desc: 'Permit records. Staff only. The permit status of each trade sits on the job.', fields: ['createdBy', 'createdByEmail', 'createdAt'] },
    { name: 'daily_reports', desc: 'Crew daily reports. Staff only.', fields: ['crewMember', 'jobId', 'date', 'phase', 'workCompleted', 'photoUrls', 'blocker', 'inspectionReady', 'nextStep'] },
    { name: 'urgent_items', desc: 'Urgent items. Staff only.', fields: ['resolved', 'createdBy', 'createdAt'] },
    { name: 'history', desc: 'The Activity feed, written with each privileged change. The browser still writes the materials history for staff. Staff only.', fields: ['type', 'action', 'summary', 'actor', 'actorUid', 'jobId', 'extraId', 'createdAt'] },
    { name: 'supplier_invoices', desc: 'Supplier invoices and their audit flags. Staff only.', fields: ['vendor', 'invoiceNum', 'invoiceDate', 'jobId', 'lineItems', 'total', 'status', 'flags'] },
    { name: 'users', desc: 'Role records, never self writable. An owner writes any record. Internal staff write builder and client records only.', fields: ['email', 'displayName', 'role', 'tenantId', 'clientJobIds', 'clientName', 'createdBy'] },
    { name: 'users/{uid}/termsAcceptances', desc: 'A builder accepts the Terms of Access once for each version.', fields: ['version', 'acceptedAt', 'tenantId', 'email'] },
    { name: 'fcm_tokens', desc: 'Push device tokens. A user registers their own, and staff read all.', fields: ['token', 'platform', 'uid', 'email', 'updatedAt'] },
    { name: 'error_logs', desc: 'Client error reports, created as the signed in user. Staff read.', fields: ['message', 'stack', 'source', 'userEmail', 'url', 'timestamp'] },
    { name: 'config', desc: 'App settings, kept in the settings document. Staff only.', fields: ['settings'] },
    { name: 'agent_alerts', desc: 'Alerts raised by the PM Agent. Staff only.', fields: ['id', 'jobId', 'type', 'severity', 'title', 'pm', 'status'] },
    { name: 'crew_scores', desc: 'Crew leaderboard scores, one document for each crew member. Staff only.', fields: ['name', 'role', 'googleReviews', 'referrals', 'bonusPoints', 'bonusNote'] },
    { name: 'app_settings', desc: 'The review link settings, kept in the google_review document. Staff only.', fields: ['url', 'updatedAt'] },
    { name: 'qb_config', desc: 'QuickBooks OAuth tokens and one time states. Staff only, and the Cloud Functions reach it with the Admin SDK.', fields: ['tokens', 'oauth_states'] },
    { name: 'cc_config', desc: 'CompanyCam OAuth tokens, one time states and the last photo sync result. Staff only.', fields: ['tokens', 'oauth_states', 'sync'] },
  ]

  // Every function functions/index.js exports, in the order of its modules. kind is
  // how it runs, when is who may call it or what fires it, and module is the file.
  const kinds = [
    { kind: 'Callable', label: 'Callables' },
    { kind: 'Trigger', label: 'Triggers' },
    { kind: 'Scheduled', label: 'Scheduled' },
  ]

  const functions = [
    { name: 'qbAuth', kind: 'Callable', module: 'oauth-quickbooks.js', when: 'Staff only', desc: 'Returns the Intuit authorization URL and stores a one time state token for the callback to verify.' },
    { name: 'qbCallback', kind: 'Callable', module: 'oauth-quickbooks.js', when: 'Staff only', desc: 'Verifies the state, exchanges the code for tokens and saves them in qb_config/tokens.' },
    { name: 'qbDisconnect', kind: 'Callable', module: 'oauth-quickbooks.js', when: 'Staff only', desc: 'Revokes the refresh token at Intuit and deletes the saved tokens.' },
    { name: 'ccAuth', kind: 'Callable', module: 'oauth-companycam.js', when: 'Staff only', desc: 'Returns the CompanyCam authorization URL and stores a one time state token in cc_config/oauth_states.' },
    { name: 'ccCallback', kind: 'Callable', module: 'oauth-companycam.js', when: 'Staff only', desc: 'Verifies the state, exchanges the code for tokens and saves them in cc_config/tokens.' },
    { name: 'ccDisconnect', kind: 'Callable', module: 'oauth-companycam.js', when: 'Staff only', desc: 'Revokes the token at CompanyCam and deletes the saved tokens.' },
    { name: 'ccSyncPhotos', kind: 'Callable', module: 'companycam-sync.js', when: 'Staff only', desc: 'Pulls CompanyCam photos, matches projects to jobs by street address and writes references into jobs/{id}/files. Started from Settings.' },
    { name: 'createUser', kind: 'Callable', module: 'users.js', when: 'Owner only', desc: 'Creates the Auth account with a random password, sets its claims and writes users/{uid}. The browser then emails a link to choose a password.' },
    { name: 'sendExtraToBuilder', kind: 'Callable', module: 'extras.js', when: 'Staff only', desc: 'Sends a change order to the builder, new or revised after a rejection.' },
    { name: 'approveExtra', kind: 'Callable', module: 'extras.js', when: 'Staff, the builder of its tenant, the clients of its job', desc: 'Approves a change order that is waiting for a decision. One already decided is refused, and so is one whose total changed since the person opened it.' },
    { name: 'rejectExtra', kind: 'Callable', module: 'extras.js', when: 'Staff, the builder of its tenant, the clients of its job', desc: 'Asks for a revision of a change order, with a note saying what. Refused the same way as an approval.' },
    { name: 'passInspection', kind: 'Callable', module: 'inspections.js', when: 'Staff only', desc: 'Marks one phase of one trade as passed on a job, dated today.' },
    { name: 'failInspection', kind: 'Callable', module: 'inspections.js', when: 'Staff only', desc: 'Marks one phase of one trade as failed on a job, dated today.' },
    { name: 'createJob', kind: 'Callable', module: 'jobs.js', when: 'Staff only', desc: 'Creates a job with its tenant and, in clientUids, the clients whose users document already lists it, and refuses an ID that is taken.' },
    { name: 'backfillScopes', kind: 'Callable', module: 'scope-sync.js', when: 'Owner only', desc: 'Sets the claims of every user, stamps scope onto jobs, change orders, submissions and notifications, and clears the scope of a draft change order. Safe to run again.' },
    { name: 'onNotificationCreated', kind: 'Trigger', module: 'push.js', when: 'Firestore create on notifications/{id}', desc: 'Sends a push to the devices of the people the notification is in scope for, and prunes dead tokens.' },
    { name: 'onUserWritten', kind: 'Trigger', module: 'users.js', when: 'Firestore write on users/{uid}', desc: 'Copies a users document into the Auth claims, links a client to the jobs they list, and revokes refresh tokens when a role changes.' },
    { name: 'onJobWritten', kind: 'Trigger', module: 'scope-sync.js', when: 'Firestore write on jobs/{id}', desc: 'When the tenant or clients of a job change, stamps the new scope onto its change orders, submissions and notifications. A draft change order is left as it is.' },
    { name: 'onExtraWritten', kind: 'Trigger', module: 'scope-sync.js', when: 'Firestore write on extras/{id}', desc: 'Gives a change order the scope of its job when it lacks it. A draft is not stamped until it is sent, and a scope it carries is deleted.' },
    { name: 'onSubmitWritten', kind: 'Trigger', module: 'scope-sync.js', when: 'Firestore write on submits/{id}', desc: 'Gives a submission the scope of its job when it lacks it. A submission a builder created keeps its own tenant when its job is in another, and lists no clients.' },
    { name: 'ccSyncPhotosScheduled', kind: 'Scheduled', module: 'companycam-sync.js', when: 'Every 6 hours', desc: 'Runs the CompanyCam photo sync when CompanyCam is connected.' },
  ]

  // A short summary of firestore.rules and storage.rules, in place of the rules text.
  const rules = [
    { title: 'Roles', text: `Four roles: ${roles.join(', ')}. Staff means owner or internal. The role comes from the token claim, or from the users document when the token has none. An owner writes any users record; internal staff write builder and client records only.` },
    { title: 'Tenants', text: 'p2-core, qbs and vision. A builder belongs to qbs or vision, and every other role is p2-core.' },
    { title: 'Scope fields', text: 'Jobs, change orders, submissions and notifications carry tenantId and clientUids, stamped by the Cloud Functions from the job. A draft change order is never stamped, and a document that was never stamped is staff only.' },
    { title: 'Reads', text: 'Staff read every collection. A builder reads the documents of their tenant, and a client the documents whose clientUids list them. The portals query with exactly that filter, so Firestore can prove each query stays in scope.' },
    { title: 'Portal writes', text: 'Builders and clients may mark a notification read, create a submission with their own scope, move its status and reply as themselves. A client listed on a job may also record their own upload. They also register their own push token, accept the Terms for themselves and report their own errors. Everything else is staff only, or goes through a callable.' },
    { title: 'Staff only', text: 'qb_config, cc_config, config, agent_alerts, crew_scores, app_settings, materials, subs, permits, daily_reports, urgent_items, history and supplier_invoices.' },
    { title: 'Storage', text: 'Client uploads sit under jobs/{jobDocId}/client-uploads/: a JPEG, PNG, HEIC, WebP or PDF under 25 MB, written by staff or by a client the job lists, and listable by any signed in account that knows the job id. Every other path is staff only.' },
  ]

  const underParent = collections.filter(c => c.name.includes('/')).length
  const topLevel = collections.filter(c => !c.name.includes('/')).length
  const countOf = (kind) => functions.filter(f => f.kind === kind).length

  return (
    <div className="space-y-6">
      <SectionHeader title="Architecture" sub="Firestore blueprint · Cloud Functions · Security rules" />

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <StatCard label="Collections"    value={topLevel}            sub={`plus ${underParent} subcollections`} Icon={DatabaseIcon} />
        <StatCard label="Cloud Functions" value={functions.length}   sub={kinds.map(k => `${countOf(k.kind)} ${k.label.toLowerCase()}`).join(', ')} Icon={ServerIcon} />
        <StatCard label="Auth Roles"      value={roles.length}       sub={roles.join(', ')} Icon={ShieldIcon} />
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
              {kinds.map(k => (
                <div key={k.kind} className="space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">{k.label}</p>
                  {functions.filter(f => f.kind === k.kind).map(f => (
                    <div key={f.name} className="p-3 rounded-lg bg-white/5 border border-white/5">
                      <span className="text-sm font-bold" style={{ color: O }}>{f.name}</span>
                      <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <CloudIcon size={10} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{f.when} · {f.module}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldIcon size={16} style={{ color: O }} /> Firestore and Storage Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.map(r => (
            <div key={r.title} className="p-3 rounded-lg bg-white/5 border border-white/5">
              <span className="text-sm font-bold" style={{ color: O }}>{r.title}</span>
              <p className="text-xs text-muted-foreground mt-1">{r.text}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
