import { cn } from '@/lib/utils'

// AppShell — overall layout container with a left sidebar slot, main content,
// and a fixed bottom mobile nav slot.
//
//   <AppShell sidebar={<Sidebar … />} mobileNav={<MobileNav … />}>
//     {pageContent}
//   </AppShell>
export default function AppShell({ sidebar, mobileNav, children, className = '' }) {
  // The dark theme is on the document root (see index.html), so this shell
  // does not set it. `text-foreground` stays so the shell names its own text
  // color instead of relying on what body happens to set.
  return (
    <div className={cn('flex h-screen bg-background text-foreground overflow-hidden', className)}>
      {sidebar}
      <main
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          {children}
        </div>
      </main>
      {mobileNav}
    </div>
  )
}
