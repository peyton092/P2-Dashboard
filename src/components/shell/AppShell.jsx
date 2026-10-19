import { cn } from '@/lib/utils'

// AppShell: the overall layout, a left sidebar slot, the main content, and a fixed
// bottom mobile nav slot.
//
//   <AppShell sidebar={<Sidebar … />} mobileNav={<MobileNav … />}>
//     {pageContent}
//   </AppShell>
//
// The first thing Tab reaches is a link that skips past the sidebar to the page. It is
// hidden until it has focus. It goes to the main landmark, which can take focus from
// it and is not a stop of its own in the tab order.
export default function AppShell({ sidebar, mobileNav, children, className = '' }) {
  // The dark theme is on the document root (see index.html), so this shell
  // does not set it. `text-foreground` stays so the shell names its own text
  // color instead of relying on what body happens to set.
  return (
    <div className={cn('flex h-screen bg-background text-foreground overflow-hidden', className)}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-(--z-nav) focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-foreground"
      >
        Skip to content
      </a>
      {sidebar}
      {/* It takes focus only from the skip link, as a place to start from, and is not a
          control, so it draws no focus ring around the whole page. */}
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 min-w-0 overflow-y-auto outline-none"
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
