'use client'

import { cn } from '@/lib/utils'
import { getModelById, getModelShortName } from '@/lib/models'
import { ProviderLogo } from '@/components/provider-logo'
import { Cpu } from 'lucide-react'

interface ModelBadgeProps {
  modelId: string | null
  size?: 'sm' | 'md'
  className?: string
  showIcon?: boolean
}

const COLOR_CLASSES = {
  info: 'bg-status-info/10 text-status-info border-transparent',
  progress: 'bg-status-progress/10 text-status-progress border-transparent',
  success: 'bg-status-success/10 text-status-success border-transparent',
  default: "bg-bg-3 text-fg-2 border-bd-0",
} as const

function providerFromModelId(modelId: string | null): string {
  if (!modelId) return 'unknown'
  return modelId.split('/')[0] || 'unknown'
}

export function ModelBadge({
  modelId,
  size = 'sm',
  className,
  showIcon = false,
}: ModelBadgeProps) {
  const model = getModelById(modelId)
  const shortName = getModelShortName(modelId)
  const colorClass = model ? COLOR_CLASSES[model.color] : 'bg-bg-3 text-fg-2 border-bd-0'
  const provider = providerFromModelId(modelId)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border rounded-[var(--radius-sm)] font-medium whitespace-nowrap',
        size === 'sm' && 'px-1.5 py-0.5 text-[10px]',
        size === 'md' && 'px-2 py-1 text-xs',
        colorClass,
        className
      )}
    >
      {modelId && (
        <ProviderLogo
          provider={provider}
          size="sm"
          className={cn(size === 'sm' ? 'w-3.5 h-3.5 rounded-[4px] shrink-0' : 'w-4 h-4 rounded-[4px] shrink-0')}
        />
      )}
      {showIcon && <Cpu className={cn(size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
      {shortName}
    </span>
  )
}

/**
 * Model selector dropdown option
 */
interface ModelOptionProps {
  modelId: string
  selected?: boolean
  onClick?: () => void
}

export function ModelOption({ modelId, selected, onClick }: ModelOptionProps) {
  const model = getModelById(modelId)
  if (!model) return null

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-left rounded-[var(--radius-md)] transition-colors',
        selected
          ? 'bg-status-progress/10 border border-transparent'
          : 'hover:bg-bg-3 border border-transparent'
      )}
    >
      <ModelBadge modelId={modelId} size="md" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-fg-0">{model.name}</div>
        <div className="text-xs text-fg-2">{model.description}</div>
      </div>
      {selected && (
        <div className="w-2 h-2 rounded-full bg-status-progress" />
      )}
    </button>
  )
}
