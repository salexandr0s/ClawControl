import { cn } from '@/lib/utils'

export type MetricTone = 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'muted'

const toneClasses: Record<MetricTone, { icon: string; value: string }> = {
  success: { icon: 'text-status-success', value: 'text-status-success' },
  warning: { icon: 'text-status-warning', value: 'text-status-warning' },
  danger: { icon: 'text-status-danger', value: 'text-status-danger' },
  info: { icon: 'text-status-info', value: 'text-status-info' },
  progress: { icon: 'text-status-progress', value: 'text-status-progress' },
  muted: { icon: 'text-fg-2', value: 'text-fg-0' },
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'muted',
  className,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  tone?: MetricTone
  className?: string
}) {
  const t = toneClasses[tone]

  return (
    <div
      className={cn(
        'bg-bg-2 rounded-[var(--radius-md)] border border-bd-0 p-4',
        className
      )}
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-[var(--radius-md)] bg-bg-3 flex items-center justify-center shrink-0">
          <Icon className={cn('w-6 h-6', t.icon)} />
        </div>
        <div className="min-w-0">
          <div className={cn('text-2xl font-semibold leading-none tabular-nums', t.value)}>
            {value}
          </div>
          <div className="text-sm text-fg-2 mt-1 truncate">{label}</div>
        </div>
      </div>
    </div>
  )
}

