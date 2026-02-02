'use client'

import { useState } from 'react'
import {
  WorkOrderStatePill,
  PriorityPill,
} from '@/components/ui/status-pill'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { cn } from '@/lib/utils'
import {
  Activity,
  Bot,
  Clock,
  AlertTriangle,
  CheckCircle,
  PlayCircle,
  FileText,
  Settings,
  Wrench,
  Globe,
  CalendarClock,
  CheckSquare,
  LayoutDashboard,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface WorkOrder {
  id: string
  title: string
  state: string
  priority: string
  ops_total: number
  ops_done: number
  updated_at: string
}

interface PendingApproval {
  id: string
  type: string
  title: string
  work_order_id: string
  agent: string
  requested_at: string
}

interface ActivityEvent {
  id: string
  type: 'work_order' | 'operation' | 'agent' | 'system'
  message: string
  timestamp: string
  agent?: string
}

interface DashboardStats {
  activeWorkOrders: number
  blockedWorkOrders: number
  pendingApprovals: number
  activeAgents: number
  totalAgents: number
  completedToday: number
}

interface NowDashboardProps {
  workOrders: WorkOrder[]
  approvals: PendingApproval[]
  activities: ActivityEvent[]
  stats: DashboardStats
}

// ============================================================================
// COLUMNS
// ============================================================================

const workOrderColumns: Column<WorkOrder>[] = [
  {
    key: 'id',
    header: <span className="terminal-header">ID</span>,
    width: '80px',
    mono: true,
    render: (row) => (
      <span className="font-mono text-xs text-fg-1 hover:text-fg-0 cursor-pointer">{row.id}</span>
    ),
  },
  {
    key: 'title',
    header: <span className="terminal-header">Title</span>,
    render: (row) => <span className="truncate max-w-[280px] inline-block">{row.title}</span>,
  },
  {
    key: 'state',
    header: <span className="terminal-header">State</span>,
    width: '100px',
    render: (row) => <WorkOrderStatePill state={row.state} />,
  },
  {
    key: 'priority',
    header: <span className="terminal-header">Pri</span>,
    width: '60px',
    align: 'center',
    render: (row) => <PriorityPill priority={row.priority} />,
  },
  {
    key: 'progress',
    header: <span className="terminal-header">Ops</span>,
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => (
      <span className={cn("font-mono text-xs", row.ops_done === row.ops_total ? 'text-status-success' : 'text-fg-1')}>
        {row.ops_done}/{row.ops_total}
      </span>
    ),
  },
  {
    key: 'updated_at',
    header: <span className="terminal-header">Age</span>,
    width: '70px',
    align: 'right',
    render: (row) => <span className="text-fg-2 text-xs tabular-nums">{row.updated_at}</span>,
  },
]

const approvalColumns: Column<PendingApproval>[] = [
  {
    key: 'type',
    header: '',
    width: '40px',
    align: 'center',
    render: (row) => {
      const Icon = row.type === 'ship_gate' ? CheckCircle : row.type === 'risky_action' ? AlertTriangle : FileText
      const colorClass = row.type === 'ship_gate' ? 'text-status-success' : row.type === 'risky_action' ? 'text-status-warning' : 'text-fg-2'
      return <Icon className={cn("w-3.5 h-3.5", colorClass)} />
    },
  },
  {
    key: 'title',
    header: 'Request',
    render: (row) => <span className="truncate max-w-[180px] inline-block text-[13px]">{row.title}</span>,
  },
  {
    key: 'agent',
    header: 'Agent',
    width: '90px',
    mono: true,
    render: (row) => <span className="text-status-progress">{row.agent}</span>,
  },
  {
    key: 'requested_at',
    header: 'Age',
    width: '70px',
    align: 'right',
    render: (row) => <span className="text-fg-2 text-xs">{row.requested_at}</span>,
  },
]

// ============================================================================
// NOW DASHBOARD
// ============================================================================

export function NowDashboard({
  workOrders,
  approvals,
  activities,
  stats,
}: NowDashboardProps) {
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<string | undefined>()

  return (
    <div className="space-y-6 w-full">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          label="Gateway"
          value="OK"
          icon={Activity}
          status="success"
        />
        <StatCard
          label="Active WOs"
          value={stats.activeWorkOrders}
          icon={PlayCircle}
          status="progress"
        />
        <StatCard
          label="Blocked"
          value={stats.blockedWorkOrders}
          icon={AlertTriangle}
          status={stats.blockedWorkOrders > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Approvals"
          value={stats.pendingApprovals}
          icon={Clock}
          status={stats.pendingApprovals > 0 ? 'info' : 'success'}
        />
        <StatCard
          label="Agents"
          value={`${stats.activeAgents}/${stats.totalAgents}`}
          icon={Bot}
          status="success"
        />
        <StatCard
          label="Completed"
          value={stats.completedToday}
          icon={CheckCircle}
          status="muted"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-4 items-stretch">
        {/* Active Work Orders */}
        <div className="col-span-12 lg:col-span-8 flex">
          <Card title="Active Work Orders" count={workOrders.length} className="flex-1 flex flex-col">
            <div className="flex-1">
              <CanonicalTable
                columns={workOrderColumns}
                rows={workOrders}
                rowKey={(row) => row.id}
                onRowClick={(row) => setSelectedWorkOrder(row.id)}
                selectedKey={selectedWorkOrder}
                density="compact"
                emptyState="No active work orders"
              />
            </div>
          </Card>
        </div>

        {/* Pending Approvals */}
        <div className="col-span-12 lg:col-span-4 flex">
          <Card
            title="Pending Approvals"
            count={approvals.length}
            accent={approvals.length > 0}
            className="flex-1 flex flex-col"
          >
            <div className="flex-1">
              <CanonicalTable
                columns={approvalColumns}
                rows={approvals}
                rowKey={(row) => row.id}
                density="compact"
                emptyState="No pending approvals"
              />
            </div>
          </Card>
        </div>

        {/* Activity Feed */}
        <div className="col-span-12">
          <Card title="Recent Activity">
            <div className="space-y-1">
              {activities.map((event) => (
                <ActivityRow key={event.id} event={event} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function StatCard({
  label,
  value,
  icon: Icon,
  status,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  status: 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'muted'
}) {
  const statusColors = {
    success: 'text-status-success',
    warning: 'text-status-warning',
    danger: 'text-status-danger',
    info: 'text-status-info',
    progress: 'text-status-progress',
    muted: 'text-fg-2',
  }

  return (
    <div className="bg-bg-2 rounded-[var(--radius-md)] border border-white/[0.06] p-3 flex flex-col items-center justify-center text-center h-[72px]">
      <Icon className={cn('w-[18px] h-[18px] mb-1.5', statusColors[status])} />
      <div className={cn('font-mono text-sm font-semibold leading-none', statusColors[status])}>
        {value}
      </div>
      <div className="text-[11px] text-fg-2 mt-1 uppercase tracking-wide">{label}</div>
    </div>
  )
}

function Card({
  title,
  count,
  accent,
  children,
  className,
}: {
  title: string
  count?: number
  accent?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden relative", className)}>
      {/* Left accent bar for attention */}
      {accent && (
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-status-warning" />
      )}
      <div className={cn(
        "flex items-center justify-between px-4 py-3 border-b border-white/[0.06]",
        accent && "pl-[18px]"
      )}>
        <h2 className="terminal-header">{title}</h2>
        {count !== undefined && (
          <span className={cn(
            'font-mono text-xs px-1.5 py-0.5 rounded-sm bg-bg-3',
            accent ? 'text-status-warning' : 'text-fg-1'
          )}>
            {count}
          </span>
        )}
      </div>
      <div className={cn("p-0", accent && "pl-[2px]")}>{children}</div>
    </div>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const typeIconMap = {
    work_order: FileText,
    operation: Settings,
    agent: Bot,
    system: Wrench,
    gateway: Globe,
    cron: CalendarClock,
    approval: CheckSquare,
  }

  const Icon = typeIconMap[event.type] ?? LayoutDashboard

  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-bg-3/50 transition-colors">
      <Icon className="w-3.5 h-3.5 text-fg-2 shrink-0" />
      <span className="flex-1 text-[13px] text-fg-1 truncate">{event.message}</span>
      {event.agent && (
        <span className="font-mono text-xs text-status-progress">{event.agent}</span>
      )}
      <span className="text-xs text-fg-2 shrink-0 tabular-nums">{event.timestamp}</span>
    </div>
  )
}
