import { Suspense } from 'react'
import { enableWalMode } from '@/lib/db'
import {
  getWorkOrdersWithOps,
  getPendingApprovals,
  getRecentActivities,
  getDashboardStats,
  getGatewayStatus,
} from '@/lib/data'
import { NowDashboard } from './now-dashboard'

// Enable WAL mode on first request
let walEnabled = false

export default async function NowPage() {
  // Enable WAL mode on first request
  if (!walEnabled) {
    await enableWalMode()
    walEnabled = true
  }

  // Fetch all data through the facade
  const [
    workOrders,
    approvals,
    activities,
    stats,
    gateway,
  ] = await Promise.all([
    getWorkOrdersWithOps(),
    getPendingApprovals(),
    getRecentActivities(8),
    getDashboardStats(),
    getGatewayStatus(),
  ])

  // Transform work orders for display
  const transformedWorkOrders = workOrders.slice(0, 10).map((wo) => ({
    id: wo.code,
    title: wo.title,
    state: wo.state,
    priority: wo.priority,
    ops_total: wo.operations.length,
    ops_done: wo.operations.filter((op) => op.status === 'done').length,
    updated_at: formatRelativeTime(wo.updatedAt),
  }))

  // Transform approvals for display
  const transformedApprovals = approvals.slice(0, 5).map((apr) => ({
    id: apr.id,
    type: apr.type,
    title: apr.questionMd.slice(0, 50) + (apr.questionMd.length > 50 ? '...' : ''),
    work_order_id: apr.workOrderId,
    requested_at: formatRelativeTime(apr.createdAt),
  }))

  // Transform activities for display
  const transformedActivities = activities.map((act) => ({
    id: act.id,
    type: act.entityType as 'work_order' | 'operation' | 'agent' | 'system',
    message: act.summary,
    timestamp: formatRelativeTime(act.ts),
    agent: act.actor.startsWith('agent:') ? act.actor.replace('agent:', '') : undefined,
  }))

  return (
    <Suspense fallback={<div className="animate-pulse">Loading...</div>}>
      <NowDashboard
        workOrders={transformedWorkOrders}
        approvals={transformedApprovals}
        activities={transformedActivities}
        stats={stats}
        gateway={{
          status: gateway.status,
          latencyMs: gateway.latencyMs,
          error: gateway.error ?? undefined,
        }}
      />
    </Suspense>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (hours < 24) return `${hours} hr ago`
  return `${Math.floor(hours / 24)} days ago`
}
