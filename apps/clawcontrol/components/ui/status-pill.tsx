'use client'

import { cn } from '@/lib/utils'
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Circle,
  PlayCircle,
  Info,
  RotateCcw,
} from 'lucide-react'
import type { StatusTone } from '@clawcontrol/ui/theme'
import { statusToneClasses } from '@clawcontrol/ui/theme'

const statusIcons: Record<StatusTone, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  progress: PlayCircle,
  idle: Circle,
  muted: Circle,
}

interface StatusPillProps {
  tone: StatusTone
  label: string
  icon?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function StatusPill({
  tone,
  label,
  icon = true,
  size = 'sm',
  className,
}: StatusPillProps) {
  const Icon = statusIcons[tone]
  const classes = statusToneClasses[tone]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border whitespace-nowrap',
        classes.bg,
        classes.border,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        className
      )}
    >
      {icon && <Icon className={cn('shrink-0', classes.icon, size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
      <span className={cn(classes.text, 'font-medium')}>{label}</span>
    </span>
  )
}

// Convenience components for common statuses
export function WorkOrderStatePill({
  state,
  className,
}: {
  state: string
  className?: string
}) {
  const toneMap: Record<string, StatusTone> = {
    planned: 'idle',
    active: 'progress',
    blocked: 'danger',
    review: 'warning',
    shipped: 'success',
    archived: 'muted',
    cancelled: 'muted',
  }

  const labelMap: Record<string, string> = {
    planned: 'Planned',
    active: 'Active',
    blocked: 'Blocked',
    review: 'Review',
    shipped: 'Shipped',
    archived: 'Archived',
    cancelled: 'Cancelled',
  }

  return (
    <StatusPill
      tone={toneMap[state] ?? 'muted'}
      label={labelMap[state] ?? state}
      className={className}
    />
  )
}

export function OperationStatusPill({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const toneMap: Record<string, StatusTone> = {
    todo: 'idle',
    in_progress: 'progress',
    blocked: 'danger',
    review: 'warning',
    done: 'success',
    rework: 'warning',
  }

  const labelMap: Record<string, string> = {
    todo: 'Todo',
    in_progress: 'In Progress',
    blocked: 'Blocked',
    review: 'Review',
    done: 'Done',
    rework: 'Rework',
  }

  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    rework: RotateCcw,
  }

  const Icon = iconMap[status]

  if (Icon) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-pill border whitespace-nowrap px-2 py-0.5 text-xs',
          statusToneClasses[toneMap[status] ?? 'muted'].bg,
          statusToneClasses[toneMap[status] ?? 'muted'].border,
          className
        )}
      >
        <Icon className={cn('w-3 h-3 shrink-0', statusToneClasses[toneMap[status] ?? 'muted'].icon)} />
        <span className={cn(statusToneClasses[toneMap[status] ?? 'muted'].text, 'font-medium')}>
          {labelMap[status] ?? status}
        </span>
      </span>
    )
  }

  return (
    <StatusPill
      tone={toneMap[status] ?? 'muted'}
      label={labelMap[status] ?? status}
      className={className}
    />
  )
}

export function PriorityPill({
  priority,
  className,
}: {
  priority: string
  className?: string
}) {
  const toneMap: Record<string, StatusTone> = {
    P0: 'danger',
    P1: 'warning',
    P2: 'info',
    P3: 'idle',
  }

  return (
    <StatusPill
      tone={toneMap[priority] ?? 'muted'}
      label={priority}
      icon={false}
      className={className}
    />
  )
}

export function GatewayHealthPill({
  status,
  className,
}: {
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  className?: string
}) {
  const toneMap: Record<string, StatusTone> = {
    ok: 'success',
    degraded: 'warning',
    down: 'danger',
    unknown: 'muted',
  }

  const labelMap: Record<string, string> = {
    ok: 'OK',
    degraded: 'Degraded',
    down: 'Down',
    unknown: 'Unknown',
  }

  return (
    <StatusPill
      tone={toneMap[status]}
      label={labelMap[status]}
      className={className}
    />
  )
}
