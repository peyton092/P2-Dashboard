import { cn } from '@/lib/utils'
import {
  ChevronLeftIcon, ChevronRightIcon, LogOutIcon, UsersIcon,
} from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import Brand, { BrandMark } from '@/components/brand/Brand'

const O = '#F47920'

// Sidebar — desktop only.
//
// Props:
//   sections: [{ heading?: string, items: [{ id, label, Icon, count? }] }]
//   activeId
//   onSelect(id)
//   collapsed / onToggleCollapse
//   tenants?: [{ id, name }]; tenantId; onTenantChange — optional
//   role: 'internal' | 'owner' | 'builder'
//   userLabel, roleLabel
//   onLogout
//   onCreateUser? — only shown for owner/internal
export default function Sidebar({
  sections = [],
  activeId,
  onSelect,
  collapsed,
  onToggleCollapse,
  tenants,
  tenantId,
  onTenantChange,
  role,
  userLabel,
  roleLabel,
  onLogout,
  onCreateUser,
}) {
  return (
    <aside
      className={cn(
        'hidden md:flex md:flex-col h-screen shrink-0 border-r border-white/10',
        'transition-[width] duration-300',
        collapsed ? 'w-[72px]' : 'w-[244px]',
      )}
      style={{ backgroundColor: 'oklch(0.165 0 0)' }}
      aria-label="Primary"
    >
      {/* Brand strip */}
      <div className="flex items-center justify-between gap-2 px-3 h-[64px] border-b border-white/10 shrink-0">
        {collapsed ? (
          <BrandMark size={32} className="mx-auto" />
        ) : (
          <Brand size={30} tone="light" />
        )}
        <button
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapse}
          className={cn(
            'rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors',
            collapsed && 'absolute right-2 top-3',
          )}
        >
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
        </button>
      </div>

      {/* Nav scroll area — flat list. Section structure is preserved in props
          so callers can group routes logically, but the mockup uses a clean
          flat visual with thin dividers between groups. */}
      <nav className="p2-scrollarea flex-1 overflow-y-auto py-3" aria-label="Workspace navigation">
        <ul className="px-2 space-y-0.5">
          {sections.map((section, sIdx) =>
            section.items.map((item, iIdx) => {
              const active = activeId === item.id
              const firstOfGroup = iIdx === 0 && sIdx > 0
              return (
                <li key={item.id} className={firstOfGroup && !collapsed ? 'pt-2 mt-2 border-t border-white/[0.06]' : undefined}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(item.id)}
                    className={cn(
                      'group relative w-full flex items-center gap-3 rounded-lg px-2.5 py-2',
                      'text-sm font-medium text-left transition-colors',
                      active
                        ? 'text-white bg-white/[0.06]'
                        : 'text-zinc-300 hover:text-white hover:bg-white/[0.04]',
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                        style={{ backgroundColor: O }}
                      />
                    )}
                    <item.Icon
                      size={18}
                      className="shrink-0"
                      strokeWidth={active ? 2.25 : 1.85}
                      style={active ? { color: O } : undefined}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.count > 0 && (
                          <span
                            className={cn(
                              'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
                              active
                                ? 'text-white'
                                : 'text-zinc-300 bg-white/[0.08]',
                            )}
                            style={active ? { backgroundColor: O, color: '#fff' } : undefined}
                          >
                            {item.count}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && item.count > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: O }}
                      />
                    )}
                  </button>
                </li>
              )
            }),
          )}
        </ul>
      </nav>

      {/* Footer: tenant + user + logout */}
      <div className="border-t border-white/10 shrink-0">
        {!collapsed && tenants && tenants.length > 1 && onTenantChange && (
          <div className="px-3 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">
              Workspace
            </p>
            <Select value={tenantId} onValueChange={onTenantChange}>
              <SelectTrigger className="w-full h-8 text-xs bg-white/[0.04] border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tenants.map(t => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className={cn('p-3', collapsed && 'flex flex-col items-center gap-2')}>
          {!collapsed ? (
            <div className="flex items-center gap-2.5 mb-2">
              <div
                className="shrink-0 flex items-center justify-center rounded-full text-[11px] font-bold"
                style={{ width: 32, height: 32, backgroundColor: O + '22', color: O }}
              >
                {(userLabel || 'P2').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {userLabel || 'P2 Field Services'}
                </p>
                <p className="text-[11px] text-zinc-400 truncate">
                  {roleLabel || (role === 'internal' ? 'Internal' : role === 'owner' ? 'Owner' : 'Builder')}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="flex items-center justify-center rounded-full text-[11px] font-bold"
              style={{ width: 32, height: 32, backgroundColor: O + '22', color: O }}
              title={userLabel || 'P2'}
            >
              {(userLabel || 'P2').slice(0, 2).toUpperCase()}
            </div>
          )}

          {!collapsed && (role === 'owner' || role === 'internal') && onCreateUser && (
            <button
              type="button"
              onClick={onCreateUser}
              className="w-full mt-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-colors"
            >
              <UsersIcon size={14} /> Manage users
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-colors',
                collapsed ? 'mt-1' : 'w-full text-xs mt-1',
              )}
              title="Sign out"
            >
              {collapsed ? <LogOutIcon size={16} /> : <><LogOutIcon size={14} /> Sign out</>}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
