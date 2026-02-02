'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PageHeader, EmptyState } from '@savorgos/ui'
import { activitiesApi } from '@/lib/http'
import { useSseStream, type SseConnectionState } from '@/lib/hooks/useSseStream'
import type { ActivityDTO } from '@/lib/repo'
import { cn } from '@/lib/utils'
import {
  Activity as ActivityIcon,
  Play,
  Pause,
  RefreshCw,
  ClipboardList,
  Bot,
  Settings,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
  AlertCircle,
} from 'lucide-react'

type ActivityType = 'all' | 'work_order' | 'operation' | 'agent' | 'system' | 'approval'

export function LiveClient() {
  const [activities, setActivities] = useState<ActivityDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ActivityType>('all')
  const [tailMode, setTailMode] = useState(true)
  const timelineRef = useRef<HTMLDivElement>(null)

  // Fetch initial activities
  useEffect(() => {
    async function fetchData() {
      try {
        const result = await activitiesApi.list({ limit: 100 })
        setActivities(result.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load activities')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Handle new activity from SSE
  const handleNewActivity = useCallback((activity: ActivityDTO) => {
    setActivities((prev) => {
      // Avoid duplicates
      if (prev.some((a) => a.id === activity.id)) return prev
      // Add to front (newest first)
      return [activity, ...prev].slice(0, 200) // Keep max 200 items
    })
  }, [])

  // SSE connection
  const { connectionState, reconnect } = useSseStream({
    onActivity: handleNewActivity,
  })

  // Auto-scroll when in tail mode and new activities arrive
  useEffect(() => {
    if (tailMode && timelineRef.current) {
      timelineRef.current.scrollTop = 0
    }
  }, [activities, tailMode])

  const filteredActivities =
    filter === 'all'
      ? activities
      : activities.filter((a) => a.type.startsWith(filter))

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
        icon={<ActivityIcon className="w-8 h-8" />}
        title="Error loading activities"
        description={error}
      />
    )
  }

  const typeIcons: Record<string, typeof ClipboardList> = {
    work_order: ClipboardList,
    operation: Settings,
    agent: Bot,
    system: RefreshCw,
    approval: Clock,
    cron: RefreshCw,
    gateway: ActivityIcon,
    receipt: ActivityIcon,
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Live Activity"
        subtitle="Real-time event stream"
        actions={
          <div className="flex items-center gap-2">
            {/* Filter */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as ActivityType)}
              className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 border border-bd-0 focus:outline-none focus:border-bd-1"
            >
              <option value="all">All events</option>
              <option value="work_order">Work Orders</option>
              <option value="operation">Operations</option>
              <option value="approval">Approvals</option>
              <option value="agent">Agents</option>
              <option value="system">System</option>
            </select>

            {/* Tail Mode Toggle */}
            <button
              onClick={() => setTailMode(!tailMode)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                tailMode
                  ? 'bg-status-progress/10 text-status-progress border-status-progress/30'
                  : 'bg-bg-3 text-fg-2 border-bd-0 hover:border-bd-1'
              )}
            >
              {tailMode ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Tail
            </button>
          </div>
        }
      />

      {/* Connection Status */}
      <ConnectionStatus state={connectionState} onReconnect={reconnect} />

      {/* Activity Timeline */}
      <div
        ref={timelineRef}
        className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden max-h-[calc(100vh-280px)] overflow-y-auto"
      >
        {filteredActivities.length > 0 ? (
          <div className="divide-y divide-bd-0/50">
            {filteredActivities.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                typeIcons={typeIcons}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ActivityIcon className="w-8 h-8" />}
            title="No activity"
            description="Events will appear here as they happen"
          />
        )}
      </div>
    </div>
  )
}

function ConnectionStatus({
  state,
  onReconnect,
}: {
  state: SseConnectionState
  onReconnect: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border',
        state === 'connected' && 'bg-status-success/5 border-status-success/30',
        state === 'connecting' && 'bg-status-warning/5 border-status-warning/30',
        state === 'disconnected' && 'bg-bg-2 border-bd-0',
        state === 'error' && 'bg-status-error/5 border-status-error/30'
      )}
    >
      {state === 'connected' && (
        <>
          <Wifi className="w-3.5 h-3.5 text-status-success" />
          <span className="text-xs text-status-success">Connected — streaming live updates</span>
        </>
      )}
      {state === 'connecting' && (
        <>
          <Loader2 className="w-3.5 h-3.5 text-status-warning animate-spin" />
          <span className="text-xs text-status-warning">Connecting...</span>
        </>
      )}
      {state === 'disconnected' && (
        <>
          <WifiOff className="w-3.5 h-3.5 text-fg-3" />
          <span className="text-xs text-fg-2">Disconnected</span>
          <button
            onClick={onReconnect}
            className="ml-2 text-xs text-status-progress hover:underline"
          >
            Reconnect
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-status-error" />
          <span className="text-xs text-status-error">Connection error</span>
          <button
            onClick={onReconnect}
            className="ml-2 text-xs text-status-progress hover:underline"
          >
            Retry
          </button>
        </>
      )}
    </div>
  )
}

function ActivityRow({
  activity,
  typeIcons,
}: {
  activity: ActivityDTO
  typeIcons: Record<string, typeof ClipboardList>
}) {
  const [expanded, setExpanded] = useState(false)
  const typeKey = activity.type.split('.')[0]
  const Icon = typeIcons[typeKey] || ActivityIcon

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 hover:bg-bg-3/30 transition-colors cursor-pointer',
        expanded && 'bg-bg-3/20'
      )}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Icon */}
      <div
        className={cn(
          'p-1.5 rounded-[var(--radius-sm)] shrink-0',
          typeKey === 'work_order' && 'bg-status-progress/10 text-status-progress',
          typeKey === 'operation' && 'bg-status-info/10 text-status-info',
          typeKey === 'agent' && 'bg-status-success/10 text-status-success',
          typeKey === 'approval' && 'bg-status-warning/10 text-status-warning',
          typeKey === 'system' && 'bg-fg-3/10 text-fg-2',
          typeKey === 'cron' && 'bg-fg-3/10 text-fg-2',
          typeKey === 'gateway' && 'bg-status-success/10 text-status-success',
          typeKey === 'receipt' && 'bg-status-info/10 text-status-info'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fg-0">{activity.summary}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-fg-2 font-mono">{activity.type}</span>
          {activity.actor !== 'system' && (
            <>
              <span className="text-fg-3">•</span>
              <span className="text-xs text-status-progress font-mono">
                {activity.actor.replace('agent:', '')}
              </span>
            </>
          )}
        </div>

        {/* Expanded details */}
        {expanded && Object.keys(activity.payloadJson).length > 0 && (
          <div className="mt-3 p-2 bg-bg-3/50 rounded-[var(--radius-sm)] text-xs font-mono text-fg-2 overflow-x-auto">
            <pre>{JSON.stringify(activity.payloadJson, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-xs text-fg-2 shrink-0 tabular-nums">
        {formatRelativeTime(activity.ts)}
      </span>
    </div>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}
