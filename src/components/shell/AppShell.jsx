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
        {/* The content fills the width of the screen, inside gutters of 16 pixels on
            a phone, 24 from 640 and 32 from 1024. Only above 1800 pixels is it
            capped at 1760 and centered, so a very wide monitor does not stretch a
            row of figures across the room. The cap is min-[1800px] and not 2xl,
            because 2xl starts at 1536 pixels. */}
        <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 min-[1800px]:mx-auto min-[1800px]:max-w-[1760px]">
          {children}
        </div>
      </main>
      {mobileNav}
    </div>
  )
}
