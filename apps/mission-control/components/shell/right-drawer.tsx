'use client'

import { useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface RightDrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  width?: 'default' | 'lg' | 'full'
  className?: string
}

export function RightDrawer({
  open,
  onClose,
  title,
  description,
  children,
  width = 'default',
  className,
}: RightDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)

  // Close on escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    },
    [open, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prevent body scroll when open on mobile
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Focus trap - focus the drawer when it opens
  useEffect(() => {
    if (open && drawerRef.current) {
      drawerRef.current.focus()
    }
  }, [open])

  const widthClasses = {
    default: 'sm:w-[var(--drawer-width)]',
    lg: 'sm:w-[var(--drawer-width-lg)]',
    full: 'sm:w-full',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-bg-0/80 backdrop-blur-sm z-40 transition-opacity',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
          // Hide backdrop on desktop when drawer is side-panel
          'sm:bg-transparent sm:backdrop-blur-none sm:pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={cn(
          'fixed z-50 flex flex-col bg-bg-1 border-bd-0',
          'transition-transform duration-200 ease-out',
          // Mobile: bottom sheet (full width, slides up from bottom)
          'inset-x-0 bottom-0 max-h-[85vh] rounded-t-[var(--radius-lg)] border-t',
          open ? 'translate-y-0' : 'translate-y-full',
          // Desktop: right panel (slides in from right)
          'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-full sm:rounded-none sm:border-t-0 sm:border-l',
          widthClasses[width],
          open ? 'sm:translate-x-0 sm:translate-y-0' : 'sm:translate-x-full sm:translate-y-0',
          // On larger screens, position relative within the shell
          'sm:relative sm:z-0 sm:transition-none',
          !open && 'sm:hidden',
          className
        )}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center py-2 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-bg-3" />
        </div>

        {/* Header */}
        {(title || description) && (
          <header className="flex items-start justify-between gap-4 px-4 py-3 border-b border-bd-0 sm:p-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 className="text-sm font-semibold text-fg-0 truncate">{title}</h2>
              )}
              {description && (
                <p className="text-xs text-fg-2 mt-0.5 truncate">{description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[var(--radius-sm)] text-fg-2 hover:text-fg-0 hover:bg-bg-3 transition-colors shrink-0"
              aria-label="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </header>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </aside>
    </>
  )
}

// Drawer with tabs
interface DrawerTab {
  id: string
  label: string
  content: React.ReactNode
}

interface TabbedDrawerProps extends Omit<RightDrawerProps, 'children'> {
  tabs: DrawerTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
}

export function TabbedDrawer({
  tabs,
  activeTab,
  onTabChange,
  ...props
}: TabbedDrawerProps) {
  const activeContent = tabs.find((t) => t.id === activeTab)?.content

  return (
    <RightDrawer {...props}>
      {/* Tab bar */}
      <div className="flex border-b border-bd-0 px-4 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition-colors relative whitespace-nowrap',
              activeTab === tab.id
                ? 'text-fg-0'
                : 'text-fg-2 hover:text-fg-1'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-status-info" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">{activeContent}</div>
    </RightDrawer>
  )
}
