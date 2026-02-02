'use client'

import { cn } from '@/lib/utils'
import {
  ClipboardList,
  Settings,
  Terminal,
  Pin,
  PinOff,
  CheckCircle,
  XCircle,
  Circle,
  PlayCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import type { VisualizerNode, VisualizerEntityType, ExecutionState } from '../visualizer-store'
import type { StatusTone } from '@savorg/ui/theme'
import { statusToneClasses } from '@savorg/ui/theme'

interface EntityNodeProps {
  node: VisualizerNode
  onClick: () => void
  isSelected: boolean
  isHighlighted?: boolean
  onPin?: () => void
  onUnpin?: () => void
  onJumpToReceipt?: (receiptId: string) => void
  onJumpToOperation?: (operationId: string) => void
  onJumpToWorkOrder?: (workOrderId: string) => void
}

// Status tone mappings
const workOrderStateTone: Record<string, StatusTone> = {
  planned: 'idle',
  active: 'progress',
  blocked: 'danger',
  review: 'warning',
  shipped: 'success',
  cancelled: 'muted',
}

const operationStatusTone: Record<string, StatusTone> = {
  todo: 'idle',
  in_progress: 'progress',
  blocked: 'danger',
  review: 'warning',
  done: 'success',
  rework: 'warning',
}

// Execution state tones (used for future features)
const _executionStateTone: Record<ExecutionState, StatusTone> = {
  intent: 'idle',
  queued: 'warning',
  executing: 'progress',
  completed: 'success',
  failed: 'danger',
}

function getReceiptTone(node: VisualizerNode): StatusTone {
  if (node.isRunning) return 'progress'
  if (node.exitCode === 0) return 'success'
  if (node.exitCode !== null) return 'danger'
  return 'idle'
}

function getTone(node: VisualizerNode): StatusTone {
  if (node.entityType === 'work_order') {
    return workOrderStateTone[node.status] ?? 'muted'
  }
  if (node.entityType === 'operation') {
    return operationStatusTone[node.status] ?? 'muted'
  }
  return getReceiptTone(node)
}

// Entity type icons
const entityIcons: Record<VisualizerEntityType, typeof ClipboardList> = {
  work_order: ClipboardList,
  operation: Settings,
  receipt: Terminal,
}

// Status icons
const statusIcons: Record<StatusTone, typeof CheckCircle> = {
  success: CheckCircle,
  warning: AlertTriangle,
  danger: XCircle,
  info: Circle,
  progress: PlayCircle,
  idle: Circle,
  muted: Circle,
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)

  if (secs < 5) return 'now'
  if (secs < 60) return `${secs}s`
  if (mins < 60) return `${mins}m`
  return `${hours}h`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  return `${mins}m ${remSecs}s`
}

export function EntityNode({
  node,
  onClick,
  isSelected,
  isHighlighted,
  onPin,
  onUnpin,
  onJumpToReceipt,
  onJumpToOperation,
  onJumpToWorkOrder,
}: EntityNodeProps) {
  const tone = getTone(node)
  const toneClasses = statusToneClasses[tone]
  const EntityIcon = entityIcons[node.entityType]
  const StatusIcon = statusIcons[tone]
  const isRunning = node.entityType === 'receipt' && node.isRunning
  const isExecuting = node.executionState === 'executing'

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-[var(--radius-md)] border transition-all',
        'hover:bg-bg-3/50 focus:outline-none focus:ring-1 focus:ring-status-info/50',
        // Base states
        isSelected
          ? 'bg-bg-3 border-status-info/50'
          : 'bg-bg-2 border-white/[0.06] hover:border-bd-1',
        // Highlight animation (for correlation jumps)
        isHighlighted && 'ring-2 ring-status-warning animate-pulse',
        // Fading state (TTL approaching)
        node.isFading && 'opacity-50',
        // Reduced motion support
        'motion-reduce:animate-none'
      )}
    >
      {/* Top row: ID + Status + Time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Entity icon */}
          <div className={cn('p-1 rounded-[var(--radius-sm)]', toneClasses.bg)}>
            <EntityIcon className={cn('w-3 h-3', toneClasses.icon)} />
          </div>

          {/* Display ID */}
          <span className="font-mono text-xs font-medium text-fg-0 truncate">
            {node.displayId}
          </span>

          {/* Status indicator */}
          <div
            className={cn(
              'flex items-center gap-1',
              (isRunning || isExecuting) && 'motion-safe:animate-pulse-subtle'
            )}
          >
            {isRunning ? (
              <Loader2 className={cn('w-3 h-3 animate-spin', toneClasses.icon)} />
            ) : (
              <StatusIcon className={cn('w-3 h-3', toneClasses.icon)} />
            )}
          </div>
        </div>

        {/* Time + Pin */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-fg-2 tabular-nums">
            {formatRelativeTime(node.lastActivity)}
          </span>

          {/* Pin button */}
          {(onPin || onUnpin) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (node.isPinned) { onUnpin?.() } else { onPin?.() }
              }}
              className={cn(
                'p-0.5 rounded-[var(--radius-sm)] transition-colors',
                node.isPinned
                  ? 'text-status-warning hover:text-status-warning/70'
                  : 'text-fg-3 hover:text-fg-1'
              )}
              title={node.isPinned ? 'Unpin' : 'Pin'}
            >
              {node.isPinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {/* Bottom row: Title or extra info */}
      <div className="mt-1.5">
        <p className="text-xs text-fg-1 truncate">{node.title}</p>

        {/* Work Order specific: running ops count + last receipt status */}
        {node.entityType === 'work_order' && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Priority badge */}
            {node.priority && (
              <span
                className={cn(
                  'px-1.5 py-0.5 text-xs font-medium rounded-[var(--radius-sm)]',
                  node.priority === 'P0' && 'bg-status-danger/10 text-status-danger',
                  node.priority === 'P1' && 'bg-status-warning/10 text-status-warning',
                  node.priority === 'P2' && 'bg-status-info/10 text-status-info',
                  node.priority === 'P3' && 'bg-bg-3 text-fg-2'
                )}
              >
                {node.priority}
              </span>
            )}

            {/* Running ops count */}
            {(node.runningOpsCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-status-progress">
                <PlayCircle className="w-3 h-3" />
                {node.runningOpsCount} running
              </span>
            )}

            {/* Pending ops count */}
            {(node.pendingOpsCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-fg-2">
                <Clock className="w-3 h-3" />
                {node.pendingOpsCount} pending
              </span>
            )}

            {/* Last receipt status */}
            {node.lastReceiptStatus && (
              <span
                className={cn(
                  'text-xs',
                  node.lastReceiptStatus === 'running' && 'text-status-progress',
                  node.lastReceiptStatus === 'success' && 'text-status-success',
                  node.lastReceiptStatus === 'failed' && 'text-status-danger'
                )}
              >
                {node.lastReceiptStatus === 'running' && 'Receipt running'}
                {node.lastReceiptStatus === 'success' && 'Last: OK'}
                {node.lastReceiptStatus === 'failed' && 'Last: FAIL'}
              </span>
            )}
          </div>
        )}

        {/* Operation specific: active receipt link */}
        {node.entityType === 'operation' && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Parent WO link */}
            {node.workOrderCode && onJumpToWorkOrder && node.workOrderId && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onJumpToWorkOrder(node.workOrderId!)
                }}
                className="flex items-center gap-1 text-xs text-fg-2 hover:text-fg-0 transition-colors"
              >
                <ClipboardList className="w-3 h-3" />
                {node.workOrderCode}
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            )}

            {/* Active receipt link */}
            {node.activeReceiptId && onJumpToReceipt && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onJumpToReceipt(node.activeReceiptId!)
                }}
                className="flex items-center gap-1 text-xs text-status-progress hover:text-status-progress/80 transition-colors"
              >
                <Terminal className="w-3 h-3" />
                Receipt
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}

        {/* Receipt-specific: exit code + duration + parent links */}
        {node.entityType === 'receipt' && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Exit code + duration */}
            {node.exitCode !== null && (
              <>
                <span
                  className={cn(
                    'text-xs font-mono',
                    node.exitCode === 0 ? 'text-status-success' : 'text-status-danger'
                  )}
                >
                  exit {node.exitCode}
                </span>
                {node.durationMs != null && (
                  <span className="text-xs text-fg-2">{formatDuration(node.durationMs)}</span>
                )}
              </>
            )}

            {/* Parent operation link */}
            {node.operationId && onJumpToOperation && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onJumpToOperation(node.operationId!)
                }}
                className="flex items-center gap-1 text-xs text-fg-2 hover:text-fg-0 transition-colors"
              >
                <Settings className="w-3 h-3" />
                Op
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            )}

            {/* Parent WO link */}
            {node.workOrderCode && onJumpToWorkOrder && node.workOrderId && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onJumpToWorkOrder(node.workOrderId!)
                }}
                className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg-1 transition-colors"
              >
                <ClipboardList className="w-3 h-3" />
                {node.workOrderCode}
              </button>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

// Compact variant for dense displays
export function EntityNodeCompact({
  node,
  onClick,
  isSelected,
  isHighlighted,
}: Omit<EntityNodeProps, 'onPin' | 'onUnpin' | 'onJumpToReceipt' | 'onJumpToOperation' | 'onJumpToWorkOrder'>) {
  const tone = getTone(node)
  const toneClasses = statusToneClasses[tone]
  const StatusIcon = statusIcons[tone]
  const isRunning = node.entityType === 'receipt' && node.isRunning

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] border transition-all',
        'hover:bg-bg-3/50 focus:outline-none',
        isSelected
          ? 'bg-bg-3 border-status-info/30'
          : 'bg-transparent border-transparent hover:border-white/[0.06]',
        isHighlighted && 'ring-2 ring-status-warning',
        node.isFading && 'opacity-50',
        'motion-reduce:animate-none'
      )}
    >
      {/* Status dot */}
      <div className={cn(isRunning && 'motion-safe:animate-pulse-subtle')}>
        <StatusIcon className={cn('w-3 h-3', toneClasses.icon)} />
      </div>

      {/* ID */}
      <span className="font-mono text-xs text-fg-0 truncate flex-1 text-left">
        {node.displayId}
      </span>

      {/* Time */}
      <span className="text-xs text-fg-3 tabular-nums shrink-0">
        {formatRelativeTime(node.lastActivity)}
      </span>
    </button>
  )
}
