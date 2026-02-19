import { cn } from '@/lib/utils'

export type MetricTone = 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'muted'
export type MetricCardSize = 'default' | 'compact'

const toneClasses: Record<MetricTone, { icon: string; value: string }> = {
  success: { icon: 'text-status-success', value: 'text-status-success' },
  warning: { icon: 'text-status-warning', value: 'text-status-warning' },
  danger: { icon: 'text-status-danger', value: 'text-status-danger' },
  info: { icon: 'text-status-info', value: 'text-status-info' },
  progress: { icon: 'text-status-progress', value: 'text-status-progress' },
  muted: { icon: 'text-fg-2', value: 'text-fg-0' },
}

const sizeClasses: Record<
  MetricCardSize,
  {
    card: string
    row: string
    iconWrap: string
    icon: string
    value: string
    label: string
  }
> = {
  default: {
    card: 'p-4',
    row: 'gap-4',
    iconWrap: 'w-12 h-12',
    icon: 'w-6 h-6',
    value: 'text-xl',
    label: 'text-sm mt-1',
  },
  compact: {
    card: 'p-2.5',
    row: 'gap-2.5',
    iconWrap: 'w-9 h-9',
    icon: 'w-4 h-4',
    value: 'text-[13.5px]',
    label: 'text-[9.5px] mt-0',
  },
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'muted',
  size = 'default',
  className,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  tone?: MetricTone
  size?: MetricCardSize
  className?: string
}) {
  const t = toneClasses[tone]
  const s = sizeClasses[size]

  return (
    <div
      className={cn(
        'bg-bg-2 rounded-[var(--radius-md)] border border-bd-0',
        s.card,
        className
      )}
    >
      <div className={cn('flex items-center', s.row)}>
        <div className={cn('rounded-[var(--radius-md)] bg-bg-3 flex items-center justify-center shrink-0', s.iconWrap)}>
          <Icon className={cn(s.icon, t.icon)} />
        </div>
        <div className="min-w-0">
          <div className={cn('font-semibold leading-none tabular-nums', s.value, t.value)}>
            {value}
          </div>
          <div className={cn('text-fg-2 truncate', s.label)}>{label}</div>
        </div>
      </div>
    </div>
  )
}
