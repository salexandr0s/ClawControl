'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ClipboardList,
  Bot,
  LayoutTemplate,
  Clock,
  FolderTree,
  TerminalSquare,
  Wrench,
  Activity,
  Sparkles,
  Puzzle,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  MessageSquare,
  Radio,
} from 'lucide-react'
import type { Route } from 'next'

interface NavItem {
  href: Route
  label: string
  icon: React.ComponentType<{ className?: string }>
}

// Routes cast to Route type - actual routes will be added incrementally
const navItems: NavItem[] = [
  { href: '/now' as Route, label: 'Now', icon: LayoutDashboard },
  { href: '/work-orders' as Route, label: 'Work Orders', icon: ClipboardList },
  { href: '/approvals' as Route, label: 'Approvals', icon: ShieldCheck },
  { href: '/console' as Route, label: 'Chat', icon: MessageSquare },
  { href: '/agents' as Route, label: 'Agents', icon: Bot },
  { href: '/agent-templates' as Route, label: 'Templates', icon: LayoutTemplate },
  { href: '/cron' as Route, label: 'Cron', icon: Clock },
  { href: '/workspace' as Route, label: 'Workspace', icon: FolderTree },
  { href: '/runs' as Route, label: 'Runs', icon: TerminalSquare },
  { href: '/maintenance' as Route, label: 'Maintenance', icon: Wrench },
  { href: '/gateway-live' as Route, label: 'Gateway', icon: Radio },
  { href: '/live' as Route, label: 'Live', icon: Activity },
  { href: '/skills' as Route, label: 'Skills', icon: Sparkles },
  { href: '/plugins' as Route, label: 'Plugins', icon: Puzzle },
]

interface RailNavProps {
  collapsed: boolean
  onToggle: () => void
}

export function RailNav({ collapsed, onToggle }: RailNavProps) {
  const pathname = usePathname()

  return (
    <nav
      className={cn(
        'flex flex-col bg-bg-1 border-r border-white/[0.06] transition-all duration-200 shrink-0 h-screen',
        collapsed ? 'w-[56px]' : 'w-[200px]'
      )}
    >
      {/* Logo */}
      <div className={cn(
        "h-[var(--topbar-height)] flex items-center border-b border-white/[0.06] shrink-0",
        collapsed ? "justify-center px-0" : "px-4"
      )}>
        <span className="text-sm font-semibold text-fg-0 tracking-wide">S</span>
      </div>

      {/* Nav Items */}
      <div className="flex-1 py-2 overflow-y-auto scrollbar-hide min-h-0">
        <div className={cn(
          "space-y-0.5",
          collapsed ? "px-1.5" : "px-2"
        )}>
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center rounded-[var(--radius-md)] transition-colors relative',
                  collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
                  isActive
                    ? 'bg-bg-3 text-fg-0'
                    : 'text-fg-1 hover:bg-bg-3/50 hover:text-fg-0'
                )}
              >
                {/* Active indicator - only in expanded mode */}
                {!collapsed && isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-status-info rounded-r" />
                )}
                <Icon className={cn(
                  "shrink-0",
                  collapsed ? "w-[18px] h-[18px]" : "w-4 h-4"
                )} />
                {!collapsed && (
                  <span className="text-[13px] truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Settings + Collapse */}
      <div className={cn(
        "py-2 border-t border-white/[0.06] space-y-0.5 shrink-0",
        collapsed ? "px-1.5" : "px-2"
      )}>
        <Link
          href={'/settings' as Route}
          className={cn(
            'flex items-center rounded-[var(--radius-md)] transition-colors',
            collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
            pathname === '/settings'
              ? 'bg-bg-3 text-fg-0'
              : 'text-fg-1 hover:bg-bg-3/50 hover:text-fg-0'
          )}
        >
          <Settings className={cn(
            "shrink-0",
            collapsed ? "w-[18px] h-[18px]" : "w-4 h-4"
          )} />
          {!collapsed && <span className="text-[13px]">Settings</span>}
        </Link>

        <button
          onClick={onToggle}
          className={cn(
            'flex items-center rounded-[var(--radius-md)] text-fg-2 hover:text-fg-1 hover:bg-bg-3/50 transition-colors w-full',
            collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2'
          )}
        >
          {collapsed ? (
            <ChevronRight className="w-[18px] h-[18px]" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>
    </nav>
  )
}
