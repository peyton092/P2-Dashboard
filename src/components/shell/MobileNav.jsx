import { useState } from 'react'
import { cn } from '@/lib/utils'
import { MoreHorizontalIcon, XIcon } from 'lucide-react'

const O = '#F47920'

// MobileNav — bottom thumb-friendly nav + slide-up "More" drawer.
//
// Props:
//   primary: array of up to 4 nav items: [{ id, label, Icon, count? }]
//   more:    array of secondary items shown in the drawer
//   activeId
//   onSelect(id)
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
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/10"
        style={{
          backgroundColor: 'oklch(0.165 0 0)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <ul className="flex">
          {primary.slice(0, 4).map(item => {
            const active = activeId === item.id
            return (
              <li key={item.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  className="w-full flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors"
                  style={{ color: active ? O : '#9ca3af' }}
                >
                  <span className="relative">
                    <item.Icon size={20} strokeWidth={active ? 2.4 : 2} />
                    {item.count > 0 && (
                      <span
                        className="absolute -top-1 -right-2 text-white font-black rounded-full flex items-center justify-center"
                        style={{
                          backgroundColor: O,
                          fontSize: '9px',
                          minWidth: 14,
                          height: 14,
                          padding: '0 3px',
                        }}
                      >
                        {item.count > 99 ? '99+' : item.count}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-semibold leading-none">
                    {item.label}
                  </span>
                </button>
              </li>
            )
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              className="w-full flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors"
              style={{ color: open ? O : '#9ca3af' }}
            >
              {open ? <XIcon size={20} /> : <MoreHorizontalIcon size={20} />}
              <span className="text-[10px] font-semibold leading-none">
                {open ? 'Close' : 'More'}
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div
          className="md:hidden fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div
            className="absolute left-0 right-0 border-t border-white/10 px-3 pt-4 pb-3"
            style={{
              bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
              backgroundColor: 'oklch(0.165 0 0)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3 px-1">
              All sections
            </p>
            <ul className="grid grid-cols-4 gap-1.5">
              {more.map(item => {
                const active = activeId === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(item.id)}
                      className={cn(
                        'w-full flex flex-col items-center gap-1.5 px-1 py-2.5 rounded-xl transition-colors relative',
                        active
                          ? 'bg-white/[0.06] text-white'
                          : 'text-muted-foreground hover:bg-white/5',
                      )}
                      style={active ? { color: O } : undefined}
                    >
                      <span className="relative">
                        <item.Icon size={18} />
                        {item.count > 0 && (
                          <span
                            className="absolute -top-1 -right-2 text-white font-black rounded-full flex items-center justify-center"
                            style={{
                              backgroundColor: O,
                              fontSize: '9px',
                              minWidth: 14,
                              height: 14,
                              padding: '0 3px',
                            }}
                          >
                            {item.count > 99 ? '99+' : item.count}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-semibold text-center leading-tight">
                        {item.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
