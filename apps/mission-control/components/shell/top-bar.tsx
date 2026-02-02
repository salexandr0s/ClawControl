'use client'

import { cn } from '@/lib/utils'
import { Search, Command } from 'lucide-react'
import { StatusChipStrip, useDefaultStatusChips } from './status-chip-strip'
import { Kbd } from '../ui/kbd'

interface TopBarProps {
  title?: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  onChipClick?: (chipId: string) => void
  onSearchClick?: () => void
  className?: string
}

export function TopBar({
  title,
  breadcrumbs,
  onChipClick,
  onSearchClick,
  className,
}: TopBarProps) {
  const chips = useDefaultStatusChips()

  return (
    <header
      className={cn(
        'h-[var(--topbar-height)] flex items-center gap-4 px-4 border-b border-bd-0 bg-bg-1 shrink-0',
        className
      )}
    >
      {/* Left: Breadcrumbs / Title - takes minimum space needed */}
      <div className="flex items-center gap-2 min-w-0 shrink-0 max-w-[280px]">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <span className="text-fg-3 shrink-0">/</span>}
                {crumb.href ? (
                  <a
                    href={crumb.href}
                    className="text-fg-1 hover:text-fg-0 transition-colors truncate"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-fg-0 truncate">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : title ? (
          <h1 className="text-sm font-medium text-fg-0 truncate">{title}</h1>
        ) : null}
      </div>

      {/* Center: Status Chip Strip - scrollable, takes available space */}
      <div className="flex-1 min-w-0 hidden md:block">
        <StatusChipStrip
          chips={chips}
          onChipClick={onChipClick}
          scrollable
        />
      </div>

      {/* Right: Search - fixed width */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onSearchClick}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)]',
            'bg-bg-2 border border-bd-0 hover:border-bd-1 transition-colors',
            'text-fg-2 hover:text-fg-1'
          )}
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-xs hidden sm:inline">Search</span>
          <span className="hidden lg:flex items-center gap-0.5 ml-2">
            <Kbd>
              <Command className="w-2.5 h-2.5" />
            </Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>
    </header>
  )
}
