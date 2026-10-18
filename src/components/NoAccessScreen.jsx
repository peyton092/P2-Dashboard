import { LockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const O = '#F47920'

// Shown to a signed in user whose account carries no valid role.
export default function NoAccessScreen({ email, onLogout }) {
  return (
    <div className="dark min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-6">
      <Card className="w-full max-w-sm border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LockIcon size={16} style={{ color: O }} /> No access yet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your account exists but has not been given a role. Ask the P2 office to finish your setup.
          </p>
          <p className="text-xs text-muted-foreground">
            Signed in as <code className="select-all text-foreground">{email}</code>
          </p>
          <Button className="w-full text-white" style={{ backgroundColor: O }} onClick={onLogout}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
