import { LockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { BRAND } from '@/lib/tokens'

// Shown to a signed in user whose account carries no valid role. The screen is the whole
// page: one main landmark and one level one heading.
export default function NoAccessScreen({ email, onLogout }) {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-6">
      <Card className="w-full max-w-sm border-white/10 bg-white/5">
        <CardHeader>
          <h1 className="font-heading text-base leading-snug font-medium tracking-normal flex items-center gap-2">
            <LockIcon size={16} style={{ color: BRAND }} aria-hidden="true" /> No access yet
          </h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your account exists but has not been given a role. Ask the P2 office to finish your setup.
          </p>
          <p className="text-xs text-muted-foreground">
            Signed in as <code className="select-all text-foreground">{email}</code>
          </p>
          <Button variant="brand" className="w-full" onClick={onLogout}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
