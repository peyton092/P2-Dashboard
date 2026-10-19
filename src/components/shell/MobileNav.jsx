import { useState } from 'react'
import { cn } from '@/lib/utils'
import { MoreHorizontalIcon } from 'lucide-react'
import { Dialog, DialogBody } from '@/components/ui/dialog'

// MobileNav: the bottom bar a thumb reaches on a phone, and a More pages drawer for
// the rest.
//
// Props:
//   primary: array of up to 4 nav items: [{ id, label, Icon, count? }]
//   more:    array of secondary items shown in the drawer
//   activeId
//   onSelect(id)
//
// The page that is open is marked aria-current="page" on the bar and in the drawer,
// as well as in the brand color. Every target is at least 44 pixels tall. The drawer
// is a modal dialog named More pages: it keeps focus inside while it is open, closes
// on Escape, the scrim or its close button, and gives focus back to More.
export default function MobileNav({
  primary = [],
  more = [],
  activeId,
  onSelect,
}) {
  const [open, setOpen] = useState(false)

  const handleSelect = (id) => {
    onSelect?.(id)
    setOpen(false)
  }

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-(--z-nav) border-t border-white/10 bg-surface-1"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="flex">
          {primary.slice(0, 4).map(item => {
            const active = activeId === item.id
            return (
              <li key={item.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'w-full min-h-11 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors focus-visible:-outline-offset-2',
                    active ? 'text-brand' : 'text-neutral',
                  )}
                >
                  <NavIcon item={item} size={20} strokeWidth={active ? 2.4 : 2} />
                  <span className="text-[10px] font-semibold leading-none">
                    {item.label}
                  </span>
                  <CountWords count={item.count} />
                </button>
              </li>
            )
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={cn(
                'w-full min-h-11 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors focus-visible:-outline-offset-2',
                open ? 'text-brand' : 'text-neutral',
              )}
            >
              <MoreHorizontalIcon size={20} aria-hidden="true" />
              <span className="text-[10px] font-semibold leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={open} onClose={() => setOpen(false)} title="More pages" hideTitle placement="bottom" size="lg">
        <DialogBody className="px-3 pt-2" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <ul className="grid grid-cols-4 gap-1.5">
            {more.map(item => {
              const active = activeId === item.id
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'w-full min-h-11 flex flex-col items-center gap-1.5 px-1 py-2.5 rounded-xl transition-colors relative',
                      active
                        ? 'bg-white/[0.06] text-brand'
                        : 'text-muted-foreground hover:bg-white/5',
                    )}
                  >
                    <NavIcon item={item} size={18} />
                    <span className="text-[10px] font-semibold text-center leading-tight">
                      {item.label}
                    </span>
                    <CountWords count={item.count} />
                  </button>
                </li>
              )
            })}
          </ul>
        </DialogBody>
      </Dialog>
    </>
  )
}

// The icon of a page, with its count over the corner. Both are pictures: the count is
// read after the name of the page (see CountWords), so the name comes first.
function NavIcon({ item, size, strokeWidth }) {
  return (
    <span className="relative" aria-hidden="true">
      <item.Icon size={size} strokeWidth={strokeWidth} />
      {item.count > 0 && (
        <span
          className="absolute -top-1 -right-2 bg-brand text-brand-foreground font-black rounded-full flex items-center justify-center"
          style={{ fontSize: '9px', minWidth: 14, height: 14, padding: '0 3px' }}
        >
          {item.count > 99 ? '99+' : item.count}
        </span>
      )}
    </span>
  )
}

// The count of a page as a screen reader hears it, after the name: Alerts 2.
function CountWords({ count }) {
  return count > 0 ? <span className="sr-only">{` ${count}`}</span> : null
}
