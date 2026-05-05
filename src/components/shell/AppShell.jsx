import { cn } from '@/lib/utils'

// AppShell — overall layout container with a left sidebar slot, main content,
// and a fixed bottom mobile nav slot.
//
//   <AppShell sidebar={<Sidebar … />} mobileNav={<MobileNav … />}>
//     {pageContent}
//   </AppShell>
export default function AppShell({ sidebar, mobileNav, children, className = '' }) {
  // `text-foreground` is intentional: body sits outside the `.dark` scope,
  // so anything that doesn't set its own color inherits the light theme's
  // near-black foreground. Re-declaring inside `.dark` propagates the
  // correct near-white foreground down the tree.
  return (
    <div className={cn('dark flex h-screen bg-background text-foreground overflow-hidden', className)}>
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
