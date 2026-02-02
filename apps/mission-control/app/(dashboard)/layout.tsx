'use client'

import { AppShell } from '@/components/shell/app-shell'
import { SearchModal, useSearchModal } from '@/components/shell/search-modal'
import { ProtectedActionProvider } from '@/components/protected-action-modal'

/**
 * Dashboard Layout
 *
 * Wraps all main application routes with the AppShell.
 * Includes global search modal with Cmd/Ctrl+K shortcut.
 * Provides protected action modal for Governor-enforced confirmations.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const search = useSearchModal()

  return (
    <ProtectedActionProvider>
      <AppShell onSearchClick={search.onOpen}>
        {children}
      </AppShell>
      <SearchModal open={search.open} onClose={search.onClose} />
    </ProtectedActionProvider>
  )
}
