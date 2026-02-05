'use client'

import { cn } from '@/lib/utils'
import { Modal, type ModalWidth } from '@/components/ui/modal'

interface RightDrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  width?: ModalWidth
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width}
      contentClassName={cn('bg-bg-1', className)}
    >
      {children}
    </Modal>
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
      {/* Tab bar - negative margin to extend to drawer edges */}
      <div className="flex border-b border-bd-0 -mx-4 px-4 overflow-x-auto scrollbar-hide">
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

      {/* Content - no extra padding since drawer already provides it */}
      <div className="pt-4">{activeContent}</div>
    </RightDrawer>
  )
}
