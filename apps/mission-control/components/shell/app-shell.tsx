'use client'

import { useState, useEffect, ReactNode, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout-context'
import { RailNav } from './rail-nav'
import { TopBar } from './top-bar'
import { RightDrawer } from './right-drawer'

interface AppShellProps {
  children: ReactNode
  // Drawer props
  drawer?: ReactNode
  drawerOpen?: boolean
  drawerTitle?: string
  drawerDescription?: string
  onDrawerClose?: () => void
  drawerWidth?: 'default' | 'lg' | 'full'
  // TopBar props
  title?: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  onChipClick?: (chipId: string) => void
  onSearchClick?: () => void
}

const RAIL_STORAGE_KEY = 'savorg-rail-collapsed'

export function AppShell({
  children,
  drawer,
  drawerOpen = false,
  drawerTitle,
  drawerDescription,
  onDrawerClose,
  drawerWidth = 'default',
  title,
  breadcrumbs,
  onChipClick,
  onSearchClick,
}: AppShellProps) {
  const { resolved, isNarrow, isMobile } = useLayout()
  const [railCollapsed, setRailCollapsed] = useState(true) // Start collapsed to prevent flash
  const [isInitialized, setIsInitialized] = useState(false)

  // Load rail state from local storage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(RAIL_STORAGE_KEY)
      if (saved !== null) {
        setRailCollapsed(saved === 'true')
      } else {
        // Default based on screen size
        setRailCollapsed(isNarrow)
      }
      setIsInitialized(true)
    }
  }, [])

  // Auto-collapse on narrow screens (but respect manual toggle)
  useEffect(() => {
    if (isInitialized && isNarrow) {
      setRailCollapsed(true)
      localStorage.setItem(RAIL_STORAGE_KEY, 'true')
    }
  }, [isNarrow, isInitialized])

  // Handle rail toggle with local storage persistence
  const handleRailToggle = useCallback(() => {
    setRailCollapsed((prev) => {
      const newState = !prev
      localStorage.setItem(RAIL_STORAGE_KEY, String(newState))
      return newState
    })
  }, [])

  // Determine drawer width based on layout mode
  const effectiveDrawerWidth = resolved === 'vertical' ? 'full' : drawerWidth

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden bg-bg-0',
        // Vertical layout: stack elements differently
        resolved === 'vertical' && 'flex-col sm:flex-row'
      )}
    >
      {/* Left Rail - hidden on mobile, shown as overlay */}
      <div className={cn(
        'shrink-0',
        isMobile && 'hidden' // On mobile, rail is hidden (could add hamburger menu later)
      )}>
        <RailNav collapsed={railCollapsed} onToggle={handleRailToggle} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <TopBar
          title={title}
          breadcrumbs={breadcrumbs}
          onChipClick={onChipClick}
          onSearchClick={onSearchClick}
        />

        {/* Content + Drawer Container */}
        <div className={cn(
          'flex-1 flex overflow-hidden',
          // Vertical layout: drawer goes full width
          resolved === 'vertical' && 'flex-col'
        )}>
          {/* Main Content */}
          <main className={cn(
            'flex-1 overflow-y-auto min-w-0',
            // Responsive padding
            'p-3 sm:p-4',
            // Prevent content from being too wide
            resolved === 'horizontal' && 'max-w-full'
          )}>
            {children}
          </main>

          {/* Right Drawer */}
          {drawer && onDrawerClose && (
            <RightDrawer
              open={drawerOpen}
              onClose={onDrawerClose}
              title={drawerTitle}
              description={drawerDescription}
              width={effectiveDrawerWidth}
            >
              {drawer}
            </RightDrawer>
          )}
        </div>
      </div>
    </div>
  )
}
