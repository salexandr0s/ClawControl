'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import {
  WorkOrderStatePill,
  PriorityPill,
} from '@/components/ui/status-pill'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { MetricCard } from '@/components/ui/metric-card'
import { useGatewayStatus } from '@/lib/hooks/useGatewayStatus'
import { cn } from '@/lib/utils'
import { timedClientFetch, usePageReadyTiming } from '@/lib/perf/client-timing'
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
  RefreshCw,
  ChevronDown,
  ChevronUp,
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
  requested_at: string
}

interface ActivityEvent {
  id: string
  type: string
  entityType: string
  entityId: string
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

interface GatewaySummary {
  status: 'ok' | 'degraded' | 'unavailable'
  latencyMs: number
  error?: string
}

interface DashboardProps {
  workOrders: WorkOrder[]
  approvals: PendingApproval[]
  activities: ActivityEvent[]
  stats: DashboardStats
  initialGateway: GatewaySummary
}

interface UsageSummaryApi {
  data: {
    totals: {
      inputTokens: string
      outputTokens: string
      cacheReadTokens: string
      cacheWriteTokens: string
      totalTokens: string
      totalCostMicros: string
      cacheEfficiencyPct: number
    }
    series: Array<{
      bucketStart: string
      totalTokens: string
      totalCostMicros: string
    }>
  }
}

interface UsageBreakdownApi {
  data: {
    groups: Array<{
      key: string
      totalCostMicros: string
      totalTokens: string
    }>
  }
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
    key: 'requested_at',
    header: 'Age',
    width: '70px',
    align: 'right',
    render: (row) => <span className="text-fg-2 text-xs">{row.requested_at}</span>,
  },
]

// ============================================================================
// DASHBOARD
// ============================================================================

export function Dashboard({
  workOrders,
  approvals,
  activities,
  stats,
  initialGateway,
}: DashboardProps) {
  usePageReadyTiming('dashboard', true)

  const [selectedWorkOrder, setSelectedWorkOrder] = useState<string | undefined>()
  const gatewayStatus = useGatewayStatus({
    initialStatus: initialGateway.status,
    initialLatencyMs: initialGateway.latencyMs,
    initialError: initialGateway.error ?? null,
  })

  const resolvedGatewayStatus = gatewayStatus.loading ? initialGateway.status : gatewayStatus.status
  const resolvedGatewayLatencyMs =
    gatewayStatus.loading
      ? initialGateway.latencyMs
      : gatewayStatus.latencyMs ?? initialGateway.latencyMs

  const gatewayValue =
    resolvedGatewayStatus === 'ok'
      ? 'Live'
      : resolvedGatewayStatus === 'degraded'
        ? 'Degraded'
        : 'Offline'

  const gatewayTone =
    resolvedGatewayStatus === 'ok'
      ? 'success'
      : resolvedGatewayStatus === 'degraded'
      ? 'warning'
      : 'danger'

  const [usageSummary, setUsageSummary] = useState<UsageSummaryApi['data'] | null>(null)
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownApi['data'] | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageSyncing, setUsageSyncing] = useState(false)
  const [showDailyTable, setShowDailyTable] = useState(false)

  useEffect(() => {
    const loadUsage = async () => {
      setUsageLoading(true)
      try {
        const [summaryRes, breakdownRes] = await Promise.all([
          timedClientFetch('/api/openclaw/usage/summary?range=daily', undefined, {
            page: 'dashboard',
            name: 'usage.summary',
          }),
          timedClientFetch('/api/openclaw/usage/breakdown?groupBy=model', undefined, {
            page: 'dashboard',
            name: 'usage.breakdown.model',
          }),
        ])

        if (summaryRes.ok) {
          const summaryJson = (await summaryRes.json()) as UsageSummaryApi
          setUsageSummary(summaryJson.data)
        }

        if (breakdownRes.ok) {
          const breakdownJson = (await breakdownRes.json()) as UsageBreakdownApi
          setUsageBreakdown(breakdownJson.data)
        }
      } finally {
        setUsageLoading(false)
      }
    }

    void loadUsage()
  }, [])

  useEffect(() => {
    const warmSync = async () => {
      try {
        await timedClientFetch('/api/openclaw/usage/sync', { method: 'POST' }, {
          page: 'dashboard',
          name: 'usage.sync',
        })
        const [summaryRes, breakdownRes] = await Promise.all([
          timedClientFetch('/api/openclaw/usage/summary?range=daily', undefined, {
            page: 'dashboard',
            name: 'usage.summary.warm',
          }),
          timedClientFetch('/api/openclaw/usage/breakdown?groupBy=model', undefined, {
            page: 'dashboard',
            name: 'usage.breakdown.model.warm',
          }),
        ])
        if (summaryRes.ok) {
          const summaryJson = (await summaryRes.json()) as UsageSummaryApi
          setUsageSummary(summaryJson.data)
        }
        if (breakdownRes.ok) {
          const breakdownJson = (await breakdownRes.json()) as UsageBreakdownApi
          setUsageBreakdown(breakdownJson.data)
        }
      } catch {
        // Keep dashboard responsive even when sync is unavailable.
      }
    }
    void warmSync()
  }, [])

  const handleSyncUsage = async () => {
    setUsageSyncing(true)
    try {
      await timedClientFetch('/api/openclaw/usage/sync', { method: 'POST' }, {
        page: 'dashboard',
        name: 'usage.sync.manual',
      })

      const [summaryRes, breakdownRes] = await Promise.all([
        timedClientFetch('/api/openclaw/usage/summary?range=daily', undefined, {
          page: 'dashboard',
          name: 'usage.summary.manual',
        }),
        timedClientFetch('/api/openclaw/usage/breakdown?groupBy=model', undefined, {
          page: 'dashboard',
          name: 'usage.breakdown.model.manual',
        }),
      ])

      if (summaryRes.ok) {
        const summaryJson = (await summaryRes.json()) as UsageSummaryApi
        setUsageSummary(summaryJson.data)
      }

      if (breakdownRes.ok) {
        const breakdownJson = (await breakdownRes.json()) as UsageBreakdownApi
        setUsageBreakdown(breakdownJson.data)
      }
    } finally {
      setUsageSyncing(false)
    }
  }

  const usageSeries = useMemo(
    () => (usageSummary?.series ?? []).slice(-14),
    [usageSummary?.series]
  )

  const dailyRows = useMemo(
    () => usageSeries.slice(-7).reverse(),
    [usageSeries]
  )

  const maxSeriesValue = usageSeries.reduce((max, point) => {
    const value = Number(point.totalTokens)
    return Number.isFinite(value) && value > max ? value : max
  }, 0)

  return (
    <div className="flex flex-col gap-6 w-full">
      {stats.totalAgents === 0 && (
        <div className="flex items-start gap-3 p-4 rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-bg-3 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-status-info" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg-0">Connect to OpenClaw to see your agents</div>
            <div className="text-xs text-fg-2 mt-1">
              Gateway status: {gatewayValue}
              {resolvedGatewayStatus !== 'unavailable' && resolvedGatewayLatencyMs !== null ? ` (${resolvedGatewayLatencyMs}ms)` : ''}
            </div>
          </div>
        </div>
      )}

      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Gateway" value={gatewayValue} icon={Activity} tone={gatewayTone} />
        <MetricCard label="Active WOs" value={stats.activeWorkOrders} icon={PlayCircle} tone="progress" />
        <MetricCard
          label="Blocked"
          value={stats.blockedWorkOrders}
          icon={AlertTriangle}
          tone={stats.blockedWorkOrders > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Approvals"
          value={stats.pendingApprovals}
          icon={Clock}
          tone={stats.pendingApprovals > 0 ? 'info' : 'success'}
        />
        <MetricCard label="Agents" value={`${stats.activeAgents}/${stats.totalAgents}`} icon={Bot} tone="success" />
        <MetricCard label="Completed" value={stats.completedToday} icon={CheckCircle} tone="muted" />
      </div>

      <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden order-last">
        <div className="px-4 py-3 border-b border-bd-0 flex items-center justify-between">
          <h2 className="terminal-header">Usage + Cost</h2>
          <button
            onClick={handleSyncUsage}
            disabled={usageSyncing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-bg-3 text-fg-1 hover:bg-bg-1 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', usageSyncing && 'animate-spin')} />
            Sync Usage
          </button>
        </div>

        <div className="p-4">
          {usageLoading ? (
            <div className="text-sm text-fg-2">Loading usage metrics…</div>
          ) : usageSummary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniMetric
                  label="Total Tokens"
                  value={formatCompactNumber(usageSummary.totals.totalTokens)}
                />
                <MiniMetric
                  label="Total Cost"
                  value={formatUsdFromMicros(usageSummary.totals.totalCostMicros)}
                />
                <MiniMetric
                  label="Cache Efficiency"
                  value={`${usageSummary.totals.cacheEfficiencyPct.toFixed(2)}%`}
                />
                <MiniMetric
                  label="Cache Read"
                  value={formatCompactNumber(usageSummary.totals.cacheReadTokens)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-fg-2">Daily usage (tokens)</div>
                  <button
                    onClick={() => setShowDailyTable((prev) => !prev)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-bd-0 bg-bg-3 text-fg-2 hover:text-fg-1"
                  >
                    {showDailyTable ? (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        Hide table
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        Show table
                      </>
                    )}
                  </button>
                </div>
                {usageSeries.length === 0 ? (
                  <div className="text-xs text-fg-3">No usage data yet.</div>
                ) : (
                  <div className="space-y-2">
                    <div className="h-28 flex items-end gap-1.5 p-2 rounded border border-bd-0 bg-bg-3/70">
                      {usageSeries.map((point) => {
                        const value = Number(point.totalTokens)
                        const heightPct =
                          maxSeriesValue > 0 && Number.isFinite(value)
                            ? Math.max(8, (value / maxSeriesValue) * 100)
                            : 8
                        return (
                          <div
                            key={point.bucketStart}
                            className="relative h-full flex-1 flex items-end group/bar"
                          >
                            <div
                              className="w-full bg-status-info rounded-sm hover:opacity-90 transition-opacity"
                              style={{ height: `${heightPct}%` }}
                            />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 hidden group-hover/bar:block pointer-events-none">
                              <div className="rounded border border-bd-0 bg-bg-2 px-2 py-1 shadow-lg min-w-[140px]">
                                <div className="text-[10px] text-fg-2">
                                  {new Date(point.bucketStart).toLocaleDateString()}
                                </div>
                                <div className="text-[11px] text-fg-1 font-mono">
                                  Tokens: {formatCompactNumber(point.totalTokens)}
                                </div>
                                <div className="text-[11px] text-fg-1 font-mono">
                                  Cost: {formatUsdFromMicros(point.totalCostMicros)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {showDailyTable && (
                      <div className="rounded border border-bd-0 overflow-hidden">
                        <div className="grid grid-cols-[120px_1fr_120px] px-3 py-1.5 text-[11px] text-fg-2 bg-bg-3 border-b border-bd-0">
                          <span>Date</span>
                          <span>Tokens</span>
                          <span className="text-right">Cost</span>
                        </div>
                        <div className="divide-y divide-bd-0">
                          {dailyRows.map((row) => (
                            <div key={`day-${row.bucketStart}`} className="grid grid-cols-[120px_1fr_120px] px-3 py-1.5 text-xs">
                              <span className="text-fg-2">{new Date(row.bucketStart).toLocaleDateString()}</span>
                              <span className="text-fg-1 font-mono">{formatCompactNumber(row.totalTokens)}</span>
                              <span className="text-fg-2 font-mono text-right">{formatUsdFromMicros(row.totalCostMicros)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-fg-2 mb-2">By model cost split</div>
                {usageBreakdown && usageBreakdown.groups.length > 0 ? (
                  <div className="space-y-1">
                    {usageBreakdown.groups.slice(0, 5).map((group) => (
                      <div key={group.key} className="flex items-center justify-between text-xs">
                        <span className="text-fg-1 truncate max-w-[260px]">{group.key}</span>
                        <span className="font-mono text-fg-2">{formatUsdFromMicros(group.totalCostMicros)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-fg-3">No model-level usage data yet.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-fg-2">Usage metrics unavailable.</div>
          )}
        </div>
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
            {activities.length === 0 ? (
              <div className="text-center py-8 text-fg-2">
                <p>No activity yet</p>
                <p className="text-sm mt-1">Activity will appear here as work orders run.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {activities.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function formatCompactNumber(value: string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(parsed)
}

function formatUsdFromMicros(micros: string): string {
  const parsed = Number(micros) / 1_000_000
  if (!Number.isFinite(parsed)) return '$0.00'
  return `$${parsed.toFixed(parsed >= 10 ? 2 : 4)}`
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded border border-bd-0 bg-bg-3">
      <div className="text-[11px] text-fg-2">{label}</div>
      <div className="text-sm text-fg-0 font-medium mt-0.5">{value}</div>
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

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
    <div className={cn("bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden relative", className)}>
      {/* Left accent bar for attention */}
      {accent && (
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-status-warning" />
      )}
      <div className={cn(
        "flex items-center justify-between px-4 py-3 border-b border-bd-0",
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
  const router = useRouter()

  const typeIconMap = {
    work_order: FileText,
    operation: Settings,
    agent: Bot,
    system: Wrench,
    gateway: Globe,
    cron: CalendarClock,
    approval: CheckSquare,
  }

  const iconType = event.entityType || event.type
  const Icon = typeIconMap[iconType as keyof typeof typeIconMap] ?? LayoutDashboard
  const href = getActivityHref(event)

  const onActivate = () => {
    if (!href) return
    router.push(href as Route)
  }

  return (
    <div
      role={href ? 'button' : undefined}
      tabIndex={href ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (!href) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      className={cn(
        'flex items-center gap-3 px-4 py-2 transition-colors',
        href ? 'cursor-pointer hover:bg-bg-3/50 focus:outline-none focus:bg-bg-3/50' : 'hover:bg-bg-3/50'
      )}
    >
      <Icon className="w-3.5 h-3.5 text-fg-2 shrink-0" />
      <span className="flex-1 text-[13px] text-fg-1 truncate">{event.message}</span>
      {event.agent && (
        <span className="font-mono text-xs text-status-progress">{event.agent}</span>
      )}
      <span className="text-xs text-fg-2 shrink-0 tabular-nums">{event.timestamp}</span>
    </div>
  )
}

function getActivityHref(event: ActivityEvent): string | null {
  if (!event.entityId) return null

  if (event.entityType === 'work_order') {
    return `/work-orders/${event.entityId}`
  }
  if (event.entityType === 'operation') {
    return `/work-orders?operation=${encodeURIComponent(event.entityId)}`
  }
  if (event.entityType === 'agent') {
    return `/agents?agentId=${encodeURIComponent(event.entityId)}`
  }
  if (event.entityType === 'approval') {
    return `/approvals?approvalId=${encodeURIComponent(event.entityId)}`
  }

  return null
}
