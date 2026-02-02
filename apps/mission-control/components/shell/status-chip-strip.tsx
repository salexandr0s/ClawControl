'use client'

import { cn } from '@/lib/utils'
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  AlertOctagon,
} from 'lucide-react'
import type { StatusTone } from '@savorg/ui/theme'

type ChipStatus = 'ok' | 'degraded' | 'down' | 'unknown'

interface StatusChip {
  id: string
  label: string
  value: string | number
  status: ChipStatus
  age?: string
}

const _statusToTone: Record<ChipStatus, StatusTone> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'muted',
}

const statusIcons: Record<ChipStatus, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle,
  degraded: AlertTriangle,
  down: XCircle,
  unknown: AlertOctagon,
}

const statusColors: Record<ChipStatus, string> = {
  ok: 'text-status-success',
  degraded: 'text-status-warning',
  down: 'text-status-danger',
  unknown: 'text-fg-2',
}

interface StatusChipProps {
  chip: StatusChip
  onClick?: () => void
}

function StatusChipItem({ chip, onClick }: StatusChipProps) {
  const StatusIcon = statusIcons[chip.status]

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)]',
        'bg-bg-2 border border-white/[0.06] hover:border-bd-1 transition-colors',
        'h-7 min-w-0'
      )}
    >
      <StatusIcon className={cn('w-3.5 h-3.5 shrink-0', statusColors[chip.status])} />
      <span className="text-xs text-fg-1 truncate hidden sm:inline">{chip.label}</span>
      <span className="font-mono text-xs font-medium text-fg-0">{chip.value}</span>
      {chip.age && (
        <span className="text-xs text-fg-2 hidden md:inline">· {chip.age}</span>
      )}
    </button>
  )
}

interface StatusChipStripProps {
  chips: StatusChip[]
  onChipClick?: (chipId: string) => void
  scrollable?: boolean
  className?: string
}

export function StatusChipStrip({
  chips,
  onChipClick,
  scrollable = false,
  className,
}: StatusChipStripProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        scrollable
          ? 'overflow-x-auto scrollbar-hide whitespace-nowrap'
          : 'flex-wrap',
        className
      )}
    >
      {chips.map((chip) => (
        <StatusChipItem
          key={chip.id}
          chip={chip}
          onClick={() => onChipClick?.(chip.id)}
        />
      ))}
    </div>
  )
}

// Default chips for the Now page
export function useDefaultStatusChips(): StatusChip[] {
  // In a real app, this would fetch from API/context
  return [
    { id: 'gateway', label: 'Gateway', value: 'OK', status: 'ok', age: '12s' },
    { id: 'live', label: 'Live', value: 'OK', status: 'ok' },
    { id: 'approvals', label: 'Approvals', value: 0, status: 'ok' },
    { id: 'running', label: 'Running', value: 0, status: 'ok' },
    { id: 'incidents', label: 'Incidents', value: 0, status: 'ok' },
  ]
}
