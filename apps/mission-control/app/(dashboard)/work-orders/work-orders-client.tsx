'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, EmptyState } from '@savorgos/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { WorkOrderStatePill, PriorityPill } from '@/components/ui/status-pill'
import { workOrdersApi } from '@/lib/http'
import type { WorkOrderWithOpsDTO } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { ClipboardList, Plus, Filter, Loader2, ChevronRight } from 'lucide-react'

const workOrderColumns: Column<WorkOrderWithOpsDTO>[] = [
  {
    key: 'code',
    header: 'Code',
    width: '80px',
    mono: true,
    render: (row) => (
      <span className="text-fg-1 hover:text-fg-0">{row.code}</span>
    ),
  },
  {
    key: 'title',
    header: 'Title',
    render: (row) => (
      <span className="truncate max-w-[320px] inline-block">{row.title}</span>
    ),
  },
  {
    key: 'state',
    header: 'State',
    width: '100px',
    render: (row) => <WorkOrderStatePill state={row.state} />,
  },
  {
    key: 'priority',
    header: 'Pri',
    width: '60px',
    align: 'center',
    render: (row) => <PriorityPill priority={row.priority} />,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: '100px',
    render: (row) => (
      <span className={cn(
        'text-xs',
        row.owner === 'savorgceo' ? 'text-status-progress' : 'text-fg-1'
      )}>
        {row.owner === 'savorgceo' ? 'savorgCEO' : 'User'}
      </span>
    ),
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => (
      <span className="text-fg-2 text-xs">{formatRelativeTime(row.updatedAt)}</span>
    ),
  },
]

export function WorkOrdersClient() {
  const router = useRouter()
  const [workOrders, setWorkOrders] = useState<WorkOrderWithOpsDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch work orders on mount
  useEffect(() => {
    async function fetchData() {
      try {
        const result = await workOrdersApi.list()
        setWorkOrders(result.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load work orders')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={<ClipboardList className="w-8 h-8" />}
        title="Error loading work orders"
        description={error}
      />
    )
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Work Orders"
        subtitle={`${workOrders.length} total`}
        actions={
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:text-fg-0 border border-bd-0">
              <Filter className="w-3.5 h-3.5" />
              Filter
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90">
              <Plus className="w-3.5 h-3.5" />
              New Work Order
            </button>
          </div>
        }
      />

      <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
        <CanonicalTable
          columns={workOrderColumns}
          rows={workOrders}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/work-orders/${row.id}`)}
          density="compact"
          emptyState={
            <EmptyState
              icon={<ClipboardList className="w-8 h-8" />}
              title="No work orders"
              description="Create your first work order to get started"
            />
          }
        />
      </div>
    </div>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
